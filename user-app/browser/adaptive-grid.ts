import { adaptiveInset, adaptiveRules, adaptiveSpan, type AdaptivePlan } from '../lib/presentations/adaptive-layout'
import { componentColumns } from '../lib/presentations/adaptive-components'
import type { LayoutInput } from '../lib/presentations/layout-contract'

export async function allocateAdaptiveGrid(root: HTMLElement, plan: AdaptivePlan, input: LayoutInput, columns: number, onReflow?: () => Promise<unknown>) {
  const { gap, textGap, minHeight, minWidth } = adaptiveRules
  const rows = [...root.querySelectorAll<HTMLElement>('[data-adaptive-row]')]
  const blocks = plan.blocks.map((_, i) => root.querySelector<HTMLElement>(`[data-adaptive-box="block-${i}"]`)!)
  const contents = blocks.map(b => b.firstElementChild as HTMLElement)
  const reflow = () => contents.forEach((node, i) => {
    const parts = plan.blocks[i].parts
    const steps = parts.map((_, j) => Number(node.children[j].querySelector<HTMLElement>('[data-adaptive-component]')?.dataset.adaptiveFontStep ?? 0))
    const count = componentColumns(parts, input, node.getBoundingClientRect().width, 0, true, false, steps)
    node.style.display = 'grid'
    node.style.gridTemplateColumns = `repeat(${count},minmax(0,1fr))`
    node.style.gap = `${textGap}px`
    node.style.alignItems = 'start'
    parts.forEach((p, j) => { (node.children[j] as HTMLElement).style.gridColumn = p.component ? '' : '1 / -1' })
  })
  // All rows share tracks. Re-measure after the inner cards reflow, then use
  // bounded intrinsic-area weights, not independent row-specific widths.
  let weights = Array<number>(columns).fill(1)
  for (let pass = 0; pass < 3; pass++) {
    reflow(); await onReflow?.()
    const demand = Array<number>(columns).fill(1)
    contents.forEach((content, i) => {
      const box = content.getBoundingClientRect(), span = adaptiveSpan(i, blocks.length, columns)
      const area = (box.height + adaptiveInset(plan.blocks[i], true) * 2) * box.width / span
      for (let col = i % columns; col < i % columns + span; col++) demand[col] = Math.max(demand[col], area)
    })
    const minimum = Math.min(...demand)
    weights = weights.map((w, col) => (w + Math.min(2.5, Math.sqrt(demand[col] / minimum))) / 2)
    for (const row of rows) row.style.gridTemplateColumns = weights.map(w => `minmax(${minWidth}px,${w}fr)`).join(' ')
  }
  reflow(); await onReflow?.()
  // Hug intrinsic row demand first, then share remaining height. Overflow is
  // still rejected by measurements, never hidden by reducing fixed gaps.
  for (const [r, row] of rows.entries()) {
    const heights = contents.slice(r * columns, (r + 1) * columns).map((c, j) => c.getBoundingClientRect().height + 2 * adaptiveInset(plan.blocks[r * columns + j], true))
    row.style.flexBasis = `${Math.max(minHeight, ...heights)}px`
    row.style.flexGrow = '1'
    row.style.gap = `${gap}px`
  }
}
