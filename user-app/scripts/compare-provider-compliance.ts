import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { CaseResult, Report } from './provider-compliance-report'
import { number, object, reasoningTokens, type JsonObject } from './provider-compliance-transport'
import { OUTPUT as ROUTER_OUTPUT } from './provider-compliance-suite'
import { INTELION_OUTPUT } from './intelion-compliance'

const OUTPUT = 'outputs/diagnostics/provider-comparison'
const load = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
const routerBytes = await readFile(`${ROUTER_OUTPUT}/report.json`), intelionBytes = await readFile(`${INTELION_OUTPUT}/report.json`)
const router = JSON.parse(routerBytes.toString('utf8')) as Report, intelion = JSON.parse(intelionBytes.toString('utf8')) as Report
const routerHash = createHash('sha256').update(routerBytes).digest('hex'), intelionHash = createHash('sha256').update(intelionBytes).digest('hex')
const plan = await load(`${INTELION_OUTPUT}/plan.json`), routerPlan = await load(`${ROUTER_OUTPUT}/plan.json`), controlPlan = await load(`${ROUTER_OUTPUT}/output-capacity-control-plan.json`)
if (plan.baselineHash !== routerHash) throw new Error('RouterAI baseline changed since Intelion was prepared.')
const matchingFixtures = (plan.tests as JsonObject[]).map(test => ({ id: test.id,
  matches: test.sharedBodyHash === (test.id === 'output-32768-control' ? controlPlan.bodyHash : (routerPlan.tests as JsonObject[]).find(prior => prior.id === test.id)?.bodyHash),
  nativeThinkingAdapted: test.bodyAdapted === true }))
if (matchingFixtures.some(row => !row.matches)) throw new Error('Comparison inputs differ; do not claim a paired test.')
const find = (report: Report, id: string) => report.cases.find(result => result.id === id)
const check = (report: Report, item: number) => report.checks.find(value => value.item === item)
const names = ['Модель и закреплённый revision', 'BF16 и отсутствие квантования', 'Родной enable_thinking true/false', 'Reasoning effort low/medium/xhigh',
  'Preserve thinking true/false', 'Мелкий текст и UI', 'Sampling: значения и диапазоны', 'Полный цикл tool calling', 'JSON Schema + thinking',
  'Вход 24,5K → 64K → 128K', 'Реальные 32768 выходных токенов', 'Usage, TTFT, finish_reason, KV-cache']
const precision = intelion.provider?.declaredQuantization ?? 'не указана'
const snapshot = (result: CaseResult | undefined) => result ? {
  status: result.verdict.status, detail: result.verdict.detail, http: result.capture?.httpStatus, promptTokens: result.capture?.usage?.prompt_tokens,
  completionTokens: result.capture?.usage?.completion_tokens, reasoningTokens: result.capture ? reasoningTokens(result.capture) : null,
  ttftMs: result.capture?.metrics.ttftMs, durationMs: result.capture?.metrics.durationMs, finishReason: result.capture?.finishReason,
  costRub: result.receipt?.totalCostRub ?? result.estimatedCostRub ?? null,
} : { status: 'NOT_RUN' }
const pairedCases = (plan.tests as JsonObject[]).map(test => ({ id: test.id, router: snapshot(find(router, String(test.id))), intelion: snapshot(find(intelion, String(test.id))) }))
const table = names.map((title, index) => { const a = check(router, index + 1), b = check(intelion, index + 1)
  return { item: index + 1, title, router: { status: a?.status ?? 'UNVERIFIED', detail: a?.detail }, intelion: { status: b?.status ?? 'UNVERIFIED', detail: b?.detail } } })
const comparableTimings = [['Thinking off', 'routerai-off', 'native-off'], ['Thinking low', 'routerai-low', 'native-low'], ['Thinking medium', 'routerai-medium', 'native-medium'], ['Thinking xhigh / JSON', 'routerai-xhigh', 'native-xhigh'],
  ['Изображение', 'small-ui-image', 'small-ui-image'], ['Tool call', 'tool-call', 'tool-call'], ['Tool result', 'tool-result', 'tool-result'],
  ['Вход 24500', 'context-24500', 'context-24500'], ['Вход 64000', 'context-64000', 'context-64000'], ['Вход 128000', 'context-128000', 'context-128000']]
  .map(([title, left, right]) => ({ title, router: snapshot(find(router, left)), intelion: snapshot(find(intelion, right)) }))
