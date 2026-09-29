import type { BoxConstraints, ComponentContent, ComponentProfile } from './contract'
export type LabCase = { id: string; name: string; content: ComponentContent; constraints: BoxConstraints; expect: 'fits' | 'needs-space' | 'incompatible' | 'explore' }
export const shapes = [
  { id: 'portrait', name: 'Узкий высокий', width: 320, maxHeight: 900 },
  { id: 'square', name: 'Квадратный', width: 560, maxHeight: 560 },
  { id: 'landscape', name: 'Горизонтальный', width: 800, maxHeight: 400 },
  { id: 'banner', name: 'Низкий баннер', width: 1000, maxHeight: 220 },
  { id: 'tall', name: 'Большой высокий', width: 600, maxHeight: 900 },
] as const
export const sampleNames = { short: 'Короткий текст', medium: 'Средний текст', long: 'Длинный текст', title: 'Длинный заголовок / число', uneven: 'Неравномерные строки', word: 'Длинное слово', overflow: 'Заведомое переполнение' }
export type SampleName = keyof typeof sampleNames
export function sampleContent(p: ComponentProfile, sample: SampleName): ComponentContent {
  const body = sample === 'short' ? 'Заявки обработаны' : sample === 'medium' ? 'Команда помогает гостю разобраться в ситуации и выбрать подходящее решение.' : sample === 'uneven' ? 'Короткая строка\nПодробное пояснение условий измерения и полученного результата.' : sample === 'word' ? 'Сверхдлинноесловобезпробеловдляпроверкипереносавнутрикарточки' : sample === 'overflow' ? 'Содержание необходимо сохранить полностью. '.repeat(90) : 'Человек приходит за решением своей конкретной задачи. Сотрудник уточняет условия, предлагает понятный порядок действий и остаётся на связи до завершения обращения. Все важные детали сохраняются.'
  return Object.fromEntries(p.fields.map(f => [f.id, f.role === 'number' ? sample === 'title' ? '128 450,75 тыс.' : '73%' : f.role === 'ordinal' ? sample === 'title' ? '128' : '01' : f.role === 'title' ? sample === 'title' ? 'Каждый участник понимает свою задачу и знает, как помочь гостю в сложной ситуации' : 'Понять гостя' : f.role === 'author' ? sample === 'title' ? 'Александра Константинопольская, руководитель команды исследований пользовательского опыта' : 'Анна Иванова, исследователь' : body]))
}
/** Exploratory combinations establish capacity; they never become automatic
 * PASS by comparing a renderer's answer with itself. Positive/negative anchors
 * have independently specified expectations. */
export function qualityCases(p: ComponentProfile): LabCase[] {
  const cases: LabCase[] = shapes.flatMap(shape => (['short', 'medium', 'long', 'title', 'uneven', 'word'] as const).map(sample => ({
    id: `${shape.id}-${sample}`, name: `${shape.name} · ${sampleNames[sample]}`, content: sampleContent(p, sample),
    constraints: { width: shape.width, maxHeight: shape.maxHeight, widthMode: 'fill', heightMode: 'fill' },
    expect: sample === 'short' && ['square', 'landscape', 'tall'].includes(shape.id) ? 'fits' : 'explore',
  })))
  cases.push({ id: 'overflow', name: 'Ожидаемый отказ · переполнение', content: sampleContent(p, 'overflow'), constraints: { width: 320, maxHeight: 180, widthMode: 'fill', heightMode: 'hug' }, expect: 'needs-space' })
  const missing = sampleContent(p, 'short'); delete missing[p.fields[0].id]
  cases.push({ id: 'required', name: 'Ожидаемый отказ · нет обязательного поля', content: missing, constraints: { width: 800, maxHeight: 500, widthMode: 'fill', heightMode: 'hug' }, expect: 'incompatible' })
  for (const state of p.states) cases.push({ id: `state-${state}`, name: `Короткое содержание · ${state}`, content: sampleContent(p, 'short'), constraints: { width: state === 'vertical' ? 560 : 1000, maxHeight: state === 'compact' ? 360 : 900, allowedStates: [state], widthMode: 'fill', heightMode: 'hug' }, expect: 'fits' })
  return cases
}
