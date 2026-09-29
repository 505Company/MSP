import { editableTableLayout } from '../lib/design-system/editable-table'
import { renderEditableHtml } from '../lib/design-system/editable-render'
import type { EditableData, EditableTemplate } from '../lib/design-system/editable-contract'

const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const decimal = (v: number) => String(v).replace('.', ',')
const luminance = (hex: string) => [1, 3, 5].reduce((n, at, i) => { const v = parseInt(hex.slice(at, at + 2), 16) / 255; return n + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i] }, 0)
const visible = (color: string, background: string) => /^#[\da-f]{6}$/i.test(color) && (Math.max(luminance(color), luminance(background)) + .05) / (Math.min(luminance(color), luminance(background)) + .05) >= 3

function tableInstance(source: EditableTemplate, values: EditableData, width: number, scale: number) {
  const template = structuredClone(source), data = structuredClone(values)
  const size = Math.max(24, Math.round(Math.max(28, Math.min(32, source.style.fontSize ?? 28)) * scale))
  template.style.fontSize = size
  const rows = [data.columns!, ...data.rows!], ctx = document.createElement('canvas').getContext('2d')!
  const minimum = rows[0].map((_, c) => Math.max(...rows.map((row, r) => {
    ctx.font = `${r ? 400 : 700} ${size}px ${JSON.stringify(template.style.font)}`
    return Math.max(0, ...(row[c] ?? '').split(/\s+/).map(word => ctx.measureText(word).width)) + size + 4
  })))
  const sum = minimum.reduce((a, b) => a + b, 0), spare = Math.max(0, width - 2 * (template.style.padding ?? 20) - sum) / minimum.length
  template.columnWidths = minimum.map(w => (w + spare) / (sum + spare * minimum.length) * 100)
  // Preserve source fills, borders and typography. Sample merges cannot hide
  // cells in a new dataset, and sample column widths do not constrain new data.
  template.tableStyles = editableTableLayout(template, data).styles.map((row, r) => row.map((style, c) => ({ ...style, hidden: false, colSpan: 1, rowSpan: 1, bold: r === 0 || style.bold, align: rows.slice(1).every(v => /^[+−-]?\d[\d\s.,%]*$/.test(v[c] ?? '')) ? 'right' : 'left' })))
  data.rowKeys = data.rows!.map((_, i) => i)
  return { template, data }
}

