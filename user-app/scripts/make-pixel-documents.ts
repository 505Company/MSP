import { readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { digest, loadJson } from './pixel-pilot-store'
import sourceRecipe from '../lib/presentations/recipes/layout-engine-v1/source.json' with { type: 'json' }
import { structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'

// Read-only with respect to source plans, provider replies, PNGs and budgets.
const output = resolve('outputs/diagnostics/qwen-pixel-service')
const source = await loadJson(`${output}/source.json`), result = await loadJson(`${output}/result.json`)
const manifest = await loadJson(`${output}/experiment.json`), selected = await loadJson(`${output}/designer-selected.json`)
const routeraiConnection = await loadJson(`${output}/routerai-connection.json`)
await writeFile(`${output}/00-content.md`, `# Исходное содержание\n\n\`\`\`text\n${source.raw}\n\`\`\`\n\nТочный снимок библиотеки и фрагментов: [source.json](source.json).\n`)
await writeFile(`${output}/00-author-prompt.md`, `# Авторский промпт, без изменений\n\n\`\`\`text\n${sourceRecipe.text}\n\`\`\`\n`)

function requestMarkdown(task: StructuredRequest, rawLink: string, authorLink: string, generation: unknown) {
  let body = `# Точный запрос модели\n\n[Исходный JSON](${rawLink}). Схема: ${task.schemaName}; maxTokens: ${task.maxTokens}; enable_thinking: ${task.thinking ?? false}.\n\n`
  body += `## Запрошенные параметры API\n\n\`\`\`json\n${JSON.stringify(generation, null, 2)}\n\`\`\`\n\nЭто настройки запроса, не подтверждение того, что провайдер их применил.\n\n`
  for (const [i, message] of task.messages.entries()) {
    body += `## Сообщение ${i + 1}: ${message.role}\n\n`
    const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content as { type: string; text?: string }[]
    for (const part of parts) {
      if (part.type === 'image_url') { body += `Изображение передано модели. Точный data URL сохранён в исходном JSON.\n\n`; continue }
      const text = part.text ?? ''
      try {
        const value = JSON.parse(text)
        if (value.authorV1 === sourceRecipe.text) { body += `Полный authorV1 приведён отдельно: [авторский промпт](${authorLink}).\n\n`; delete value.authorV1 }
        body += `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n`
      } catch { body += `\`\`\`text\n${text}\n\`\`\`\n\n` }
    }
  }
  return body + `## Схема ответа\n\n\`\`\`json\n${JSON.stringify(task.schema, null, 2)}\n\`\`\`\n`
}
const walk = async (path: string): Promise<string[]> => {
  const files: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) files.push(...await walk(`${path}/${entry.name}`))
    else if (entry.name.endsWith('.json')) files.push(`${path}/${entry.name}`)
  }
  return files.sort()
}
const files = await walk(output), stageLinks: string[] = [], historyLinks: string[] = []
const stages = [...new Set<string>([...manifest.reservations.map((r: { prefix: string }) => r.prefix), ...files.flatMap(f => f.match(/\/(0[124][^/]+)-(?:request|response)\.json$/)?.[1] ?? [])])]
const stageIndex = (file: string) => stages.findIndex(prefix => file.includes(`/model/${prefix}/`) || file.endsWith(`/${prefix}-request.json`) || file.endsWith(`/${prefix}-response.json`))
const stageName = (prefix: string) => prefix.startsWith('02-typesetter-') ? `Qwen 2: численное ТЗ, попытка ${prefix.split('-').at(-1)}`
  : prefix.startsWith('04-review-') ? `Qwen: визуальное ревью, попытка ${prefix.split('-').at(-1)}`
  : prefix.includes('routerai') ? 'Qwen 1: RouterAI, DeepInfra BF16'
  : prefix.includes('recommended') ? 'Qwen 1: рекомендованные настройки генерации'
  : prefix.includes('reasoned') ? 'Qwen 1: новый выбор с включённым режимом рассуждения'
  : prefix.includes('semantic') ? 'Qwen 1: исправление смыслового брифа'
  : prefix.includes('recovery') ? 'Qwen 1: восстановление после обрезанного JSON' : 'Qwen 1: исходный выбор'
