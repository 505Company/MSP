import { collides, validateLayout } from 'react-grid-layout/core'
import type { ContentSlide, GridCell, SlidePlan } from './types'

// Horizontal guides are coarse; vertical tracks follow measured line heights.
// The renderer uses these exact values, including the two different gutters.
export const GRID = { columns: 12, rows: 48, width: 1920, height: 1080, padding: 48, gap: 24, verticalGap: 12, rowHeight: 8.75 }
export const gridRect = (c: GridCell) => ({ x: 48 + c.x * 154, y: 48 + c.y * 20.75, width: c.w * 154 - 24, height: c.h * 20.75 - 12 })
export const heightUnits = (height: number) => Math.max(1, Math.ceil((height + GRID.verticalGap) / (GRID.rowHeight + GRID.verticalGap)))
export type WidthMeasurements = Record<string, Record<number, number>>
type Block = ContentSlide['blocks'][number]
type Area = Omit<GridCell, 'i'>

export function validateGrid(grid: GridCell[], content: ContentSlide) {
  validateLayout(grid)
  if (grid.length !== content.blocks.length || new Set(grid.map(c => c.i)).size !== grid.length || content.blocks.some(b => !grid.some(c => c.i === b.id))) throw Error('Сетка потеряла или повторила блок.')
  for (const cell of grid) {
    if (![cell.x, cell.y, cell.w, cell.h].every(Number.isInteger) || cell.x < 0 || cell.y < 0 || cell.w < 1 || cell.h < 1 || cell.x + cell.w > GRID.columns || cell.y + cell.h > GRID.rows) throw Error('Блок выходит за поля слайда.')
    if (grid.some(other => other.i !== cell.i && collides(cell, other))) throw Error('Блоки пересекаются.')
    const block = content.blocks.find(b => b.id === cell.i)!
    if (block.placement === 'left' && cell.x + cell.w > 8 || block.placement === 'right' && cell.x < 4) throw Error('Нарушено указанное положение блока.')
    for (const other of content.blocks.filter(b => b.role === 'body' && b.id !== block.id)) {
      const target = grid.find(c => c.i === other.id)!
      if (block.placement === 'top' && target.y < cell.y || block.placement === 'bottom' && target.y + target.h > cell.y + cell.h) throw Error('Нарушено вертикальное положение блока.')
    }
  }
  const ordered = content.blocks.filter(b => b.role === 'body' && !b.placement)
  for (let i = 1; i < ordered.length; i++) {
    const a = grid.find(c => c.i === ordered[i - 1].id)!, b = grid.find(c => c.i === ordered[i].id)!
    if (b.y < a.y || b.y === a.y && b.x < a.x) throw Error('Изменён порядок чтения исходных блоков.')
  }
  return grid
}

function widths(total: number, count: number): number[][] {
  if (count === 1) return [[total]]
  const result: number[][] = []
  for (let w = 3; w <= total - 3 * (count - 1); w++) for (const tail of widths(total - w, count - 1)) result.push([w, ...tail])
  return result.sort((a, b) => Math.max(...a) - Math.min(...a) - (Math.max(...b) - Math.min(...b)))
}

/** Beam search over consecutive rows. Width choices use actual DOM heights,
 * never an estimate derived from character count. */
function partitions(blocks: Block[], area: Area, measurements: WidthMeasurements, preferredColumns: number): GridCell[][] {
  type State = { next: number; cells: GridCell[]; y: number; penalty: number }
  let beam: State[] = [{ next: 0, cells: [], y: area.y, penalty: 0 }]
  const complete: State[] = []
  for (let row = 0; row < blocks.length && beam.length; row++) {
    const following: State[] = []
    for (const state of beam) for (let count = 1; count <= Math.min(3, blocks.length - state.next, Math.floor(area.w / 3)); count++) {
      const group = blocks.slice(state.next, state.next + count)
      for (const tracks of widths(area.w, count)) {
        const heights = group.map((b, i) => measurements[b.id]?.[tracks[i]] ?? Infinity)
        const units = heightUnits(Math.max(...heights) + 16)
        if (!Number.isFinite(units) || state.y + units > area.y + area.h) continue
        let x = area.x
        const cells = group.map((b, i) => { const cell = { i: b.id, x, y: state.y, w: tracks[i], h: units }; x += tracks[i]; return cell })
        const vacant = heights.reduce((sum, h, i) => sum + (Math.max(...heights) - h) * tracks[i], 0) / 2000
        const penalty = state.penalty + Math.abs(count - preferredColumns) * .25 + vacant
        const next = { next: state.next + count, cells: [...state.cells, ...cells], y: state.y + units + 1, penalty }
        if (next.next === blocks.length) complete.push(next); else following.push(next)
      }
    }
    beam = following.sort((a, b) => a.penalty + (a.y - area.y) / 16 - b.penalty - (b.y - area.y) / 16).slice(0, 36)
  }
  return complete.sort((a, b) => a.penalty - b.penalty).slice(0, 16).map(s => s.cells)
}

