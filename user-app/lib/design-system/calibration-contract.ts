import { z } from 'zod'
import { componentTagLabels, componentUsage, type ComponentTag } from './component-curation'
import { visibleElements } from './compiler'
import type { ComponentDefinition, ComponentIssue, TextSlot } from './types'
import { SemanticValidationError } from './semantic-contract'

export const CALIBRATION_VERSION = 'component-families-1'
export const QUALIFICATION_VERSION = 'component-qualification-4'
export const FUNCTIONAL_SELECTION_VERSION = 'component-reuse-5'
export type FieldKind = 'text' | 'number' | 'ordinal' | 'unit'
export function fieldKind(slot: TextSlot): FieldKind {
  if (/номер|порядок/i.test(slot.label)) return 'ordinal'
  if (/^[\s\d.,+−–\-]+$/.test(slot.defaultText) && /\d/.test(slot.defaultText)) return 'number'
  if (/^(%|₽|\$|€|млн|тыс\.?|млрд|кг|км|лет|год[аов]*)$/i.test(slot.defaultText.trim())) return 'unit'
  return 'text'
}
export type QualifiedField = { id: string; label: string; kind: FieldKind; samples: string[]; testedMaxLength: number }
export type QualificationCase = { name: 'source' | 'short' | 'typical' | 'long' | 'boundary'; values: Record<string, string>; fits: boolean; issues: ComponentIssue[]; roundTrip: boolean }
export type ComponentQualification = {
  version: string; componentId: string; definitionHash: string; ready: boolean
  fields: QualifiedField[]; cases: QualificationCase[]; issues: ComponentIssue[]
  preview: string; signature: number[]; environment: { userAgent: string; fonts: string[] }
}
export type FamilyProposal = { name: string; description: string; tags: ComponentTag[]; parameters: string[]; memberIds: string[] }
export type FamilyReply = { families: FamilyProposal[]; excluded: { id: string; reason: string }[] }
export type ComponentVariant = { id: string; label: string; memberIds: string[]; fields: QualifiedField[]; previewOnDark?: boolean }
export type ComponentFamily = FamilyProposal & { id: string; kind: 'atom' | 'compound'; variants: ComponentVariant[]; representativeId: string; occurrenceIds: string[]; slides: number[]; previewOnDark: boolean }
export type CalibratedCatalog = {
  version: string; qualificationVersion: string; functionalVersion: string; id: string; catalogId: string; createdAt: string; families: ComponentFamily[]
  excluded: { id: string; reason: string }[]; sourceCount: number; qualifiedCount: number
  qualificationHash?: string; modelRunIds: string[]; liveRequests: number; cacheHits: number
  replayedFrom?: {catalogId:string;id:string}
}
const tags = Object.keys(componentTagLabels) as [ComponentTag, ...ComponentTag[]]
const short = z.string().trim().min(1).max(140), id = z.string().min(1).max(100)
const reply = z.object({ families: z.array(z.object({ name: short, description: short, tags: z.array(z.enum(tags)).min(1).max(6), parameters: z.array(short).max(24), memberIds: z.array(id).min(1).max(1000) }).strict()).max(1000), excluded: z.array(z.object({ id, reason: short }).strict()).max(1000) }).strict()
const str = { type: 'string', minLength: 1, maxLength: 140 }
const arr = (items: object, maxItems = 1000, minItems = 0) => ({ type: 'array', items, minItems, maxItems })
const obj = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export const familySchema = obj({ families: arr(obj({ name: str, description: str, tags: arr({ type: 'string', enum: tags }, 6, 1), parameters: arr(str, 24), memberIds: arr(str, 1000, 1) })), excluded: arr(obj({ id: str, reason: str })) })
export const familyMergeSchema = obj({ families: arr(obj({ name: str, memberIds: arr(str, 1000, 1) })), excluded: arr(obj({ id: str, reason: str })) })
export function validateFamilyMerge(raw: unknown, entries: { id: string; description: unknown }[]): FamilyReply {
  const parsed = z.object({ families: z.array(z.object({ name: short, memberIds: z.array(id).min(1).max(1000) }).strict()).max(1000), excluded: reply.shape.excluded }).strict().safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(['family-merge-schema'])
  const known = new Map(entries.map(e => [e.id, e.description as FamilyProposal & {kind?:ComponentDefinition['kind']}]))
  const result = reconcileFamilyReply({ families: parsed.data.families.map(f => {
    const sources = f.memberIds.flatMap(id => known.get(id) ?? [])
    return { ...f, description: sources[0]?.description ?? 'Неизвестное семейство', tags: [...new Set(sources.flatMap(x => x.tags))].slice(0, 6), parameters: [...new Set(sources.flatMap(x => x.parameters))].slice(0, 24) }
  }), excluded: parsed.data.excluded }, entries.map(e => e.id))
  // A merge is optional: an atom and a construct cannot become one family.
  // Retain checked source families; never invent a replacement classification.
  result.families=result.families.flatMap(f=>{
    if(new Set(f.memberIds.map(id=>known.get(id)?.kind).filter(Boolean)).size<2)return [f]
    return f.memberIds.map(id=>{
      const source=known.get(id)!
      return {name:source.name,description:source.description,tags:source.tags,parameters:source.parameters,memberIds:[id]}
    })
  })
  return validateFamilyReply(result,entries.map(e=>e.id))
}
export function validateFamilyReply(raw: unknown, allowedIds: string[], aliases: Record<string, string> = {}): FamilyReply {
  const result = parseFamilyReply(raw, aliases)
  const used = [...result.families.flatMap(f => f.memberIds), ...result.excluded.map(e => e.id)]
  const errors: string[] = []
  if (new Set(used).size !== used.length) errors.push('duplicate-membership')
  for (const id of allowedIds) if (!used.includes(id)) errors.push(`missing:${id}`)
  for (const id of used) if (!allowedIds.includes(id)) errors.push(`unknown:${id}`)
  if (errors.length) throw new SemanticValidationError(errors)
  return result
}
function parseFamilyReply(raw: unknown, aliases: Record<string, string>): FamilyReply {
  const parsed = reply.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(['family-schema: ' + parsed.error.issues.slice(0, 3).map(e => e.path.join('.') + ' ' + e.message).join('; ')])
  const result = parsed.data
  // Resolve only explicit source/sheet aliases. Provider responses remain immutable.
  for (const f of result.families) f.memberIds = f.memberIds.map(id => aliases[id] ?? id)
  for (const e of result.excluded) e.id = aliases[e.id] ?? e.id
  return result
}
export const AMBIGUOUS_FAMILY = 'Неоднозначное семейство'
/** Conflicts are local to their objects. Never guess the winning family:
 * quarantine those objects, retain their originals, then validate full coverage.
 * Missing/unknown IDs and malformed responses still fail. */
