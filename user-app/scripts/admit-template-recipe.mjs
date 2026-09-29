// Requires explicit acceptance or delegated review authority. Never edits a deck or calls the model.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const delegated = process.argv.includes('--delegated-review')
const [uploadId, round, version, reason, output = 'outputs/diagnostics/recipe-admission', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2).filter(a => a !== '--delegated-review')
if (!/^[a-f0-9-]{36}$/.test(uploadId ?? '') || !['pilot-1', 'structural-1', 'family-2', 'comparison-1'].includes(round) || !/^[a-f0-9]{64}$/.test(version ?? '') || !reason?.trim()) {
  throw Error('Usage: admit-template-recipe.mjs <upload-id> <round> <exact-version> <acceptance-reason> [output] [origin] [--delegated-review]')
}
const endpoint = `${origin}/api/uploads/${uploadId}/recipe-library`
const get = async url => { const r = await fetch(url); if (!r.ok) throw Error(await r.text()); return r.json() }
const before = await get(`${origin}/api/uploads/${uploadId}/recipe-pilot?round=${round}`)
if (before.recipe?.passport.version !== version) throw Error('The accepted recipe version has changed')
const projectId = process.env.MSP_PROTECTED_PROJECT_ID
if (projectId && !/^[a-f0-9-]{36}$/.test(projectId)) throw Error('Invalid protected project ID')
const deckBefore = projectId ? await get(`${origin}/api/projects/${projectId}/layout`) : null
let registry = await get(endpoint)
const recipeId = before.recipe.passport.id
const post = async body => {
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedRevision: registry.revision }) })
  if (!r.ok) throw Error(await r.text())
  registry = await r.json()
}
if (!registry.entries.some(e => e.id === recipeId && e.version === version)) await post({ action: 'register-pilot', round })
if (registry.entries.find(e => e.id === recipeId && e.version === version)?.artistic !== 'accepted') await post({ action: 'accept', recipeId, version, reason, reviewer: delegated ? 'delegated-agent' : 'user' })
if (!registry.entries.find(e => e.id === recipeId && e.version === version)?.enabled) await post({ action: 'enable', recipeId, version, reason })
const after = await get(`${origin}/api/uploads/${uploadId}/recipe-pilot?round=${round}`), library = await get(endpoint)
const admission = library.recipes.find(e => e.id === recipeId && e.version === version)
if (admission?.status !== 'enabled') throw Error(JSON.stringify(admission))
const preservation = { pilotUnchanged: JSON.stringify(before) === JSON.stringify(after),
  presentationUnchanged: deckBefore ? JSON.stringify(deckBefore) === JSON.stringify(await get(`${origin}/api/projects/${projectId}/layout`)) : null }
if (!preservation.pilotUnchanged || preservation.presentationUnchanged === false) throw Error('Protected evidence changed')
await mkdir(output, { recursive: true })
await writeFile(`${output}/admission.json`, JSON.stringify({ uploadId, round, version, admission, revision: library.revision, preservation, budget: after.budget, originalBudget: after.originalBudget }, null, 2))
console.log(JSON.stringify({ recipeId, version, status: admission.status, preservation, output: resolve(output, 'admission.json') }))
