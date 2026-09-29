import { AMBIGUOUS_FAMILY, validateFamilyReply, type FamilyReply } from './calibration-contract'
import { SemanticValidationError } from './semantic-contract'

// Publication must not rehabilitate an unverified family as a singleton.
export const ISOLATED_FAMILY = AMBIGUOUS_FAMILY + ': предложение не прошло проверку. Исходный компонент сохранён.'

/** Only the ordinary bounded model attempt may call this on failure. Validate
 * every proposal independently, quarantine conflicts, then require full
 * coverage again. A skipped object never receives a guessed replacement family. */
export function isolateFamilyReply(raw: unknown, allowedIds: string[], validate: (raw: unknown) => FamilyReply, aliases: Record<string, string> = {}): FamilyReply {
  const allowed = new Set(allowedIds), owners = new Map<string, number>(), rejected = new Set<string>()
  const result: FamilyReply = { families: [], excluded: [] }
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  for (const section of ['families', 'excluded'] as const) {
    const entries = object[section]
    if (!Array.isArray(entries) || entries.length > 1000) continue
    for (const entry of entries) {
      const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const refs = [...new Set((section === 'families' ? Array.isArray(value.memberIds) ? value.memberIds : [] : [value.id])
        .filter((id): id is string => typeof id === 'string').map(id => aliases[id] ?? id))]
      const known = refs.filter(id => allowed.has(id))
      known.forEach(id => owners.set(id, (owners.get(id) ?? 0) + 1))
      const pending = allowedIds.filter(id => !known.includes(id)).map(id => ({ id, reason: ISOLATED_FAMILY }))
      try {
        const tested = validate(section === 'families' ? { families: [entry], excluded: pending } : { families: [], excluded: [entry, ...pending] })
        result.families.push(...tested.families)
        if (section === 'excluded') result.excluded.push(...tested.excluded.filter(e => known.includes(e.id)))
      } catch (error) {
        if (!(error instanceof SemanticValidationError)) throw error
        known.forEach(id => rejected.add(id))
      }
    }
  }
  for (const [id, count] of owners) if (count > 1) rejected.add(id)
  result.families = result.families.map(f => ({ ...f, memberIds: f.memberIds.filter(id => !rejected.has(id)) })).filter(f => f.memberIds.length)
  result.excluded = result.excluded.filter(e => !rejected.has(e.id))
  const covered = new Set([...result.families.flatMap(f => f.memberIds), ...result.excluded.map(e => e.id)])
  for (const id of allowedIds) if (!covered.has(id)) result.excluded.push({ id, reason: ISOLATED_FAMILY })
  return validateFamilyReply(result, allowedIds)
}