const complete = router.summary.completedCases === router.summary.plannedCases && intelion.summary.completedCases === intelion.summary.plannedCases
const result = { at: new Date().toISOString(), comparisonStatus: complete ? 'COMPLETE' : 'IN_PROGRESS',
  router: { at: router.at, overall: router.overall, sha256: routerHash, summary: router.summary },
  intelion: { at: intelion.at, overall: intelion.overall, sha256: intelionHash, summary: intelion.summary },
  matchingFixtures, table, pairedCases, comparableTimings,
  interpretation: [
    'Тесты используют один набор синтетических входов и один оценщик. RouterAI не перезапускался.',
    'В общих тестах управление thinking переведено в родной Intelion chat_template_kwargs; восемь явных проб обоих диалектов одинаковы.',
    'Это единичные измерения API. Задержки зависят от нагрузки, очереди и сети; разная точность весов и неизвестные revision мешают делать вывод о чистом качестве архитектуры.',
    'RouterAI: стоимость из квитанций. Intelion: расчёт по usage и тарифам /models, не банковская или биллинговая квитанция.',
    'Принятые параметры не доказывают их точное серверное применение. Успешный длинный вход доказывает восстановление меток в этих трёх фикстурах.',
    'Проба top_k=-1 имеет неоднозначный смысл вне контракта RouterAI: vLLM допускает -1 для отключения фильтра. На Intelion её принятие не считается доказательством игнорирования top_k. Неразобранные потоки ошибок других отрицательных проб не означают принятие некорректных значений.',
  ] }
const cell = (value: unknown) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const seconds = (value: unknown) => number(value) === null ? '—' : (Number(value) / 1000).toFixed(2)
const rub = (value: unknown) => number(value) === null ? 'неизвестно' : Number(value).toFixed(4)
const budgetRouter = object(router.summary.budget), budgetIntelion = object(intelion.summary.budget)
const outputLine = (report: Report) => ['output-32768', 'output-32768-control'].map(id => { const row = find(report, id)
  return `${id === 'output-32768' ? 'CSV' : 'контроль'}: ${row?.capture?.usage?.completion_tokens ?? '—'} токенов, ${row?.capture?.finishReason ?? row?.verdict.status ?? 'не выполнен'}` }).join('; ')
const content = `# Intelion и RouterAI / DeepInfra · сравнение compliance\n\n${result.at}\n\nСтатус сравнения: **${result.comparisonStatus}**.\n\n` +
  `Intelion снова ответил на API. В его метаданных Qwen3.8-27B указан **${precision}**; у DeepInfra заявлен **BF16**. Это декларации провайдеров, без серверной аттестации весов.\n\n` +
  `Результат Intelion: **${intelion.overall}**, ${intelion.summary.completedCases}/${intelion.summary.plannedCases} сценариев, ${budgetIntelion.reservedRequests} API-запросов. RouterAI: **${router.overall}**, ${router.summary.completedCases}/${router.summary.plannedCases}.\n\n` +
  '| № | Проверка | RouterAI / DeepInfra | Intelion |\n|---|---|---|---|\n' + table.map(row => `| ${row.item} | ${row.title} | **${row.router.status}** | **${row.intelion.status}** |`).join('\n') +
  '\n\n## Подробности по каждому требованию\n\n' + table.map(row => `${row.item}. **${row.title}.** RouterAI: ${cell(row.router.detail)} Intelion: ${cell(row.intelion.detail)}`).join('\n\n') +
  `\n\n## Выход и расход\n\n- RouterAI: ${outputLine(router)}.\n- Intelion: ${outputLine(intelion)}.\n- RouterAI: **${rub(budgetRouter.receiptedCostRub)} ₽**, подтверждено квитанциями.\n- Intelion: **около ${rub(budgetIntelion.estimatedCostRub)} ₽**, оценка по usage и текущим тарифам; учтены ${budgetIntelion.requestsWithUsageEstimate} запросов с usage.\n\n` +
  '## Наблюдаемые времена\n\nВ каждой паре одинаковая задача и целевой режим thinking. Значения в секундах: TTFT / полная длительность; рядом выходные токены. Это наблюдения, не статистический benchmark.\n\n| Проба | RouterAI, с | Выход | Intelion, с | Выход |\n|---|---|---|---|---|\n' +
  comparableTimings.map(row => `| ${row.title} | ${seconds(row.router.ttftMs)} / ${seconds(row.router.durationMs)} | ${cell(row.router.completionTokens)} | ${seconds(row.intelion.ttftMs)} / ${seconds(row.intelion.durationMs)} | ${cell(row.intelion.completionTokens)} |`).join('\n') +
  '\n\n## Границы сравнения\n\n' + result.interpretation.map(value => `- ${value}`).join('\n') +
  `\n\nВсе ${matchingFixtures.length} исходные задачи совпали по хешам. В ` + '`comparison.json`' + ` есть результаты каждой пары, хеши исходных отчётов и список адаптированных полей.\n\n[Полный Intelion](../provider-compliance-intelion/report.md) · [Сохранённый RouterAI](../provider-compliance/report.md)\n`
await mkdir(OUTPUT, { recursive: true })
await writeFile(`${OUTPUT}/comparison.json`, JSON.stringify(result, null, 2) + '\n')
await writeFile(`${OUTPUT}/comparison.md`, content)
console.log(JSON.stringify({ status: result.comparisonStatus, matchingFixtures: matchingFixtures.length, path: `${OUTPUT}/comparison.md`, modelRequests: 0 }))
