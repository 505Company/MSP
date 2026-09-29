import {artDirectedCandidates} from './art-direction'
import { bindCompactData, validateCompact, compactPackets, type SlidePacket } from './compact-content'
import { fastContentReply } from './fast-content'
import type { ContentSlide, ContentBlock, StudioRun, SlideWork, StudioLibrary } from './contract'
import type { EditableTemplate } from '../../design-system/editable-contract'
import { candidatesFor } from './recipes'
import { componentBindings } from './bindings'
import { libraryCoverCandidates } from './visual-design'

export const FALLBACK_VERSION = 3

export function hasLegacyContent(run: StudioRun, work: SlideWork) {
  if (work.fallback || run.variation || run.semantic || work.content.blocks.some(b=>b.data)) return false
  const title=work.content.blocks.find(b=>b.role==='title'),next=work.content.blocks.find(b=>b.role==='body')
  return work.content.blocks.some(b=>Object.values(b.fields).some(t=>t.includes('\t')))
    || !!title&&/[,—–-]$/.test(title.source)&&!!next&&/^\p{Ll}/u.test(next.fields.heading??'')
}

export function needsLocalRecovery(run:StudioRun,work?:SlideWork) {
  return !!work&&(hasLegacyContent(run,work)||work.fallback?.page===1&&!!work.fallback.source&&(work.fallback.version??0)<FALLBACK_VERSION)
}

function localContent(packet:SlidePacket,library:StudioLibrary){
  const checked=validateCompact(fastContentReply(packet),packet)
  try{return bindCompactData(checked,library)}catch{
    return {...checked.content,blocks:checked.content.blocks.map(b=>{
      const material=checked.materials[b.id];if(!material)return b
      const template:EditableTemplate={id:`fallback-data-${b.id}`,kind:material.kind,name:material.title||'Данные',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:1760,height:700,style:{font:library.tokens.fonts[0]?.family??'Arial',fontSize:28},data:material.data,config:material.config,graphicHtml:{},dataStatus:'native'}
      return {...b,data:{template,values:material.data}}
    })}
  }
}

export type FallbackItem = { id: string; field: string; text: string; kind: ContentBlock['kind']; role: ContentBlock['role']; data?: ContentBlock['data'] }
export type FallbackPiece = { item: string; start: number; end: number; render: 'text' | 'native' }

/** A failed model response is never used as content. Prefer validated work;
 * otherwise derive a local, lossless version from the run's frozen source. */
export function fallbackSource(run: StudioRun, slideId: string): ContentSlide {
  const work = run.slides.find(s => s.content.id === slideId)
  if (work?.fallback?.source) return work.fallback.source
  if (work&&hasLegacyContent(run,work)) {
    const packet=compactPackets('Слайд 1\n'+work.content.blocks.map(b=>b.source).join('\n\n'))[0]
    // Source spans and tab-separated cells survive the legacy interpreter;
    // repair their structure from that frozen text, never today's edited form.
    return {...localContent(packet,run.library),id:slideId}
  }
  if (work?.content.blocks.length) return work.content
  const packet = run.semantic?.units?.find(u => u.id === slideId)?.packet
  if (!packet) throw Error('Не найдено исходное содержание слайда.')
  try { return localContent(packet,run.library) }
  catch {
    // Even a library without a compatible data component can display literal
    // source tables. No model output or guessed values enter this branch.
    const first = packet.atoms[0]?.text, body = packet.atoms.slice(1).map(a => a.text).join('\n')
    const blocks: ContentBlock[] = [
      ...first ? [{ id: 'b1', kind: 'text' as const, role: 'title' as const, fields: { text: first }, source: first }] : [],
      ...body ? [{ id: 'b2', kind: 'text' as const, role: 'body' as const, fields: { text: body }, source: body }] : [],
      ...packet.tables.map((t, i): ContentBlock => {
        const values = { columns: t.columns, rows: t.rows }
        const template: EditableTemplate = { id: `fallback-table-${i + 1}`, kind: 'table', name: t.title ?? 'Таблица', description: '', tags: [], slide: 1, sourceIds: [], memberIds: [], width: 1760, height: 700, style: { font: run.library.tokens.fonts[0]?.family ?? 'Arial', fontSize: 28 }, data: values, config: {}, graphicHtml: {}, dataStatus: 'native' }
        return { id: `data-${i + 1}`, kind: 'visual', role: 'body', fields: {}, source: JSON.stringify(values), data: { template, values } }
      }),
    ]
    return { id: slideId, title: first ?? packet.tables[0]?.title ?? 'Данные', blocks, directions: packet.directions }
  }
}