for (const file of files.filter(f => /\/0[124][^/]*-(request|response)\.json$/.test(f) || /\/model\/.*\/(inputs|responses|clarifications)\//.test(f)).sort((a, b) => stageIndex(a) - stageIndex(b) || a.localeCompare(b))) {
  const value = await loadJson(file), path = relative(output, file), md = file.replace(/\.json$/, '-readable.md'), raw = file.split('/').at(-1)!
  const prefix = stages[stageIndex(file)]
  let content: string
  if (value.task || value.messages) {
    const inputPath = files.find(f => f.includes(`/model/${prefix}/inputs/`)), input = inputPath ? await loadJson(inputPath) : null
    const model = value.model ?? input?.model ?? (prefix.includes('routerai') ? routeraiConnection?.model : undefined)
    const config = model?.provider === 'routerai' ? { baseUrl: model.baseUrl, model: model.model,
      routerai: { providerTag: model.routing.only[0], quantization: 'bf16' as const } } : undefined
    const generation = value.generation ?? structuredGeneration(value.task ?? value, config)
    content = requestMarkdown(value.task ?? value, raw, relative(dirname(md), `${output}/00-author-prompt.md`), generation)
  }
  else if (typeof value.content === 'string') {
    const { content: answer, ...metadata } = value
    let readable = answer.trimEnd(); try { readable = JSON.stringify(JSON.parse(answer), null, 2) } catch { /* Keep partial output as text; never repair its JSON. */ }
    content = `# Ответ провайдера\n\n[Точный JSON](${raw}). Для читаемости отброшены только завершающие пустые строки; исходный ответ сохранён полностью.\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n\`\`\`text\n${readable}\n\`\`\`\n`
  } else content = `# Ответ этапа\n\n[Точный JSON](${raw}).\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`
  await writeFile(md, content)
  const preparedOnly = !path.startsWith('model/') && !files.some(f => f.includes(`/model/${prefix}/inputs/`))
  const label = path.startsWith('model/') ? path : `${stageName(prefix)} · ${file.endsWith('-request.json') ? preparedOnly ? 'подготовлен, ещё не отправлен' : 'запрос' : 'ответ'}`
  const link = `- [${label}](${relative(output, md)})`
  if (path.startsWith('model/')) historyLinks.push(link); else stageLinks.push(link)
}
const rounds = await loadJson(`${output}/rounds.json`) as { round: number; plan: { briefHash: string }; report: { passed: boolean }; review?: { verdict: string } }[] | null
const revalidation = await loadJson(`${output}/designer-revalidation-1.json`)
const rejectedRunPath = files.find(f => f.endsWith(`/runs/${revalidation?.sourceRunId}.json`))
const rejectedRun = rejectedRunPath ? await loadJson(rejectedRunPath) : null
const rejectedBriefHash = rejectedRun?.result ? digest(rejectedRun.result) : null
const attempts = (rounds ?? []).map(r => `- [PNG ${r.round}](slide-attempt-${r.round}.png): измерения ${r.report.passed ? 'PASS' : 'FAIL'}, ревью ${r.review?.verdict ?? 'нет'}${r.plan.briefHash === rejectedBriefHash ? '; бриф впоследствии отклонён, нет библиотечных карточек справа' : selected && r.plan.briefHash !== selected.briefHash ? '; прежний бриф' : ''}. [Замеры](03-measurements-${r.round}.json).`).join('\n')
await writeFile(`${output}/DOCUMENTS.md`, `# Эксперимент: Qwen-дизайнер и Qwen-верстальщик\n\nЗапросы: ${manifest.used}/${manifest.maxRequests}. Итог: ${result.passed ? 'технический PASS и модельное ревью PASS' : 'проверка не завершена успешно'}. Готовая презентация не менялась.\n\n## Исходники\n\n- [Новый текст](00-content.md)\n- [Авторский промпт без изменений](00-author-prompt.md)\n- [Экспериментальное дополнение](recipe-v2.json)\n- [Каталог и возможности](catalog.json)\n- [Образцы, показанные Qwen](library.png)\n\n## Документы этапов\n\n${stageLinks.join('\n')}\n\n## Изображения\n\n${attempts}\n\n## Ошибки и все ответы\n\n${historyLinks.join('\n')}\n\n## Контроль\n\n- [Итог](result.json)\n- [Сохранность хранилища](preservation.json)\n- [Бюджет и расширение разрешения](experiment.json)\n- [Повторная проверка прежнего брифа](designer-revalidation-1.json)\n\nJSON и PNG не редактировались. Документы показывают окончательные ответы и явные обоснования, не приватную цепочку рассуждений.\n`)
console.log(JSON.stringify({ documents: stageLinks.length + historyLinks.length + 3, output: `${output}/DOCUMENTS.md`, used: manifest.used, limit: manifest.maxRequests, passed: result.passed }))