function spread(cells: GridCell[], area: Area) {
  const rows = [...new Set(cells.map(c => c.y))].sort((a, b) => a - b)
  const bottom = Math.max(...cells.map(c => c.y + c.h)), spare = area.y + area.h - bottom
  return cells.map(c => ({ ...c, y: c.y + Math.round(spare * rows.indexOf(c.y) / Math.max(1, rows.length)), h: c.h + Math.floor(spare / Math.max(1, rows.length)) }))
}

export function layoutScore(grid: GridCell[], plan: SlidePlan, measured: WidthMeasurements) {
  let score = 0
  const body = plan.content.blocks.filter(b => b.role === 'body')
  for (const b of body) {
    const c = grid.find(c => c.i === b.id)!, rect = gridRect(c), needed = measured[b.id]?.[c.w] ?? Infinity
    if (needed > rect.height + 1) return -Infinity
    score -= Math.abs(needed / rect.height - (b.data ? .9 : b.kind === 'metric' ? .35 : .65)) * 3
    if (b.data || b.emphasis === 'primary' && body.some(b => b.emphasis !== 'primary')) score += c.w * .16
    if (plan.arrangement === 'focus-left' && b.emphasis === 'primary') score -= c.x * .4
    if (plan.arrangement === 'focus-right' && b.emphasis === 'primary') score += c.x * .4
    if (plan.arrangement === 'vertical') score += c.w * .07
    if (plan.arrangement === 'horizontal') score -= c.y * .05
  }
  const rowCount = new Set(body.map(b => grid.find(c => c.i === b.id)!.y)).size
  if (plan.arrangement === 'balanced') score -= rowCount * .6
  score -= Math.max(0, rowCount - 3) * 2
  return score
}

/** Own bounded measure/partition/rank engine. RGL checks rectangle collisions
 * and renders selected coordinates; no previous recipe solver is called. */
export function layoutCandidates(plan: SlidePlan, measurements: WidthMeasurements): GridCell[][] {
  const surface = plan.background?.area ?? { x: 0, y: 0, w: 12, h: 48 }
  const title = plan.content.blocks.find(b => b.role === 'title')!, footer = plan.content.blocks.filter(b => b.role === 'footer')
  const body = plan.content.blocks.filter(b => b.role === 'body').sort((a, b) => (a.placement === 'top' ? -1 : a.placement === 'bottom' ? 1 : 0) - (b.placement === 'top' ? -1 : b.placement === 'bottom' ? 1 : 0))
  const headHeight = heightUnits((measurements[title.id]?.[surface.w] ?? Infinity) + 20)
  const tailHeight = footer.length ? heightUnits((measurements[footer[0].id]?.[surface.w] ?? Infinity) + 8) : 0
  const area = { x: surface.x, y: surface.y + headHeight + 1, w: surface.w, h: surface.h - headHeight - tailHeight - (tailHeight ? 2 : 1) }
  if (!Number.isFinite(headHeight + tailHeight) || area.h < 0) return []
  const head: GridCell = { i: title.id, x: surface.x, y: surface.y, w: surface.w, h: headHeight }
  const tail: GridCell[] = footer.map(b => ({ i: b.id, x: surface.x, y: surface.y + surface.h - tailHeight, w: surface.w, h: tailHeight }))
  const result: GridCell[][] = [], seen = new Set<string>()
  const add = (cells: GridCell[]) => {
    const all = [head, ...cells, ...tail]
    try { validatePlanGrid(all, plan) } catch { return }
    const key = JSON.stringify(all); if (!seen.has(key)) { seen.add(key); result.push(all) }
  }
  if (!body.length) add([])
  const preferred = plan.arrangement === 'vertical' ? 1 : plan.arrangement === 'horizontal' ? 3 : Math.min(2, body.length)
  for (const cells of partitions(body, area, measurements, preferred)) { add(spread(cells, area)); add(cells) }
  if (body.some(b => b.placement === 'left' || b.placement === 'right')) {
    const left = body.filter(b => b.placement !== 'right'), right = body.filter(b => b.placement === 'right')
    if (left.length && right.length) for (const split of [4, 5, 6, 7, 8]) {
      const a = { ...area, w: split }, b = { ...area, x: split, w: 12 - split }
      for (const l of partitions(left, a, measurements, 1).slice(0, 3)) for (const r of partitions(right, b, measurements, 1).slice(0, 3)) add([...spread(l, a), ...spread(r, b)])
    }
  }
  return result.sort((a, b) => layoutScore(b, plan, measurements) - layoutScore(a, plan, measurements)).slice(0, 24)
}

export function validatePlanGrid(grid: GridCell[], plan: SlidePlan) {
  validateGrid(grid, plan.content)
  const a = plan.background?.area
  if (a && grid.some(c => c.x < a.x || c.y < a.y || c.x + c.w > a.x + a.w || c.y + c.h > a.y + a.h)) throw Error('Содержание перекрывает исходную графику фона.')
}
