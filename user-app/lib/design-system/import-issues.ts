import type { EditableCatalog } from './editable-contract'
import type { ImportOmission } from './semantic-isolation'
import type { ReconstructionCatalog } from './reconstruction-contract'

export type AccountedImportOmission = ImportOmission & { componentId: string; componentName: string }
export type ImportIssueView = { omissions: ImportOmission[]; accounted: AccountedImportOmission[] }

/** A retained photograph is a valid source resource. Only failed recognition
 * belongs in the omissions report, with its original candidate provenance. */
export function reconstructionOmissions(catalog: ReconstructionCatalog | null): ImportOmission[] {
  return (catalog?.results ?? []).filter(r => r.status === 'retained' && r.recognitionIssue).map(r => ({ name: r.name, elementIds: r.candidate.sourceIds, slides: r.candidate.slides, reason: r.reason }))
}

/** A current, qualified component can account for a historical omission.
 * This is a read-only view: keep the original rejection and model reply intact.
 * Partial overlap, a composition or an unqualified preview is not recovery. */
export function importIssueView(items: ImportOmission[], catalog: EditableCatalog | null): ImportIssueView {
  const qualification = catalog?.qualification
  const passed = new Set(qualification?.catalogId === catalog?.id ? qualification?.checks.filter(c => c.passed).map(c => c.id) : [])
  const candidates = catalog?.families.flatMap(f => f.variants).filter(v => v.kind !== 'composition' && v.kind !== 'graphic' && passed.has(v.id)) ?? []
  const omissions: ImportOmission[] = [], accounted: AccountedImportOmission[] = []
  const distinct = new Map(items.map(item => [JSON.stringify([item.name, [...item.slides].sort((a,b)=>a-b), [...item.elementIds].sort(), item.reason]), item]))
  for (const item of distinct.values()) {
    const component = item.elementIds.length && item.slides.length === 1
      ? candidates.find(v => v.slide === item.slides[0] && item.elementIds.every(id => v.sourceIds.includes(id)))
      : undefined
    if (component) accounted.push({ ...item, componentId: component.id, componentName: component.name })
    else omissions.push(item)
  }
  return { omissions, accounted }
}
