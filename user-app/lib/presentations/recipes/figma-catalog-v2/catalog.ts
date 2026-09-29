import captured from './source.json' with { type: 'json' }

export type FigmaNode = { id: string; name: string; type: string; x: number; y: number; w: number; h: number; layout?: string; gap?: number; pad?: number[]; primary?: string; counter?: string; visible?: boolean; radius?: number; fills?: { type: string; color?: { r: number; g: number; b: number } }[]; text?: string; size?: number; line?: { unit: string; value?: number }; children?: FigmaNode[] }
export const frames = captured.frames as FigmaNode[]
export const walk = (n: FigmaNode): FigmaNode[] => [n, ...(n.children ?? []).flatMap(walk)]
type Mapping = Record<string, string>
export type RecipeVariant = { frame: string; fields: Mapping; panels: Mapping; visuals: Mapping; aliasOf?: string }
export type CatalogFamily = { id: string; purpose: string; required: string[]; variants: RecipeVariant[]; manualFlow?: boolean }
const v = (frame: string, fields: Mapping, panels: Mapping = {}, visuals: Mapping = {}): RecipeVariant => {
  const root = frames.find(f => f.id === frame)!
  const common: Record<string, string> = { 'Раздел': 'context', 'Год': 'year', 'Тип материала': 'format', 'Текст метки': 'tag', 'Название исследования': 'footer', 'Источник': 'footer', 'Номер страницы': 'page' }
  for (const n of walk(root)) if (n.type === 'TEXT' && common[n.name]) fields[common[n.name]] = n.id
  return { frame, fields, panels, visuals }
}
const family = (id: string, purpose: string, required: string[], variants: RecipeVariant[], manualFlow = false): CatalogFamily => ({ id, purpose, required, variants, manualFlow })
const context = (ids: string[]) => Object.fromEntries(['context', 'year', 'tag1', 'tag2', 'tag3'].map((k, i) => [k, ids[i]]))
const triplets = (ids: string[][], prefix: string, keys = ['marker', 'heading', 'body']) => Object.fromEntries(ids.flatMap((row, i) => row.map((id, j) => [`${prefix}${i + 1}.${keys[j]}`, id])))
const numbered = (prefix: string, n: number, suffixes: string[]) => Array.from({ length: n }, (_, i) => suffixes.map(s => `${prefix}${i + 1}.${s}`)).flat()

/** Every captured frame has an executable state. Variants express authored
 * density changes; 29:210 is the wireframe explanation of 6:98, not a new style. */