function chartHtml(template: EditableTemplate, data: EditableData, width: number, height: number) {
  const s = template.style, cats = data.categories!, series = data.series!, type = template.config.chartType ?? 'bar'
  const ink = s.color ?? '#111111', font = s.font ?? 'Arial'
  const palette = [...new Set([...(s.palette ?? []), s.accent ?? ink, ink])].filter(c => visible(c, s.background ?? '#ffffff'))
  const colors = palette.length ? palette : [ink]
  const seriesColor = (i: number) => series[i].color && visible(series[i].color!, s.background ?? '#ffffff') ? series[i].color! : colors[i % colors.length]
  const ctx = document.createElement('canvas').getContext('2d')!; ctx.font = `22px ${JSON.stringify(font)}`
  const measure = (text: string) => ctx.measureText(text).width
  const words = (text: string, available: number) => {
    const lines: string[] = []
    for (const word of text.split(/\s+/)) {
      if (measure(word) > available) throw Error('Подпись графика требует более широкой области: ' + word)
      if (!lines.length || measure(lines.at(-1)! + ' ' + word) > available) lines.push(word); else lines[lines.length - 1] += ' ' + word
    }
    return lines
  }
  const label = (text: string, x: number, y: number, anchor = 'start', size = 22, attrs = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${ink}" ${attrs}>${escape(text)}</text>`
  const legendLines = series.length > 1 ? series.map(ser => words(ser.name, width - 56)) : []
  const legendHeight = legendLines.reduce((n, lines) => n + lines.length * 28 + 8, 0)
  let legendY = height - legendHeight
  const legend = legendLines.map((lines, i) => { const y = legendY; legendY += lines.length * 28 + 8; return `<rect x="8" y="${y + 5}" width="16" height="16" fill="${seriesColor(i)}"/>` + lines.map((line, n) => label(line, 34, y + 22 + 28 * n)).join('') }).join('')
  const fullHeight = height - legendHeight - (legendHeight ? 16 : 0)
  let graphic = ''
  if (type === 'pie' || type === 'donut') {
    if (series.length !== 1 || series[0].values.some(v => v === null || v < 0)) throw Error('Круговая диаграмма требует одного ряда неотрицательных значений без пропусков.')
    const values = series[0].values as number[], total = values.reduce((a, b) => a + b, 0)
    if (!total) throw Error('В круговой диаграмме сумма значений должна быть больше нуля.')
    const diameter = Math.min(width * .48, fullHeight - 32), radius = diameter / 2, cx = radius + 8, cy = fullHeight / 2
    if (diameter < 200) throw Error('Круговой диаграмме требуется больше места.')
    let angle = -Math.PI / 2, y = 24
    graphic = values.map((value, i) => {
      const span = value / total * Math.PI * 2, end = angle + span
      const arc = value === total ? `<circle cx="${cx}" cy="${cy}" r="${radius}"` : `<path d="M${cx},${cy} L${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius} A${radius},${radius} 0 ${span > Math.PI ? 1 : 0},1 ${cx + Math.cos(end) * radius},${cy + Math.sin(end) * radius} Z"`
      angle = end
      const lines = words(`${cats[i]} — ${decimal(value)}`, width - diameter - 48)
      const labels = lines.map((line, n) => label(line, diameter + 44, y + n * 28)).join(''); y += lines.length * 28 + 18
      return `${arc} fill="${colors[i % colors.length]}" data-value="${value}"><title>${escape(cats[i])}: ${escape(decimal(value))}</title></${value === total ? 'circle' : 'path'}><rect x="${diameter + 18}" y="${y - lines.length * 28 - 34}" width="16" height="16" fill="${colors[i % colors.length]}"/>${labels}`
    }).join('')
    if (y > fullHeight + 10) throw Error('Все подписи круговой диаграммы не помещаются.')
    if (type === 'donut') graphic += `<circle cx="${cx}" cy="${cy}" r="${radius * .58}" fill="${s.background ?? '#ffffff'}"/>`
  } else {
    const values = series.flatMap(s => s.values.filter((v): v is number => v !== null))
    const low = Math.min(0, ...values), high = Math.max(1, ...values), range = high - low
    const min = low < 0 ? low - range * .06 : 0, max = high + range * .1
    const ticks = Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4)
    const tickText = ticks.map(n => decimal(Number(n.toPrecision(4))))
    const left = Math.ceil(Math.max(...tickText.map(measure))) + 20, right = 24, top = 36, plotWidth = width - left - right
    const step = plotWidth / cats.length
    if (step < 32 || plotWidth < 240) throw Error('Графику требуется более широкая область.')
    const categoryLines = cats.map(cat => words(cat, step - 12)), bottom = Math.max(...categoryLines.map(l => l.length)) * 28 + 24
    const plotHeight = fullHeight - top - bottom
    if (plotHeight < 160) throw Error('Графику требуется больше высоты для данных и подписей.')
    const x = (i: number) => left + step * (i + .5), y = (v: number) => top + plotHeight * (max - v) / (max - min)
    graphic = ticks.map((v, i) => `<path d="M${left},${y(v)} H${width - right}" fill="none" stroke="${s.border ?? '#d6dce2'}"/>` + label(tickText[i], left - 12, y(v) + 7, 'end')).join('')
    const labels: { x: number; y: number; width: number }[] = []
    for (const [si, ser] of series.entries()) {
      const color = seriesColor(si), segments: { x: number; y: number }[][] = [[]]
      for (const [i, v] of ser.values.entries()) {
        if (v === null) { if (segments.at(-1)!.length) segments.push([]); continue }
        const bx = x(i), by = y(v), bw = step * .72 / series.length, barX = left + i * step + step * .14 + si * bw
        const title = `<title>${escape(ser.name)} · ${escape(cats[i])}: ${escape(decimal(v))}</title>`
        graphic += type === 'bar' ? `<rect x="${barX}" y="${Math.min(y(0), by)}" width="${bw}" height="${Math.abs(y(0) - by)}" fill="${color}" data-value="${v}">${title}</rect>` : `<circle cx="${bx}" cy="${by}" r="4" fill="${color}" data-value="${v}">${title}</circle>`
        segments.at(-1)!.push({ x: bx, y: by })
        if (template.config.labels && series.length * cats.length <= 18) {
          const text = decimal(v), lx = type === 'bar' ? barX + bw / 2 : bx, w = measure(text)
          const ly = [by - 12, by + 28, by - 40, by + 56].find(y => y >= 22 && y <= top + plotHeight - 8 && !labels.some(p => Math.abs(p.y - y) < 24 && Math.abs(p.x - lx) < (p.width + w) / 2 + 8))
          if (ly === undefined) throw Error('Числовые подписи графика пересекаются; нужна более широкая область.')
          labels.push({ x: lx, y: ly, width: w }); graphic += label(text, lx, ly, 'middle')
        }
      }
      if (type !== 'bar') graphic += segments.filter(s => s.length).map(points => `<path data-series="${escape(ser.name)}" d="M${points.map(p => `${p.x},${p.y}`).join(' L')}${type === 'area' ? ` L${points.at(-1)!.x},${y(0)} L${points[0].x},${y(0)} Z` : ''}" fill="${type === 'area' ? color : 'none'}" fill-opacity=".2" stroke="${color}" stroke-width="3" ${si >= colors.length ? 'stroke-dasharray="8 5"' : ''}/>`).join('')
    }
    graphic += categoryLines.map((lines, i) => lines.map((line, n) => label(line, x(i), top + plotHeight + 30 + n * 28, 'middle')).join('')).join('')
  }
  return `<svg data-msp-chart viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(data.title ?? template.name)}" style="display:block;overflow:visible;font-family:${escape(JSON.stringify(font))}">${graphic}${legend}</svg>`
}

export function drawData(box: HTMLElement, source: EditableTemplate, values: EditableData, width: number, height: number, scale: number) {
  if (source.kind === 'table') {
    const { template, data } = tableInstance(source, values, width, scale)
    box.innerHTML = renderEditableHtml(template, data, { width, height })
    const actual = [...box.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent ?? ''))
    if (JSON.stringify(actual) !== JSON.stringify([values.columns, ...values.rows ?? []])) throw Error('Изменились ячейки таблицы.')
  } else if (source.kind === 'chart') box.innerHTML = chartHtml(source, values, width, height)
  else throw Error('Неподдерживаемый тип данных.')
}
