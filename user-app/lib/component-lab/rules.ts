import { profileSchema, rulesSchema, type ComponentProfile, type ComponentRules } from './contract'
import { digest } from './source'

/** A new configuration of the source, never an edit of its source fields. */
export async function applyRules(source: ComponentProfile, raw: unknown): Promise<ComponentProfile> {
  const rules = rulesSchema.parse(raw)
  if (Object.keys(rules.states).some(state => !source.states.includes(state as ComponentProfile['preferred']))) throw Error('Этот вид компонента не поддерживается')
  const replacements = rules.fontReplacements ?? []
  if (new Set(replacements.map(r => r.source)).size !== replacements.length || replacements.some(r => !source.fields.some(f => f.font === r.source) || r.source === r.family)) throw Error('Замена не соответствует исходным шрифтам компонента')
  const fields = source.fields.map(f => ({ ...f, font: replacements.find(r => r.source === f.font)?.family ?? f.font }))
  return profileSchema.parse({ ...source, fields, behavior: { ...source.behavior, ...rules.states }, ...(replacements.length ? { fontReplacements: replacements } : {}), fingerprint: await digest({ source: source.fingerprint, rules }) })
}
export const emptyRules = (): ComponentRules => ({ states: {} })