export function reconcileFamilyReply(raw: unknown, allowedIds: string[], aliases: Record<string,string> = {}): FamilyReply {
  const result = parseFamilyReply(raw, aliases), owners = new Map<string,Set<string>>()
  const record = (id:string,owner:string) => { const set=owners.get(id)??new Set<string>();set.add(owner);owners.set(id,set) }
  result.families.forEach((f,i)=>{f.memberIds=[...new Set(f.memberIds)];f.memberIds.forEach(id=>record(id,`family:${i}`))})
  result.excluded.forEach(e=>record(e.id,'excluded'))
  const conflicts = new Set([...owners].filter(([,set])=>set.size>1).map(([id])=>id))
  result.families = result.families.map(f=>({...f,memberIds:f.memberIds.filter(id=>!conflicts.has(id))})).filter(f=>f.memberIds.length)
  result.excluded = [...new Map(result.excluded.filter(e=>!conflicts.has(e.id)).map(e=>[e.id,e])).values(),
    ...[...conflicts].map(id=>({id,reason:`${AMBIGUOUS_FAMILY}: модель предложила несколько назначений. Исходный объект сохранён отдельно.`})) ]
  return validateFamilyReply(result,allowedIds)
}

/** A raster picture of data can round-trip as an image while still being
 * unsuitable as a reusable data component. Keep it in source assets only. */
export function componentReuseIssue(c: ComponentDefinition, family: Pick<FamilyProposal, 'name' | 'tags'>): string | null {
  const leaves = visibleElements(c.scene.elements).filter(e => !('children' in e))
  const displaysData = family.tags.some(t => ['metric', 'chart', 'table', 'legend', 'steps'].includes(t)) || c.semantics.some(s => s.role === 'chart')
    || /диаграмм|(?:^|\s)график(?:\s|$)|изображение графика|метрик|показател/i.test(c.name + ' ' + family.name)
  if (!c.slots.length && !family.tags.includes('icon') && !componentUsage(c).tags.includes('icon') && displaysData)
    return leaves.some(e => e.kind === 'raster')
      ? 'Значения встроены в изображение. Для новых данных требуется редактируемая диаграмма; исходная картинка сохранена в графике.'
      : 'У компонента для данных нет изменяемых значений. Исходная графика сохранена, но компонент пока не готов к заполнению.'
  if (/неизвестн|неопредел[её]н|без названия/i.test(family.name)) return 'Назначение не определено; компонент сохранён для уточнения.'
  return null
}
export function componentDescriptor(c: ComponentDefinition) {
  const leaves = visibleElements(c.scene.elements).filter(e => !('children' in e))
  return { id: c.id, name: c.name, kind: c.kind, usage: componentUsage(c), width: Math.round(c.scene.width), height: Math.round(c.scene.height),
    structure: leaves.map(e => e.kind), fixedText: leaves.flatMap(e => e.kind === 'text' && c.fixedTextIds.includes(e.id) ? [e.text] : []),
    fields: c.slots.map(s => ({ label: s.label, type: fieldKind(s), example: s.defaultText.slice(0, 140) })) }
}

