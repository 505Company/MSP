import { z } from 'zod'
import { LAB_VERSION, MINIMUM_TEXT_CONTRAST, contentIssues, measurementIssues, roleSchema, stateSchema, type ComponentProfile } from './contract'
import { qualityCases } from './cases'
import { digest } from './source'

const number = z.number().finite(), box = z.object({ x: number, y: number, width: number, height: number }).strict()
const trial = z.object({
  state: stateSchema, step: number.int().min(0).max(4), width: number.positive(), height: number.positive(), requiredHeight: number.positive(), fits: z.boolean(), issues: z.array(z.string().max(240)).max(50),
  fields: z.array(z.object({ id: z.string().max(160), role: roleSchema, text: z.string().max(12000), font: z.string().min(1).max(160), align: z.enum(['left', 'center', 'right']).optional(), fontSize: number.positive(), lineCount: number.int().positive(), box, ink: box,
    parts: z.array(z.object({ text: z.string().max(12000), fontSize: number.positive(), box }).strict()).min(1).max(2).optional(),
  }).strict()).max(3),
  artwork: z.object({ kind: z.enum(['badge', 'media']), hash: z.string().length(64), box }).strict().optional(),
}).strict()
export const proofCaseSchema = z.object({ id: z.string().max(100), status: z.enum(['fits', 'needs-space', 'incompatible', 'unavailable']), chosen: trial.optional(),
  pixels: z.array(z.object({ id: z.string().max(160), count: number.int().nonnegative(), contrast: number.min(1).max(21) }).strict()).max(3).optional(),
  artwork: z.object({ hash: z.string().length(64), count: number.int().nonnegative() }).strict().optional(),
}).strict()
export const proofSchema = z.object({
  version: z.literal(LAB_VERSION), profile: z.string().length(64), minimumContrast: z.literal(MINIMUM_TEXT_CONTRAST),
  cases: z.array(proofCaseSchema).min(33).max(35),
}).strict()
export type QualityProof = z.infer<typeof proofSchema>

/** Verify bindings and geometry again on the server. Raster evidence remains
 * browser-produced evidence; it is not claimed to be a server visual review. */
export async function validateProof(p: ComponentProfile, raw: unknown) {
  const proof = proofSchema.parse(raw), expected = qualityCases(p)
  if (proof.profile !== p.fingerprint || proof.cases.length !== expected.length) throw Error('Настройки изменились после проверки')
  let technical = true, fits = 0, readable = 0
  for (let i = 0; i < expected.length; i++) {
    const c = proof.cases[i], wanted = expected[i]
    if (c.id !== wanted.id) throw Error('Нужна полная проверка текущих настроек')
    if (c.status === 'fits') {
      if (!c.chosen?.fits || c.chosen.fields.some(f => !f.align) || measurementIssues(p, wanted.content, c.chosen, wanted.constraints).length) throw Error('Измерения не соответствуют проверяемому содержанию')
      fits++
      const visible = p.fields.filter(f => wanted.content[f.id]?.trim())
      const pixelsPass = c.pixels?.length === visible.length && new Set(c.pixels.map(v => v.id)).size === visible.length && visible.every(f => c.pixels!.some(v => v.id === f.id && v.count >= 3 && v.contrast >= MINIMUM_TEXT_CONTRAST))
      if (pixelsPass && (!p.artwork || c.artwork?.hash === p.artwork.hash && c.artwork.count >= 3)) readable++; else technical = false
    }
    if (c.status === 'unavailable' || wanted.expect !== 'explore' && c.status !== wanted.expect) technical = false
    if (c.status === 'incompatible' && !contentIssues(p, wanted.content).length) technical = false
    if (c.status === 'needs-space' && (!c.chosen || !measurementIssues(p, wanted.content, c.chosen, wanted.constraints).length)) throw Error('Отказ не подтверждён измерениями')
  }
  return { proof, hash: await digest(proof), technical: technical ? 'passed' as const : 'failed' as const, coverage: { fits, readable, tested: expected.length } }
}
