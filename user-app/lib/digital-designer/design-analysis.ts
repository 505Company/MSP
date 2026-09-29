export type Evidence = { basis: 'measured' | 'visual_observation' | 'inferred'; slideIds: string[]; elementIds: string[]; assetIds: string[] };
export interface DesignFinding {
  id: string; categoryId: string; name: string; kind: 'token' | 'asset' | 'molecule' | 'rule';
  value: string; role: string; evidence: Evidence; confidence: number; reviewStatus: 'candidate';
  transforms: { allowed: string[]; forbidden: string[]; unknown: string[] };
}
export interface DesignAnalysis {
  schemaVersion: 1; sourceId: string; summary: string; findings: DesignFinding[];
  photoStyle: { status: 'observed' | 'insufficient_evidence'; variants: { name: string; task: string; properties: { dimensionId: string; value: string; evidence: Evidence }[] }[]; limitations: string[] };
  coverage: { categoryId: string; status: 'observed' | 'not_observed' | 'not_assessed'; note: string }[];
  uncertainties: string[];
}
export type AnalysisStage = 'queued' | 'reading' | 'rendering' | 'model' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
export interface AnalysisJob { id: string; projectId: string; sourceId: string; name: string; stage: AnalysisStage; createdAt: string; updatedAt: string; error?: string; summary?: string; findingCount?: number }
export interface AnalysisReferenceSet { sourceId: string; slideIds: Set<string>; elementIds: Set<string>; assetIds: Set<string>; categoryIds: Set<string>; photoDimensionIds: Set<string>; visualSlideIds: Set<string>; visualAssetIds: Set<string>; elementAssetIds?: Map<string, string> }

export type Schema = { type: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; prefixItems?: Schema[]; enum?: (string | number)[]; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; minimum?: number; maximum?: number };
const string = (maxLength = 1200): Schema => ({ type: 'string', maxLength });
const enumeration = (...values: string[]): Schema => ({ ...string(), enum: values });
const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', items, maxItems, minItems });
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const evidence = object({ basis: enumeration('measured', 'visual_observation', 'inferred'), slideIds: array(string(12), 15), elementIds: array(string(120), 30), assetIds: array(string(80), 10) });
export const designAnalysisSchema = object({
  schemaVersion: { type: 'integer', enum: [1] }, sourceId: string(64), summary: string(2500),
  findings: array(object({ id: string(60), categoryId: string(4), name: string(160), kind: enumeration('token', 'asset', 'molecule', 'rule'), value: string(1500), role: string(600), evidence,
    confidence: { type: 'number', minimum: 0, maximum: 1 }, reviewStatus: enumeration('candidate'), transforms: object({ allowed: array(string(500), 5), forbidden: array(string(500), 5), unknown: array(string(500), 5) }) }), 40, 1),
  photoStyle: object({ status: enumeration('observed', 'insufficient_evidence'), variants: array(object({ name: string(160), task: string(500), properties: array(object({ dimensionId: string(80), value: string(800), evidence }), 14, 1) }), 4), limitations: array(string(), 12) }),
  coverage: array(object({ categoryId: string(4), status: enumeration('observed', 'not_observed', 'not_assessed'), note: string(600) }), 60, 1),
  uncertainties: array(string(), 20)
});
// Validate the same deliberately small JSON Schema subset used in the model request.
export function shape(value: unknown, schema: Schema): void {
  const fail = () => { throw new Error('analysis-invalid-shape'); };
  if (schema.enum && !schema.enum.includes(value as string)) fail();
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !Object.hasOwn(schema.properties!, k)) || schema.required!.some(k => !Object.hasOwn(v, k))) fail();
    for (const [k, s] of Object.entries(schema.properties!)) if(Object.hasOwn(v,k)) shape(v[k], s);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems || 0) || value.length > schema.maxItems!) return fail();
    value.forEach((item,index)=>shape(item,schema.prefixItems?.[index]||schema.items!));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || schema.minLength !== 0 && !value.trim() || value.length < (schema.minLength ?? 1) || value.length > schema.maxLength!) fail();
  } else if (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isInteger(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) fail();
}
export function validateDesignAnalysis(value: unknown, refs: AnalysisReferenceSet): DesignAnalysis {
  shape(value, designAnalysisSchema);
  const data = value as DesignAnalysis;
  if (data.sourceId !== refs.sourceId) throw new Error('analysis-wrong-source');
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(data.findings.map(f => f.id))) throw new Error('analysis-duplicate-id');
  for (const f of data.findings) checkFinding(f, refs);
  if (data.photoStyle.status === 'insufficient_evidence' && data.photoStyle.variants.length || data.photoStyle.status === 'observed' && !data.photoStyle.variants.length) throw new Error('analysis-photo-status-conflict');
  for (const variant of data.photoStyle.variants) for (const p of variant.properties) {
    if (!refs.photoDimensionIds.has(p.dimensionId)) throw new Error('analysis-unknown-photo-dimension');
    checkEvidence(p.evidence, refs);
  }
  if (!unique(data.coverage.map(c => c.categoryId)) || data.coverage.length !== refs.categoryIds.size || data.coverage.some(c => !refs.categoryIds.has(c.categoryId))) throw new Error('analysis-incomplete-coverage');
  return data;
}

