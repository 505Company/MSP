export const LAYOUT_RECIPE_VERSION = 'layout-engine-v1.0'
export const LAYOUT_CANVAS = { width: 1920, height: 1080 }
export type Box = { x: number; y: number; width: number; height: number; fontSize?: number; lineHeight?: number; weight?: number; maxLines?: number; nowrap?: boolean; radius?: number; paddingX?: number }
export type SlideState = {
  id: string; family: string; section: number; primary: Box; context?: true; factsY?: number; wideInfo?: Box
  support?: Box[]; footer?: Box; visuals?: Box[]; innerSurface?: Box; localOrder: number
}
const text = (x: number, y: number, width: number, height: number, fontSize: number, lineHeight: number, maxLines: number, weight = 600): Box =>
  ({ x, y, width, height, fontSize, lineHeight, maxLines, weight })
const support = text(46, 800, 1826, 231, 64, 76.8, 3, 400)
const info: Box = { ...text(46, 209, 910, 94, 48, 57.6, 1, 400), radius: 16, paddingX: 80 }
const footer = text(46, 993, 794, 38, 32, 38.4, 1, 400)
const visualText = text(46, 340, 1049, 216, 72, 72, 3)
const visualSupport = text(46, 745, 910, 216, 72, 72, 3)

// Values are transcribed from SOURCE.txt, not interpolated or fitted to fixtures.
export const layoutStates: SlideState[] = [
  { id: 'title-1', family: 'title-only', section: 7, primary: { ...text(46, 805, 1828, 223, 184, 0, 1), nowrap: true }, localOrder: 1 },
  { id: 'title-2', family: 'title-only', section: 7, primary: text(46, 683, 1651, 348, 184, 174, 2), localOrder: 2 },
  { id: 'title-3', family: 'title-only', section: 7, primary: text(46, 509, 1828, 522, 184, 174, 3), localOrder: 3 },
  { id: 'title-4', family: 'title-only', section: 7, primary: text(46, 335, 1828, 696, 184, 174, 4), localOrder: 4 },
  { id: 'title-extreme', family: 'title-only', section: 7, primary: text(46, 287, 1828, 744, 140, 124, 6), localOrder: 5 },
  { id: 'title-support-a', family: 'title-support', section: 8, primary: text(46, 420, 1343, 348, 184, 174, 2), support: [support], localOrder: 1 },
  { id: 'title-support-b', family: 'title-support', section: 8, primary: text(46, 246, 1828, 522, 184, 174, 3), support: [support], localOrder: 2 },
  { id: 'context-facts-title', family: 'context-facts-title', section: 11, context: true, factsY: 378, primary: text(46, 509, 1828, 522, 184, 174, 3), localOrder: 1 },
  { id: 'context-facts-support', family: 'context-facts-support', section: 12, context: true, factsY: 374, primary: text(46, 505, 1828, 280, 140, 140, 2), support: [support], localOrder: 1 },
  { id: 'context-facts-long', family: 'context-facts-support', section: 13, context: true, factsY: 233, primary: text(46, 368, 1828, 400, 100, 100, 4), support: [support], localOrder: 2 },
  { id: 'semantic-graphic', family: 'semantic-graphic', section: 15, primary: text(46, 497, 1826, 348, 184, 174, 2), support: [text(46, 877, 1123, 154, 64, 76.8, 2, 400)], visuals: [{ x: 46, y: 49, width: 1301, height: 416 }], localOrder: 1 },
  { id: 'dense-editorial', family: 'dense-editorial', section: 16, context: true, factsY: 209, primary: text(46, 340, 1828, 280, 140, 140, 2), support: [text(46, 652, 794, 342, 32, 38.4, 8, 400), text(872, 652, 794, 342, 32, 38.4, 8, 400)], localOrder: 1 },
  { id: 'text-heavy', family: 'text-heavy', section: 20, context: true, wideInfo: info, primary: text(46, 340, 1828, 420, 140, 140, 3), support: [text(46, 792, 1828, 144, 72, 72, 2)], footer, localOrder: 1 },
  { id: 'single-visual', family: 'single-visual', section: 21, context: true, wideInfo: info, primary: visualText, support: [visualSupport], footer, visuals: [{ x: 1021, y: 16, width: 883, height: 1048 }], localOrder: 1 },
  { id: 'visual-mosaic', family: 'visual-mosaic', section: 22, context: true, wideInfo: info, primary: visualText, support: [visualSupport], footer,
    innerSurface: { x: 16, y: 16, width: 1888, height: 1048 }, visuals: [{ x: 1051, y: 213, width: 380, height: 817, radius: 6 }, { x: 1463, y: 213, width: 384, height: 457, radius: 6 }, { x: 1463, y: 702, width: 384, height: 328, radius: 6 }], localOrder: 1 },
]
export const contextBoxes = [text(46, 49, 380, 58, 48, 57.6, 1, 400), text(578, 49, 111, 58, 48, 57.6, 1, 400)]
// Section 9 permits neighbour rebalance: one context can use the otherwise empty
// connector/right-hand area, without moving the group's outside anchors.
export const layoutContextBoxes = (wide = false): Box[] => wide
  ? [{ ...contextBoxes[0], width: contextBoxes[1].x + contextBoxes[1].width - contextBoxes[0].x }]
  : contextBoxes
export const factBoxes = (y: number): Box[] => [[46, 321], [400, 532], [962, 361]].map(([x, width]) => ({ ...text(x, y, width, 94, 48, 57.6, 1, 400), radius: 16, paddingX: 80 }))
export const stateById = (id: string) => layoutStates.find(s => s.id === id)
export function adaptationLevel(from: SlideState, to: SlideState): 0 | 1 | 2 | 3 {
  if (from.id === to.id) return 0
  if (from.family === to.family) return from.family === 'context-facts-support' ? 2 : 1
  if (from.family.startsWith('context-facts') && to.family.startsWith('context-facts')) return 2
  return 3
}
