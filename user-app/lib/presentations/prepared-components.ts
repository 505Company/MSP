import { contentIssues, type ComponentContent, type ComponentProfile } from '../component-lab/contract'
import type { PreparedComponent } from '../component-lab/preparation-jobs'

export const PREPARED_BOX_VERSION = 'adaptive-blocks-6' as const
export const PREPARED_BOX_RENDER = 'adaptive-render-10' as const
export type PreparedBox = Pick<PreparedComponent, 'version' | 'inputHash' | 'ruleRevision' | 'profile' | 'rules' | 'faces' | 'assets' | 'proofHash' | 'fidelity'> & { sourceContent: ComponentContent }
export type PreparedBoxes = Record<string, PreparedBox>
export const preparedSlots = (profile: ComponentProfile) => profile.fields.map((f, i) => ({ sourceId: f.id, paths: [`slots.${i}`], metric: ['number', 'ordinal'].includes(f.role), role: f.role }))
export function preparedContent(binding: { fields: { path: string; fragments: string[] }[] }, pin: PreparedBox, content: { id: string; text: string }[]) {
  const result: ComponentContent = {}
  for (const field of binding.fields) {
    const index = /^slots\.([0-2])$/.exec(field.path)?.[1], definition = index === undefined ? undefined : pin.profile.fields[Number(index)]
    if (!definition || Object.hasOwn(result, definition.id) || field.fragments.some(id => !content.some(f => f.id === id))) throw Error('prepared-component-binding')
    result[definition.id] = field.fragments.map(id => content.find(f => f.id === id)!.text).join('\n')
  }
  if (contentIssues(pin.profile, result).length) throw Error('prepared-component-content')
  return result
}
