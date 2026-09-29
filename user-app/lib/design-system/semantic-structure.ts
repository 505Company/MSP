import type { readSourceScene } from './source-scene'

/** A group chain with exactly one text leaf has no separate visual sibling.
 * Selecting that leaf still retains every ancestor transform in the compiler. */
export function singleTextMember(scene: ReturnType<typeof readSourceScene>, id: string): string | null {
  let record = scene.records.get(id)
  if (record?.element.kind !== 'group' || record.disposition !== 'visible') return null
  for (let depth = 0; depth < 64 && record.element.kind === 'group'; depth++) {
    if (record.element.children.length !== 1) return null
    record = scene.records.get(record.element.children[0].id)
    if (!record || record.disposition !== 'visible') return null
  }
  return record.element.kind === 'text' && record.element.text.trim() ? record.element.id : null
}
