import { NextResponse } from 'next/server'
import {waitUntil} from 'cloudflare:workers'
import {enqueuePreparation} from '@/lib/component-lab/preparation-jobs'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { readEditableCatalog } from '@/lib/design-system/editable-analysis'
import { sourceCandidate } from '@/lib/component-lab/source'
import { catalogCandidates, candidateScene, withNativeQuote } from '@/lib/component-lab/candidates'
import { readRuleHistory, saveRuleRevision } from '@/lib/component-lab/storage'

async function source(request: Request, id: string) {
  z.string().uuid().parse(id)
  const bucket = objectBucket(); await assertUploadActive(bucket, id)
  const catalog = await readEditableCatalog(bucket, id), component = new URL(request.url).searchParams.get('component')
  const t = catalog?.families.flatMap(f => f.variants).find(t => t.id === component)
  if (!catalog || !t || !catalog.qualification?.checks.some(c => c.id === t.id && c.passed)) throw Error('Компонент не найден в проверенном каталоге')
  const candidate = await sourceCandidate(withNativeQuote(t, await candidateScene(bucket, id, [t])), catalog.id)
  if (!candidate.profile) throw Error(candidate.reason)
  return { bucket, profile: candidate.profile }
}
const error = (e: unknown) => uploadCancellationResponse(e) ?? NextResponse.json({ error: e instanceof z.ZodError ? 'Настройки или проверка неполны. Повторите проверку перед сохранением.' : e instanceof Error ? e.message : 'Не удалось сохранить настройки' }, { status: 409 })
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params
    if (new URL(request.url).searchParams.has('candidates')) {
      z.string().uuid().parse(id); const bucket = objectBucket(); await assertUploadActive(bucket, id)
      const catalog = await readEditableCatalog(bucket, id)
      return NextResponse.json({ candidates: catalog ? await catalogCandidates(bucket, id, catalog) : [] }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const { bucket, profile } = await source(request, id)
    return NextResponse.json(await readRuleHistory(bucket, id, profile), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return error(e) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник' }, { status: 403 })
  try { const { id } = await context.params, { bucket, profile } = await source(request, id), body = await request.text()
    if (body.length > 1500000) throw Error('Слишком большой отчёт')
    const revision=await saveRuleRevision(bucket, id, profile, JSON.parse(body))
    waitUntil(enqueuePreparation(bucket,id).catch(()=>{console.warn('[component-preparation] rule refresh deferred for '+id)}))
    return NextResponse.json({ revision })
  } catch (e) { return error(e) }
}
