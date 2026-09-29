import type { VisualManifest } from '../digital-designer/visual-package'
import type { ModelMessage } from '../digital-designer/design-context'
import { contentHash } from './catalog'
import { buildSourceSystem, SOURCE_SYSTEM_VERSION, type SourceSystem, type ScanBatch } from './source-system'
import { nativeListMarker, readSourceScene } from './source-scene'
import { semanticPrompt, semanticSchema, SEMANTIC_VERSION, validateSemanticReply } from './semantic-contract'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { beginModelRun } from '../uploads/model-run'

export const semanticPrefix = (uploadId: string) => `semantic-pilots/${uploadId}`

export function selectPilotBatch(system: SourceSystem) {
  return system.scan.batches.find(b => b.nodes.length <= 48 && new Set(b.nodes.map(n => n.slide)).size <= 3 && b.sourceGroups.length > 0 && b.nodes.some(n => n.kind === 'text') && b.nodes.some(n => n.kind !== 'text')) ?? system.scan.batches[0]
}

export async function prepareSemanticPilot(bucket: R2Bucket, uploadId: string, visual: VisualManifest, batchId?: string, options?: { system: SourceSystem; batch: ScanBatch; prompt: string }) {
  const snapshot = visual.snapshot, system = options?.system ?? buildSourceSystem(snapshot)
  const batch = options?.batch ?? (batchId ? system.scan.batches.find(b => b.id === batchId) : selectPilotBatch(system))
  if (!batch) throw new QwenAnalysisError('SEMANTIC_BATCH_MISSING', 'Пакет объектов для анализа не найден.')
  const slideNumbers = [...new Set(batch.nodes.map(n => n.slide))]
  if (slideNumbers.length > 8) throw new QwenAnalysisError('SEMANTIC_BATCH_TOO_LARGE', 'Для пробного анализа выберите пакет не более чем с восемью слайдами.')
  const slides = snapshot.slides.filter(s => slideNumbers.includes(s.number))
  if (slides.some(s => s.warnings.some(w => w.startsWith('normalized-page-unavailable')))) throw new QwenAnalysisError('SEMANTIC_SOURCE_INCOMPLETE', 'Сначала требуется завершить чтение выбранных слайдов.')
  const styleIds = new Set(batch.nodes.flatMap(n => n.styleIds)), styles = system.styles.filter(s => styleIds.has(s.id))
  const scene = readSourceScene(snapshot)
  const fixedMarkerIds = batch.nodes.filter(n => nativeListMarker(scene.records.get(n.id)!, scene)).map(n => n.id)
  const context = { snapshot, batch, styles, fixedMarkerIds }
  const supplied = new Set(batch.nodes.map(n => n.id))
  // v13 sends a compact native map, not repeated path commands, style runs and
  // importer references. Full text is retained; exact rendering properties stay
  // in the frozen snapshot whose hash is part of every request/cache identity.
  const nodeData = (node: typeof batch.nodes[number]) => {
    const record = scene.records.get(node.id)!, p = node.properties
    const parent = node.parentId ? scene.records.get(node.parentId) : undefined
    const requiredContainer = parent?.element.kind === 'group' && parent.element.clipsContent && parent.element.children.length === 1 && supplied.has(parent.element.id) ? parent.element.id : null
    return { id: node.id, parentId: node.parentId ?? null, slide: node.slide, kind: node.kind,
      name: record.source.name, bounds: record.bounds, localBounds: record.element.bounds,
      text: node.kind === 'text' ? String(p.text ?? '') : null,
      children: (scene.children.get(node.id) ?? []).map(c => c.id),
      requiredContainerId: requiredContainer, clipsContent: p.clipsContent === true,
      assetId: typeof p.assetId === 'string' ? p.assetId : null, styleIds: node.styleIds,
    }
  }
  const data = { sourceId: snapshot.sourceId, scope: 'partial-batch',
    slides: slides.map(({ id, number, width, height }) => ({ id, number, width, height })),
    requiredNodeIds: batch.nodes.map(n => n.id), nodes: batch.nodes.map(nodeData), context: batch.context.map(nodeData), sourceGroups: batch.sourceGroups, fixedMarkerIds,
    suppliedStyles: styles.map(({ id, kind, value }) => ({ id, kind, value })),
  }
  const content: Exclude<ModelMessage['content'], string> = [{ type: 'text', text: JSON.stringify(data) }]
  const previews: { slideId: string; sha256: string; bytes: number }[] = []
  let imageBytes = 0
  for (const slide of slides) {
    const preview = visual.previews.find(p => p.id === slide.id), key = `visual/${uploadId}/preview-${slide.id}`
    if (!preview || !['image/png', 'image/jpeg'].includes(preview.mime)) throw new QwenAnalysisError('SEMANTIC_PREVIEW_MISSING', 'Не найдено превью исходного слайда.')
    const head = await bucket.head(key)
    if (!head) throw new QwenAnalysisError('SEMANTIC_PREVIEW_MISSING', 'Не найдено превью исходного слайда.')
    imageBytes += head.size
    if (imageBytes > 8 * 1024 * 1024) throw new QwenAnalysisError('SEMANTIC_EVIDENCE_TOO_LARGE', 'Превью пакета превышают размер одного запроса модели.')
    const file = await bucket.get(key)
    if (!file) throw new QwenAnalysisError('SEMANTIC_PREVIEW_MISSING', 'Не найдено превью исходного слайда.')
    const bytes = new Uint8Array(await file.arrayBuffer()), base64 = Buffer.from(bytes).toString('base64')
    if (bytes.length !== head.size) throw new QwenAnalysisError('SEMANTIC_PREVIEW_CHANGED', 'Превью изменилось во время подготовки анализа.')
    previews.push({ slideId: slide.id, bytes: bytes.length, sha256: await contentHash(base64) })
    content.push({ type: 'text', text: `Исходный слайд ${slide.number}, ID ${slide.id}. Только объекты из nodes входят в этот пакет.` }, { type: 'image_url', image_url: { url: `data:${preview.mime};base64,${base64}` } })
  }
  const task = { messages: [{ role: 'system' as const, content: options?.prompt ?? semanticPrompt }, { role: 'user' as const, content }], schema: semanticSchema, schemaName: 'web_semantic_batch', maxTokens: 8000 }
  const scope = { uploadId, sourceId: snapshot.sourceId, sourceRevision: await contentHash(snapshot), sourceSystemVersion: SOURCE_SYSTEM_VERSION,
    renderer: visual.renderer, batchId: batch.id, suppliedIds: batch.nodes.map(n => n.id), slideNumbers, previews,
    totalBatches: system.scan.batches.length, totalEligibleNodes: system.scan.suppliedIds.length, deferredNodes: system.scan.pending.length,
    totalSourceRecords: snapshot.elements.length, completeDesignSystem: false,
  }
  return { task, context, scope }
}

