import { NextResponse } from 'next/server'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { decideRecipe, libraryDecisionSchema, readRecipeBundle, readRecipeRegistry, recipeEligibility } from '@/lib/presentations/recipes/library'
import { registerTemplatePilot } from '@/lib/presentations/recipes/template-pilot'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const registration = z.object({ action: z.literal('register-pilot'), round: z.enum(['pilot-1', 'structural-1', 'family-2', 'comparison-1']), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const failure = (error: unknown) => NextResponse.json({ error: error instanceof QwenAnalysisError ? error.message : 'Не удалось обновить библиотеку рецептов.',
  code: error instanceof QwenAnalysisError ? error.code : 'RECIPE_LIBRARY_REQUEST_FAILED' }, { status: 409 })
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params, bucket = objectBucket(), registry = await readRecipeRegistry(bucket, id), recipes = []
    for (const entry of registry.entries) {
      const bundle = await readRecipeBundle(bucket, id, entry), { reasons } = await recipeEligibility(bucket, id, entry)
      recipes.push({ ...entry, passport: bundle ? { ...bundle.recipe.passport, qualification: {
        technical: reasons.includes('technical-not-passed') ? 'failed' : reasons.some(r => r !== 'artistic-not-accepted') ? 'unverified' : 'passed', artistic: entry.artistic, receipt: bundle.receipt.key,
      } } : null, qualificationScope: bundle?.receipt.scope, reasons,
        status: entry.enabled && !reasons.length ? 'enabled' : bundle && !reasons.some(r => r !== 'artistic-not-accepted') ? 'verified' : 'draft' })
    }
    return NextResponse.json({ ...registry, recipes }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса.' }, { status: 403 })
  try {
    const { id } = await context.params, bucket = objectBucket()
    const action = z.union([registration, libraryDecisionSchema]).parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 5000))))
    const registry = action.action === 'register-pilot' ? await registerTemplatePilot(bucket, id, action.round, action.expectedRevision) : await decideRecipe(bucket, id, action)
    return NextResponse.json(registry)
  } catch (error) { return failure(error) }
}