/** A family is a semantic choice. Within it, a variant may only reuse an
 * existing qualified definition. Comparing normalized rendered samples also
 * detects duplicate raster assets with different source identifiers. */
export function equivalentVariant(a: ComponentDefinition, b: ComponentDefinition, qa: ComponentQualification, qb: ComponentQualification) {
  if (a.kind !== b.kind || a.slots.length !== b.slots.length) return false
  const da = componentDescriptor(a), db = componentDescriptor(b)
  if (JSON.stringify(da.structure) !== JSON.stringify(db.structure) || JSON.stringify(da.fixedText) !== JSON.stringify(db.fixedText)) return false
  if (a.slots.some((s, i) => fieldKind(s) !== fieldKind(b.slots[i]) || fieldKind(s) === 'unit' && s.defaultText !== b.slots[i].defaultText)) return false
  const paint = (c: ComponentDefinition) => visibleElements(c.scene.elements).filter(e => !('children' in e)).map(e => {
    const color = (v: unknown): unknown => typeof v === 'number' ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map(color) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, color(x)])) : v
    const styles = e.kind === 'text' ? [...new Set((e.styleRuns ?? [e]).map(r => JSON.stringify({ family: r.fontFamily, style: r.fontStyle, size: Math.round(r.fontSize * 10) / 10 })))].sort() : []
    const colors = e.kind === 'text' ? [...new Set((e.colorRuns ?? []).map(r => JSON.stringify(color(r.fill))))].sort() : []
    return { kind: e.kind, opacity: e.opacity, styles, colors, fill: 'fill' in e ? color(e.fill) : null, stroke: 'stroke' in e ? color(e.stroke) : null }
  })
  if (JSON.stringify(paint(a)) !== JSON.stringify(paint(b))) return false
  // Keep orientation and materially different proportions. Absolute size and
  // example copy are not a new family, but unsupported resizing is never added.
  const ra = a.scene.width / a.scene.height, rb = b.scene.width / b.scene.height
  if (Math.abs(Math.log(ra / rb)) > .08) return false
  if (!qa.signature.length || qa.signature.length !== qb.signature.length) return false
  let difference = 0, ink = 0
  for (let i = 0; i < qa.signature.length; i++) {
    const background = [137, 147, 165][i % 3]
    difference += Math.abs(qa.signature[i] - qb.signature[i])
    ink += Math.max(Math.abs(qa.signature[i] - background), Math.abs(qb.signature[i] - background))
  }
  // Sparse arrows/icons must not look equal merely because most pixels are blank.
  const relativeLimit = a.slots.length ? .25 : .025
  return difference / qa.signature.length / 255 < .012 && difference / Math.max(1, ink) < relativeLimit
}

/** The same native circle is a reusable primitive even when the semantic pass
 * calls one occurrence decoration and another a marker. Preserve both uses;
 * never apply this cross-family rule to pictograms, text or composite scenes. */
export function coalescePrimitiveFamilies(proposals: FamilyProposal[], definitions: Map<string, ComponentDefinition>, reports: Map<string, ComponentQualification>) {
  const result: FamilyProposal[] = []
  const leaves = (c: ComponentDefinition) => visibleElements(c.scene.elements).filter(e => !('children' in e))
  const eligible = (f: FamilyProposal) => f.memberIds.every(id => {
    const c = definitions.get(id)!, parts = leaves(c)
    return c.kind === 'atom' && !c.slots.length && !c.fixedTextIds.length && parts.length === 1 && ['ellipse', 'path'].includes(parts[0].kind)
      && Math.abs(Math.log(c.scene.width / c.scene.height)) < .01
  })
  const sameCircle = (a: string, b: string) => {
    const ca = definitions.get(a)!, cb = definitions.get(b)!, qa = reports.get(a)!, qb = reports.get(b)!
    return qa.ready && qb.ready && leaves(ca)[0].kind === 'ellipse' && leaves(cb)[0].kind === 'ellipse'
      && equivalentVariant(ca, cb, qa, qb) && qa.signature.every((n, i) => n === qb.signature[i])
  }
  for (const proposal of proposals) {
    const prior = eligible(proposal) && result.find(f => eligible(f) && f.memberIds.some(a => proposal.memberIds.some(b => sameCircle(a, b))))
    if (prior) {
      prior.memberIds.push(...proposal.memberIds)
      prior.tags = [...new Set([...prior.tags, ...proposal.tags])].slice(0, 6)
      prior.parameters = [...new Set([...prior.parameters, ...proposal.parameters])].slice(0, 24)
    } else result.push({ ...proposal, memberIds: [...proposal.memberIds] })
  }
  return result
}
