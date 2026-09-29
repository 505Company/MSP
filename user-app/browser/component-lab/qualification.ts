import { digest } from '../../lib/component-lab/source'
import { LAB_VERSION, MINIMUM_TEXT_CONTRAST, type ComponentProfile } from '../../lib/component-lab/contract'
import { qualityCases, type LabCase } from '../../lib/component-lab/cases'
import { measureComponent, pixelEvidence, type FontEvidence } from './measure'
import type { QualityProof } from '../../lib/component-lab/proof'

export async function checkQuality(p: ComponentProfile, fonts: FontEvidence, options: { signal?: AbortSignal; onCase?: (value: QualityCase, done: number, total: number) => void } = {}) {
  const cases = qualityCases(p), results: QualityCase[] = []
  const target = document.createElement('div'); Object.assign(target.style, { position: 'fixed', left: '-20000px', top: '0' }); document.body.appendChild(target)
  try { for (const c of cases) {
    options.signal?.throwIfAborted()
    const measurement = await measureComponent(p, c.content, c.constraints, fonts, { target, signal: options.signal })
    const evidence = measurement.status === 'fits' ? await pixelEvidence(target.firstElementChild as HTMLElement, measurement.chosen!, fonts) : undefined
    options.signal?.throwIfAborted()
    const assertion = c.expect === 'explore' ? undefined : measurement.status === c.expect && (measurement.status !== 'fits' || evidence?.passed === true)
    const result = { id: c.id, name: c.name, expect: c.expect, content: c.content, measurement, assertion, evidence }
    results.push(result); options.onCase?.(result, results.length, cases.length)
  } } finally { target.remove() }
  const assertions = results.filter(r => r.assertion !== undefined)
  const policy = { minimumTextContrast: MINIMUM_TEXT_CONTRAST }
  return { version: LAB_VERSION, profile: p.fingerprint, inputHash: await digest({ version: LAB_VERSION, p, cases, fonts, policy }), policy, createdAt: new Date().toISOString(),
    technical: assertions.every(r => r.assertion) && results.every(r => r.measurement.status !== 'unavailable' && (!r.evidence || r.evidence.passed)) ? 'passed' as const : 'failed' as const,
    artistic: 'not-reviewed' as const, generationAdmission: false as const,
    coverage: { fits: results.filter(r => r.measurement.status === 'fits').length, readable: results.filter(r => r.measurement.status === 'fits' && r.evidence?.passed).length, tested: results.length, assertionsPassed: assertions.filter(r => r.assertion).length, assertions: assertions.length }, cases: results }
}
export type QualityCase = { id: string; name: string; expect: LabCase['expect']; content: LabCase['content']; measurement: Awaited<ReturnType<typeof measureComponent>>; assertion: boolean | undefined; evidence?: Awaited<ReturnType<typeof pixelEvidence>> }
export type QualityReport = Awaited<ReturnType<typeof checkQuality>>
export function qualityProof(report: QualityReport): QualityProof {
  return { version: report.version, profile: report.profile, minimumContrast: MINIMUM_TEXT_CONTRAST, cases: report.cases.map(c => ({ id: c.id, status: c.measurement.status, ...(c.measurement.chosen ? { chosen: c.measurement.chosen } : {}), ...(c.evidence ? { pixels: c.evidence.pixels, ...(c.evidence.artwork ? { artwork: c.evidence.artwork } : {}) } : {}) })) }
}