export async function startSemanticPilot(bucket: R2Bucket, uploadId: string, visual: VisualManifest, config: QwenConfig, batchId?: string) {
  const prepared = await prepareSemanticPilot(bucket, uploadId, visual, batchId)
  return beginModelRun({ bucket, uploadId, prefix: semanticPrefix(uploadId), task: prepared.task, config, version: SEMANTIC_VERSION, scope: prepared.scope,
    validate: raw => validateSemanticReply(raw, prepared.context),
    // v13 permits one targeted clarification. Reuse a saved rejected response
    // with the exact same input rather than paying for the initial pass again.
    clarification: { version: 'web-semantic-clarification-3', request: (reply, issues) => ({ ...prepared.task,
      messages: [prepared.task.messages[0], { role: 'user', content: [{ type: 'text', text: JSON.stringify({
        instruction: 'Предыдущий ответ не прошёл проверку. Верни полный исправленный JSON для того же пакета. Не меняй исходные объекты и не добавляй новые ID. Для invalid-text-slot убери ссылки вне состава молекулы, нетекстовые объекты и фиксированные маркеры из textSlots. Поле меняет только будущий экземпляр; исходная цитата rules сохраняется независимо. Для missing-decision назначь роль самому указанному объекту или укажи pending с причиной. Проверь все остальные решения и полные исходные тексты. Не приписывай текстовым объектам свойства групп. Не объявляй фон недопустимым атомом — категория background предусмотрена. Только одно уточнение; если данных не хватает, явно pending.',
        validationIssues: issues, previousResponse: reply.content,
      }) }, ...prepared.task.messages[1].content as Exclude<ModelMessage['content'], string>] }],
    }) },
  })
}