function checkEvidence(e: Evidence, refs: AnalysisReferenceSet) {
    if (!e.slideIds.length && !e.elementIds.length && !e.assetIds.length) throw new Error('analysis-evidence-missing');
    if (e.slideIds.some(id => !refs.slideIds.has(id)) || e.elementIds.some(id => !refs.elementIds.has(id)) || e.assetIds.some(id => !refs.assetIds.has(id))) throw new Error('analysis-unknown-reference');
    if (e.basis === 'visual_observation' && !e.slideIds.some(id => refs.visualSlideIds.has(id)) && !e.assetIds.some(id => refs.visualAssetIds.has(id))) throw new Error('analysis-unseen-evidence');
}
function checkFinding(f: DesignFinding, refs: AnalysisReferenceSet) {
    if (!refs.categoryIds.has(f.categoryId)) throw new Error('analysis-unknown-category');
    checkEvidence(f.evidence, refs);
    if (f.kind === 'asset' && !f.evidence.assetIds.length && !f.evidence.elementIds.length) throw new Error('analysis-asset-reference-missing');
    if (f.kind === 'asset' && f.evidence.assetIds.length && refs.elementAssetIds && f.evidence.elementIds.some(id => !refs.elementAssetIds!.has(id) || !f.evidence.assetIds.includes(refs.elementAssetIds!.get(id)!))) throw new Error('analysis-asset-binding-mismatch');
    if (f.kind === 'asset' && f.evidence.assetIds.some(id => !refs.visualAssetIds.has(id))) throw new Error('analysis-unseen-asset');
    if (f.kind === 'molecule' && f.evidence.elementIds.length < 2) throw new Error('analysis-molecule-members-missing');
    if (f.kind === 'molecule' && new Set(f.evidence.elementIds.map(id => /^s\d+/.exec(id)?.[0])).size > 1) throw new Error('analysis-molecule-cross-slide');
  }

export interface RejectedFinding { id: string; categoryId: string; name: string; reason: string }
export function validateCandidateSubset(value: unknown, refs: AnalysisReferenceSet) {
  shape(value, designAnalysisSchema);
  const result = structuredClone(value) as DesignAnalysis;
  const proposedCount = result.findings.length, rejected: RejectedFinding[] = [];
  result.findings = result.findings.filter(f => {
    try { checkFinding(f, refs); return true; }
    catch (error) { rejected.push({ id: f.id, categoryId: f.categoryId, name: f.name, reason: error instanceof Error ? error.message : 'analysis-invalid-finding' }); return false; }
  });
  if (!result.findings.length) throw new Error('analysis-no-valid-candidates');
  for (const category of result.coverage) if (rejected.some(r => r.categoryId === category.categoryId) && !result.findings.some(f => f.categoryId === category.categoryId)) {
    category.status = 'not_assessed'; category.note = 'Кандидаты этой категории не прошли проверку ссылок или состава. ' + category.note.slice(0, 450);
  }
  validateDesignAnalysis(result, refs);
  return { result, proposedCount, rejected };
}
