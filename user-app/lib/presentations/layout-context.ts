import { catalogLibrary, contentHash } from '../design-system/catalog'
import { readEditableCatalog } from '../design-system/editable-analysis'
import { flatten } from '../design-system/compiler'
import { readCalibratedCatalog } from '../design-system/calibration'
import { readReconstructionCatalog } from '../design-system/reconstruction'
import { reconstructedLibrary } from '../design-system/reconstruction-resources'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { modelIdentity } from '../uploads/qwen-structured'
import { readStructure, structureContext } from './structure'
import { visibleFragmentText } from './material'
import { LAYOUT_RECIPE_VERSION, layoutStates } from './recipes/layout-engine-v1/states'
import source from './recipes/layout-engine-v1/source.json' with { type: 'json' }
import { componentFields, LAYOUT_EXECUTION_VERSION, type LayoutInput } from './layout-contract'
import { readComponentAdaptation } from '../design-system/component-adaptation-storage'
import { qualifiedComponentFlow } from '../design-system/component-adaptation'
import { getProject } from '../workspace/storage'
import { projectPreparedBoxes } from './prepared-component-storage'

export async function layoutContext(bucket: R2Bucket, projectId: string, config: QwenConfig) {
  const structure = await structureContext(bucket, projectId, config), ready = await readStructure(bucket, structure)
  if (ready?.status !== 'ready' || !ready.outline) throw new QwenAnalysisError('STRUCTURE_NOT_READY', 'Сначала подготовим содержание слайдов.')
  const project = await getProject(bucket, projectId)
  if (!project || project.revision !== structure.sourceRevision) throw new QwenAnalysisError('CONTENT_CHANGED', 'Проект обновился. Продолжим для сохранённой версии.')
  const uploadId = project.uploadId
  const catalog = await catalogLibrary(bucket, uploadId)
  if (!catalog) throw new QwenAnalysisError('STYLE_NOT_READY', 'Сначала завершите обработку дизайн-системы.')
  const calibrated = await readCalibratedCatalog(bucket, uploadId, catalog.catalogId)
  if (!calibrated) throw new QwenAnalysisError('STYLE_NOT_READY', 'Дизайн-система ещё проходит проверку компонентов.')
  const editable = await readEditableCatalog(bucket, uploadId)
  const passed = new Set(editable?.qualification?.checks.filter(c => c.passed).map(c => c.id) ?? [])
  const components = editable?.families.flatMap(f => f.variants.filter(t => passed.has(t.id) && ['metric', 'feature', 'text'].includes(t.kind) && !t.children && !t.sourceChart && !t.sourceInline && componentFields(t).length)) ?? []
  const adaptation = editable ? await readComponentAdaptation(bucket, uploadId, editable.id) : undefined
  const componentFlows = Object.fromEntries((await Promise.all(components.map(async t => { const flow = await qualifiedComponentFlow(t, adaptation); return flow ? [[t.id, flow]] : [] }))).flat())
  const preparedComponents = await projectPreparedBoxes(bucket, project)
  const reconstruction = await readReconstructionCatalog(bucket, uploadId, catalog.catalogId)
  const library = reconstructedLibrary(catalog.library, reconstruction)
  const qualified = new Set(calibrated.families.flatMap(f => f.variants.map(v => v.id)))
  const graphics = library.components.filter(c => qualified.has(c.id) && !c.slots.length && !c.fixedTextIds.length && !c.issues.some(i => i.severity !== 'warning') &&
    !flatten(c.scene.elements).some(e => e.kind === 'text') && c.semantics.length && !c.semantics.some(s => /chart|table|metric|statistic|диаграмм|таблиц|процент|показател/i.test(`${s.role} ${s.name}`)))
  const colors = library.tokens.colors.map((c, i) => ({ id: `color-${i + 1}`, hex: c.hex }))
  const fonts = library.tokens.fonts.map((f, i) => ({ id: `font-${i + 1}`, family: f.family }))
  if (!fonts.length) throw new QwenAnalysisError('FONT_TOKEN_UNAVAILABLE', 'В дизайн-системе нет доступного токена шрифта.')
  if (colors.length < 2) throw new QwenAnalysisError('INVALID_COLOR_COMBINATION', 'В дизайн-системе недостаточно цветов для фона и текста.')
  const rules = 'semantic' in catalog ? catalog.semantic?.rules.map(r => r.interpretation) ?? [] : []
  const inputs: LayoutInput[] = ready.outline.slides.map(s => ({
    slideId: s.id, title: s.title, uploadId, colors, fonts, components, graphics, rules, ...(Object.keys(componentFlows).length ? { componentFlows } : {}),
    ...(Object.keys(preparedComponents).length ? { preparedComponents } : {}),
    content: s.fragmentIds.filter(id => structure.material.fragments.find(f => f.id === id)?.kind === 'content').map(id => { const f = structure.material.fragments.find(f => f.id === id)!; return { id, text: visibleFragmentText(f) } }),
    directions: s.directionIds.map(id => visibleFragmentText(structure.material.fragments.find(f => f.id === id)!)),
  }))
  const legacyInputId = await contentHash({ version: LAYOUT_RECIPE_VERSION, source: source.sourceSha256, states: layoutStates, inputs, model: modelIdentity(config) })
  const inputId = await contentHash({ execution: LAYOUT_EXECUTION_VERSION, sourceInputId: legacyInputId })
  return { inputId, projectId, materialId: structure.material.id, uploadId, inputs, prefix: `presentation-layouts/${projectId}/${inputId}`, sourceRevision: structure.sourceRevision,
    legacyInputId, legacyPrefix: `presentation-layouts/${projectId}/${legacyInputId}` }
}
export type LayoutContext = Omit<Awaited<ReturnType<typeof layoutContext>>, 'legacyPrefix' | 'legacyInputId'> & { legacyPrefix?: string; legacyInputId?: string }
