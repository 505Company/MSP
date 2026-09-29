import type { CalibratedCatalog } from '../design-system/calibration-contract'
import type { ComponentLibrary } from '../design-system/types'
import type { SemanticMetadata } from '../design-system/semantic-library'
import { flatten } from '../design-system/compiler'
import { QwenAnalysisError } from '../uploads/qwen-analysis'
import { curateComponents, type ComponentTag } from '../design-system/component-curation'

export function recipeBrand(uploadId: string, catalogId: string, library: ComponentLibrary, semantic?: SemanticMetadata, calibrated?: CalibratedCatalog | null) {
  if (!semantic || !library.tokens.fonts.length || library.tokens.colors.length < 2) throw new QwenAnalysisError('STYLE_NOT_READY', 'Для выбранного стиля ещё не завершён разбор дизайн-системы. Содержание сохранено.')
  const resources: { id: string; name: string; roles: string[]; tags?: ComponentTag[]; description?: string; width: number; height: number; uses: Array<'panel' | 'circle' | 'art'> }[] = []
  const selected=new Map(calibrated ? calibrated.families.flatMap(f=>f.variants.map(v=>[v.id,{tags:f.tags,description:f.description}] as const)) : curateComponents(library.components).components.map(c=>[c.id,c]))
  for (const c of library.components) {
    const usage=selected.get(c.id);if(!usage)continue
    if (c.issues.some(i => i.severity !== 'warning') || c.slots.length || c.fixedTextIds.length) continue
    const leaves = flatten(c.scene.elements).filter(e => e.kind !== 'group' && e.visible && e.opacity !== 0)
    // Text-bearing components and semantic unknowns are not decorative assets.
    if (!leaves.length || leaves.some(e => e.kind === 'text') || !c.semantics.length) continue
    const roles = [...new Set(c.semantics.map(s => s.role))], uses: Array<'panel' | 'circle' | 'art'> = []
    if (leaves.length === 1 && leaves[0].kind === 'rectangle') uses.push('panel')
    if (leaves.length === 1 && leaves[0].kind === 'ellipse' && Math.abs(c.scene.width - c.scene.height) <= Math.max(c.scene.width, c.scene.height) * .02) uses.push('circle')
    if (roles.some(r => ['illustration', 'photo', 'pattern', 'decoration'].includes(r))) uses.push('art')
    if (uses.length) resources.push({ id: c.id, name: c.name, roles, tags:usage.tags, description:usage.description, width: c.scene.width, height: c.scene.height, uses })
  }
  return { uploadId, catalogId, sourceId: library.sourceId, name: library.name,
    tokens: library.tokens, rules: semantic.rules.map(r => ({ id: r.id, interpretation: r.interpretation, sourceTexts: r.sourceTexts })),
    // These are measured fonts; a font named by a rule is not thereby installed.
    fontPolicy: 'Use actual catalog fonts. Rule-only names require a later availability check; never invent installed fonts.',
    resources, calibrationId: calibrated?.id ?? null, resourceStatus: calibrated ? 'browser-qualified: native export and content substitution checked; every final slide still requires validation' : 'compiler-eligible; not yet calibrated',
    unresolved: semantic.coverage.unresolved }
}
export type RecipeBrand = ReturnType<typeof recipeBrand>
export function selectorBrand(brand: RecipeBrand) {
  const { resources, ...rest } = brand
  return { ...rest, resources: (['panel', 'circle', 'art'] as const).map(use => {
    const pool = resources.filter(r => r.uses.includes(use))
    return { use, available: pool.length, examples: pool.slice(0, 6) }
  }) }
}