/** Recovery uses exactly the same recipe catalogue, DS bindings and fitting
 * executor as a normal generation. It needs no further model response. */
export function fallbackWork(run: StudioRun, slideId: string): SlideWork {
  const content = fallbackSource(run, slideId), old = run.slides.find(s=>s.content.id===slideId)
  return { content, candidates: artDirectedCandidates(content,[...libraryCoverCandidates(content, run.library), ...candidatesFor(content)],run.library),
    chrome:old?.chrome??{title:run.presentationTitle??(run.slides[0]?fallbackSource(run,run.slides[0].content.id).title:content.title),number:Number(slideId.match(/\d+/)?.[0]??1)},
    bindings: Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,run.library)])),
    variation: run.variation, previousDesigns: old?.previousDesigns, history: old?.history,contentKey:old?.contentKey,diversityKey:old?.diversityKey,
    fallback: { sourceSlideId: slideId, sourceTitle: content.title, page: 1, version: FALLBACK_VERSION, source: content } }
}

/** Split wide/long tables into native tiles before text pagination. Headers
 * repeat as context; every original data cell belongs to exactly one tile. */
export function fallbackItems(source: ContentSlide): FallbackItem[] {
  return source.blocks.flatMap(block => {
    const items: FallbackItem[] = Object.entries(block.fields).filter(([, text]) => text.length).map(([field, text]) => ({ id: `${block.id}/${field}`, field, text, kind: block.kind, role: block.role }))
    if (!block.data) return items
    const data = block.data, rows = data.values.rows, columns = data.values.columns
    if (data.template.kind === 'table' && rows && columns?.length) {
      for (let c = 0; c < columns.length; c += 5) for (let r = 0; r < Math.max(1, rows.length); r += 8) {
        const values = { columns: columns.slice(c, c + 5), rows: rows.slice(r, r + 8).map(row => row.slice(c, c + 5)) }
        const template: EditableTemplate = { ...data.template, style: { ...data.template.style, fontSize: 28, padding: 0 }, data: values, columnWidths: undefined, tableStyles: undefined, nativeObject: undefined, sourceLayout: undefined }
        items.push({ id: `${block.id}/table-${r}-${c}`, field: 'text', kind: 'visual', role: 'body', text: [values.columns.join('\t'), ...values.rows.map(row => row.join('\t'))].join('\n'), data: { ...data, template, values } })
      }
    } else items.push({ id: `${block.id}/data`, field: 'text', kind: 'visual', role: 'body', text: JSON.stringify(data.values, null, 2), data })
    return items
  })
}

export function fallbackPage(source: ContentSlide, items: FallbackItem[], pieces: FallbackPiece[], page: number): ContentSlide {
  return { id: page ? `${source.id}-page-${page + 1}` : source.id, title: source.title + (page ? ` · продолжение ${page + 1}` : ''), directions: [], blocks: pieces.map((piece, i) => {
    const item = items.find(item => item.id === piece.item)
    if (!item || !Number.isInteger(piece.start) || !Number.isInteger(piece.end) || piece.start < 0 || piece.end > item.text.length || piece.end <= piece.start) throw Error('Некорректный фрагмент резервной вёрстки.')
    if (piece.render === 'native' && (!item.data || piece.start !== 0 || piece.end !== item.text.length)) throw Error('Данные нельзя обрезать при размещении.')
    const value = item.text.slice(piece.start, piece.end)
    return { id: `f${i + 1}`, kind: piece.render === 'native' ? 'visual' : item.kind === 'visual' ? 'text' : item.kind, role: item.role, fields: piece.render === 'native' ? {} : { [item.field]: value }, source: value, ...piece.render === 'native' ? { data: item.data } : {} }
  }) }
}

export function validateFallbackCoverage(items: FallbackItem[], pages: { pieces: FallbackPiece[] }[]) {
  const pieces = pages.flatMap(p => p.pieces)
  if (pieces.some(p => !items.some(i => i.id === p.item))) throw Error('Добавлен неизвестный фрагмент.')
  for (const item of items) {
    let offset = 0
    for (const part of pieces.filter(p => p.item === item.id)) {
      if (part.start !== offset || part.end <= part.start || part.end > item.text.length) throw Error('Резервная вёрстка пропустила или повторила содержание.')
      offset = part.end
    }
    if (offset !== item.text.length) throw Error('Резервная вёрстка потеряла часть содержания.')
  }
}
