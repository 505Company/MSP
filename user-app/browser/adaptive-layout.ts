import { toPng } from 'html-to-image'
import { adaptiveCandidates, adaptiveIssues, adaptiveInset, adaptiveSpan, adaptiveRules, adaptiveTexts, adaptiveTypography, adaptiveRenderVersion, adaptivePanelColors, usesAdaptiveGrid, usesPanelColors, type AdaptivePlan, type AdaptiveRender, type AdaptiveTrial } from '../lib/presentations/adaptive-layout'
import type { LayoutInput } from '../lib/presentations/layout-contract'
import { textGeometry, verifyLayoutPreview } from './layout-execution'
import { componentHtml, measureAdaptiveComponents, verifyComponentPixels } from './adaptive-components'
import { prepareLayoutFonts } from './layout-fonts'
import { ADAPTIVE_FLOW_RENDER, ADAPTIVE_GRID_RENDER, componentColumns } from '../lib/presentations/adaptive-components'
import { allocateAdaptiveGrid } from './adaptive-grid'
import { PREPARED_BOX_RENDER, PREPARED_BOX_VERSION } from '../lib/presentations/prepared-components'
import { preparedResources } from './prepared-components'

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
function render(plan: AdaptivePlan, input: LayoutInput, candidate: { columns: number; fontStep: number }, grid: boolean, flow = false) {
  const { width, height, margin, gap, textGap, minWidth, minHeight } = adaptiveRules, texts = adaptiveTexts(plan, input)
  const color = (role: keyof AdaptivePlan['colors']) => input.colors.find(c => c.id === plan.colors[role])!.hex
  const family = input.fonts.find(f => f.id === plan.fontToken)!.family
  const text = (id: string) => {
    const t = texts.find(t => t.id === id)!, size = adaptiveTypography[t.role][candidate.fontStep]
    return `<div data-layout-text data-layout-block="${id}" data-adaptive-owner="${t.box}" data-role="${t.role}" style="flex:0 0 auto;min-width:0;white-space:pre-line;overflow-wrap:anywhere;font-size:${size}px;line-height:1.22;font-weight:${t.role === 'title' || t.role === 'heading' || t.role === 'metric' ? 600 : 400};">${escape(t.text)}</div>`
  }
  const rows = Array.from({ length: Math.ceil(plan.blocks.length / candidate.columns) }, (_, row) => {
    const blocks = plan.blocks.slice(row * candidate.columns, (row + 1) * candidate.columns).map((b, j) => {
      const i = row * candidate.columns + j, paint = adaptivePanelColors(b, plan)
      const background = paint.background ? input.colors.find(c => c.id === paint.background)!.hex : 'transparent'
      const foreground = input.colors.find(c => c.id === paint.foreground)!.hex
      const parts = b.parts.map((p, j) => {
        const id = `block-${i}-part-${j}`, html = p.component ? componentHtml(p.component, input, grid, flow, plan.version === PREPARED_BOX_VERSION) : text(id)
        return plan.version ? `<div data-adaptive-unit="${id}" style="flex:0 0 auto;min-width:0;">${html}</div>` : html
      }).join('')
      return `<section data-adaptive-box="block-${i}" data-row="${row}" style="box-sizing:border-box;flex:1 1 0;${grid ? `grid-column:span ${adaptiveSpan(i, plan.blocks.length, candidate.columns)};` : ''}min-width:${minWidth}px;min-height:${minHeight}px;padding:${adaptiveInset(b, grid)}px;border-radius:8px;background:${background};color:${foreground};"><div data-adaptive-content style="display:flex;flex-direction:column;gap:${textGap}px;">${parts}</div></section>`
    }).join('')
    return `<div data-adaptive-row="${row}" style="display:${grid ? 'grid' : 'flex'};${grid ? `grid-template-columns:repeat(${candidate.columns},minmax(${minWidth}px,1fr));` : ''}gap:${gap}px;flex:1 1 0;min-height:${minHeight}px;">${blocks}</div>`
  }).join('')
  return `<div data-adaptive-root style="width:${width}px;height:${height}px;box-sizing:border-box;padding:${margin}px;display:flex;flex-direction:column;gap:${gap}px;background:${color('background')};color:${color('primary')};font-family:'${escape(family)}';letter-spacing:0;overflow:hidden;">
    <header data-adaptive-box="title" data-row="-1" style="flex:0 0 auto;">${text('title')}</header>
    <main data-adaptive-body style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;gap:${gap}px;">${rows}</main>
    ${plan.footer.length ? `<footer data-adaptive-box="footer" data-row="-2" style="flex:0 0 auto;color:${color('secondary')};">${text('footer')}</footer>` : ''}</div>`
}
function allocate(root: HTMLElement, plan: AdaptivePlan, input: LayoutInput, step: number) {
  // Browser Flexbox owns the constraints. Measured intrinsic demand supplies
  // bounded growth weights, never coordinates or edits to semantic content.
  for (const row of root.querySelectorAll<HTMLElement>('[data-adaptive-row]')) {
    const blocks = [...row.children] as HTMLElement[], heights = blocks.map(b => b.firstElementChild!.getBoundingClientRect().height)
    const minimum = Math.max(1, Math.min(...heights))
    blocks.forEach((b, i) => { b.style.flexGrow = String(Math.min(2.5, Math.sqrt(heights[i] / minimum))) })
  }
  if (plan.version) for (const [i, block] of plan.blocks.entries()) {
    const node = root.querySelector<HTMLElement>(`[data-adaptive-box="block-${i}"] [data-adaptive-content]`)!
    const columns = componentColumns(block.parts, input, node.getBoundingClientRect().width, step)
    if (columns > 1) {
      node.style.display = 'grid'; node.style.gridTemplateColumns = `repeat(${columns},minmax(0,1fr))`; node.style.alignItems = 'start'
      block.parts.forEach((p, j) => { if (!p.component) (node.children[j] as HTMLElement).style.gridColumn = '1 / -1' })
    }
  }
  for (const row of root.querySelectorAll<HTMLElement>('[data-adaptive-row]')) {
    const demand = Math.max(...[...row.querySelectorAll('[data-adaptive-content]')].map(b => b.getBoundingClientRect().height)) + adaptiveRules.padding * 2
    row.style.flexGrow = String(Math.max(adaptiveRules.minHeight, demand))
  }
}
async function measure(root: HTMLElement, plan: AdaptivePlan, input: LayoutInput, candidate: { columns: number; fontStep: number }, renderVersion: string): Promise<AdaptiveTrial> {
  const origin = root.getBoundingClientRect(), rect = (r: DOMRect) => ({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height })
  const trial: AdaptiveTrial = { ...candidate, boxes: [...root.querySelectorAll<HTMLElement>('[data-adaptive-box]')].map(node => ({ ...rect(node.getBoundingClientRect()), id: node.dataset.adaptiveBox!, row: Number(node.dataset.row) })), texts: [], issues: [] }
  if (plan.version) {
    trial.components = await measureAdaptiveComponents(root, plan, input, candidate.fontStep, { fillWidth: usesAdaptiveGrid(renderVersion), flow: [ADAPTIVE_FLOW_RENDER, PREPARED_BOX_RENDER].includes(renderVersion) })
    trial.units = [...root.querySelectorAll<HTMLElement>('[data-adaptive-unit]')].map(n => ({ id: n.dataset.adaptiveUnit!, ...rect(n.getBoundingClientRect()) }))
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-layout-text]')) {
    const geometry = textGeometry(node), style = getComputedStyle(node), ink = geometry.ink
    const left = Math.min(...ink.map(r => r.left)), top = Math.min(...ink.map(r => r.top))
    const bounds = ink.length ? new DOMRect(left, top, Math.max(...ink.map(r => r.right)) - left, Math.max(...ink.map(r => r.bottom)) - top) : node.getBoundingClientRect()
    trial.texts.push({ id: node.dataset.layoutBlock!, box: node.dataset.adaptiveOwner!, role: node.dataset.role as AdaptiveTrial['texts'][number]['role'], text: node.textContent ?? '',
      ...rect(node.getBoundingClientRect()), scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, fontSize: parseFloat(style.fontSize),
      lines: geometry.lines, ink: rect(bounds) })
  }
  trial.issues = adaptiveIssues(trial, plan, input, renderVersion)
  return trial
}
export async function fitAdaptiveLayout(input: LayoutInput, plan: AdaptivePlan, planHash: string, options: { fontCss?: string; signal?: AbortSignal; renderVersion?: typeof ADAPTIVE_GRID_RENDER } = {}): Promise<AdaptiveRender> {
  const renderVersion = options.renderVersion ?? adaptiveRenderVersion(plan.version), grid = usesAdaptiveGrid(renderVersion), flow = [ADAPTIVE_FLOW_RENDER, PREPARED_BOX_RENDER].includes(renderVersion)
  if (options.renderVersion && usesPanelColors(plan.version)) throw Error('PANEL_COLORS_REQUIRE_CURRENT_RENDERER')
  if (grid && !plan.version) throw Error('ADAPTIVE_GRID_REQUIRES_COMPONENT_PLAN')
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-22000px;top:0;width:1920px;pointer-events:none;'; host.setAttribute('aria-hidden', 'true'); document.body.appendChild(host)
  const trials: AdaptiveTrial[] = []
  try {
    await document.fonts.ready
    const family = input.fonts.find(f => f.id === plan.fontToken)!.family
    if (![...document.fonts].some(f => f.status === 'loaded' && f.family.replace(/^["']|["']$/g, '') === family)) throw Error('FONT_TOKEN_UNAVAILABLE')
    let flowFontCss=''
    if (plan.version === PREPARED_BOX_VERSION) for (const id of [...new Set(plan.blocks.flatMap(b => b.parts.flatMap(p => p.component ? [p.component.id] : [])))]) {
      const pin = input.preparedComponents?.[id]
      if (pin) flowFontCss += (await preparedResources(input.uploadId, pin)).css
    }
    if(flow && Object.keys(input.componentFlows ?? {}).length) {
      const families=[...new Set(input.components.filter(t=>input.componentFlows?.[t.id]).flatMap(t=>t.sourceLayout!.text.flatMap(s=>[s.element.fontFamily,...s.element.styleRuns?.map(r=>r.fontFamily)??[]])))]
      const fonts=await prepareLayoutFonts({uploadId:input.uploadId,fonts:families.map((family,i)=>({id:`flow-${i}`,family}))})
      if(fonts.fontTokens.length!==families.length)throw Error('COMPONENT_SOURCE_FONT_UNAVAILABLE')
      flowFontCss+=Object.values(fonts.css).join('\n')
    }
    for (const candidate of adaptiveCandidates(plan)) {
      options.signal?.throwIfAborted()
      host.innerHTML = render(plan, input, candidate, grid, flow)
      const root = host.firstElementChild as HTMLElement
      if (grid) {
        await measureAdaptiveComponents(root, plan, input, candidate.fontStep, { fillWidth: true, fitText: true, flow })
        await allocateAdaptiveGrid(root, plan, input, candidate.columns, flow ? () => measureAdaptiveComponents(root,plan,input,candidate.fontStep,{fillWidth:true,fitText:true,flow}) : undefined)
      } else allocate(root, plan, input, candidate.fontStep)
      trials.push(await measure(root, plan, input, candidate, renderVersion))
      if (!trials.at(-1)!.issues.length) break
    }
    const root = host.firstElementChild as HTMLElement, passed = !trials.at(-1)!.issues.length
    options.signal?.throwIfAborted()
    const capture = async () => { if (window.__mspCaptureLayout) {
      const id = crypto.randomUUID(); root.dataset.layoutCapture = id
      host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;z-index:2147483647;pointer-events:none;'
      return window.__mspCaptureLayout(id)
    } else return toPng(root, { canvasWidth: 1280, canvasHeight: 720, pixelRatio: 1, fontEmbedCSS: (options.fontCss ?? '') + flowFontCss, skipAutoScale: true }) }
    const preview = await capture()
    const previewCheck = passed ? await verifyLayoutPreview(root, preview) : undefined
    if (previewCheck) previewCheck.textBlocks.push(...await verifyComponentPixels(root, preview, trials.at(-1)!, capture))
    return { fit: { version: renderVersion, planHash, passed, trials, ...(previewCheck ? { previewCheck } : {}) }, preview }
  } finally { host.remove() }
}