export const figmaCatalog: CatalogFamily[] = [
  family('title', 'Перебивка: один крупный тезис у нижней границы, 1–6 строк.', ['title'], [
    v('1:2', { title: '5:2' }), v('5:3', { title: '5:4' }), v('6:6', { title: '6:7' }), v('6:9', { title: '6:10' }), v('6:18', { title: '6:19' }),
  ], true),
  family('title-support', 'Крупный заголовок и пояснение снизу.', ['title', 'support'], [v('6:26', { title: '6:27', support: '6:37' }), v('6:39', { title: '6:40', support: '6:41' })], true),
  family('semantic-graphic', 'Смысловая иллюстрация сверху, крупный тезис и подпись снизу; нужен ресурс.', ['title', 'support'], [v('6:98', { title: '6:99', support: '6:100' }, {}, { visual: '6:184' }), { ...v('29:210', { title: '29:211', support: '29:212' }, {}, { visual: '29:219' }), aliasOf: '6:98' }], true),
  family('context-title', 'Контекст сверху, 1–3 метки перед большим тезисом; пояснение необязательно.', ['title'], [
    v('6:43', { title: '6:44', ...context(['6:48', '6:50', '6:57', '6:60', '6:63']) }),
    v('6:65', { title: '6:67', support: '6:78', ...context(['6:68', '6:69', '6:72', '6:74', '6:76']) }),
    v('6:84', { title: '6:86', support: '6:96', ...context(['6:87', '6:88', '6:91', '6:93', '6:95']) }),
  ], true),
  family('dense-editorial', 'Контекст и метки, крупный тезис, два равноправных текстовых столбца.', ['title', 'body1', 'body2'], [v('6:114', { title: '6:116', body1: '6:126', body2: '6:128', ...context(['6:117', '6:118', '6:121', '6:123', '6:125']) })], true),
  family('text-heavy', 'Длинный заголовок, крупный подзаголовок и мелкая подпись.', ['title', 'support'], [v('6:130', { title: '6:132', support: '6:148', context: '6:133', year: '6:134', tag1: '6:137', footer: '6:142' })], true),
  family('single-visual', 'Слева контекст, заголовок и подзаголовок; справа одно большое изображение.', ['title', 'support'], [v('6:150', { title: '6:152', support: '6:154', context: '6:155', year: '6:156', tag1: '6:159', footer: '6:160' }, {}, { visual: '6:162' })], true),
  family('visual-mosaic', 'Инверсная перебивка: текст слева, три изображения в мозаике справа.', ['title', 'support'], [v('6:165', { title: '6:166', support: '6:167', context: '6:168', year: '6:169', tag1: '6:172', footer: '6:173' }, {}, { visual1: '6:176', visual2: '6:178', visual3: '6:181' })], true),
  family('intro', 'Тезис сверху, крупная мысль слева снизу и небольшой комментарий справа; 3 состояния плотности.', ['title', 'lead', 'comment'], [
    v('6:187', { title: '6:199', lead: '6:201', comment: '6:204' }), v('13:24', { title: '13:36', lead: '13:38', comment: '13:41' }), v('13:90', { title: '13:102', lead: '13:104', comment: '13:107' }),
  ]),
  family('intro-reverse', 'Крупный короткий тезис сверху, комментарий снизу слева и акцентная мысль справа.', ['title', 'lead', 'comment'], [v('13:2', { title: '13:14', lead: '13:16', comment: '13:19' })]),
  family('split-intro', 'Две колонки: заголовок с комментарием слева, акцентная мысль справа сверху.', ['title', 'lead', 'comment'], [v('13:46', { title: '13:58', lead: '13:60', comment: '13:63' })]),
  family('three-intro', 'Заголовок и три нижние колонки: акцентная мысль, два пояснения.', ['title', 'lead', 'body1', 'body2'], [v('13:68', { title: '13:80', lead: '13:133', body1: '13:85', body2: '13:118' })]),
  family('fact-visual', 'Один большой факт и подпись слева, фотография справа.', ['value', 'caption'], [v('21:364', { value: '21:376', caption: '21:379' }, {}, { visual: '21:380' })]),
  family('long-thesis', 'Длинный тезис, вывод снизу слева и контекст справа.', ['title', 'lead', 'comment'], [v('21:392', { title: '21:403', lead: '21:405', comment: '21:408' })]),
  family('quote', 'Цитата с автором; пояснение узкой колонкой справа. Только если исходник содержит цитату и атрибуцию.', ['quote', 'author', 'comment'], [v('21:412', { quote: '21:425', author: '21:426', comment: '21:429' })]),
  family('photo-note', 'Большая фотография слева, заголовок и подпись справа.', ['title', 'caption'], [v('21:493', { title: '21:514', caption: '21:517' }, {}, { visual: '21:504' })]),
  family('metric-visual', 'Крупная метрика, отдельная единица и пояснение слева; иллюстрация справа.', ['value', 'unit', 'caption'], [v('21:465', { value: '21:478', unit: '21:479', caption: '21:480' }, {}, { visual: '21:481' })]),
  family('text-columns', 'Три равноправные текстовые колонки: номер сверху, заголовок и абзац снизу.', numbered('column', 3, ['heading', 'body']), [v('21:433', triplets([['21:445', '21:448', '21:449'], ['21:451', '21:454', '21:455'], ['21:457', '21:460', '21:461']], 'column'))]),
  family('four-steps', 'Заголовок и четыре равноправных шага в библиотечных панелях; номер, название, описание.', ['title', ...numbered('step', 4, ['heading', 'body'])], [v('21:527', { title: '21:538', ...triplets([['21:541', '21:543', '21:544'], ['21:546', '21:548', '21:549'], ['21:551', '21:553', '21:554'], ['21:556', '21:558', '21:559']], 'step') }, { step1: '21:540', step2: '21:545', step3: '21:550', step4: '21:555' })]),
  family('comparison', 'Две стороны сравнения: по заголовку и три пункта на каждой.', ['left.heading', 'right.heading', ...numbered('left.item', 3, ['body']), ...numbered('right.item', 3, ['body'])], [v('21:563', { 'left.heading': '21:575', 'right.heading': '21:587', ...triplets([['21:578', '21:579'], ['21:581', '21:582'], ['21:584', '21:585']], 'left.item', ['marker', 'body']), ...triplets([['21:590', '21:591'], ['21:593', '21:594'], ['21:596', '21:597']], 'right.item', ['marker', 'body']) }, { left: '21:574', right: '21:586' })]),
  family('theses-visual', 'Четыре коротких тезиса в сетке 2×2 слева, смысловая схема справа.', numbered('item', 4, ['heading', 'body']), [v('21:601', triplets([['21:614', '21:616', '21:617'], ['21:619', '21:621', '21:622'], ['21:624', '21:626', '21:627'], ['21:629', '21:631', '21:632']], 'item'), { item1: '21:613', item2: '21:618', item3: '21:623', item4: '21:628' }, { visual: '21:633' })]),
  family('fact-explanations', 'Выделенный факт в левой панели и три объяснения справа.', ['fact', ...numbered('item', 3, ['heading', 'body'])], [v('21:645', { label: '21:657', fact: '21:658', ...triplets([['21:661', '21:662'], ['21:664', '21:665'], ['21:667', '21:668']], 'item', ['heading', 'body']) }, { fact: '21:656' })]),
  family('columns-photo', 'Заголовок и два плотных текстовых столбца слева, фото справа.', ['title', 'body1', 'body2'], [v('21:672', { title: '21:684', body1: '21:686', body2: '21:687' }, {}, { visual: '21:688' })]),
  family('feature-metrics', 'Главный тезис в большой левой панели и четыре метрики с подписями в сетке 2×2.', ['title', ...numbered('metric', 4, ['value', 'caption'])], [v('21:700', { label: '21:712', title: '21:713', comment: '21:714', ...triplets([['21:717', '21:718'], ['21:720', '21:721'], ['21:723', '21:724'], ['21:726', '21:727']], 'metric', ['value', 'caption']) }, { feature: '21:711', metric1: '21:716', metric2: '21:719', metric3: '21:722', metric4: '21:725' })]),
]
export const familyById = (id: string) => figmaCatalog.find(f => f.id === id)
export const catalogSummary = () => figmaCatalog.map(f => ({ family: f.id, purpose: f.purpose, requiredFields: f.required,
  optionalFields: [...new Set(f.variants.flatMap(v => Object.keys(v.fields)))].filter(s => !f.required.includes(s)),
  panels: Object.keys(f.variants[0].panels), visuals: Object.keys(f.variants[0].visuals), sourceFrames: f.variants.map(v => v.frame) }))
