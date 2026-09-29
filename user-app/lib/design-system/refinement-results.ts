import type { EditableCatalog } from './editable-contract'
import type { RefinementCandidate, RefinementJob } from './refinement-contract'

/** Derive receipts for old jobs without rewriting their stored model decisions. */
export async function describeRefinementResults(bucket: R2Bucket, root: string, jobs: RefinementJob[]) {
  for (const job of jobs) {
    const version = job.result?.version && await bucket.get(`${root}/versions/${job.result.version}.json`)
    const published = version ? (await version.json<EditableCatalog>()).families.flatMap(f=>f.variants) : []
    const publishedIds = new Set(published.map(t=>t.id)), added = new Set<string>()
    for (const task of job.tasks) {
      if (!task.candidateKey) continue
      const file = await bucket.get(task.candidateKey); if (!file) continue
      const candidate = await file.json<RefinementCandidate>()
      task.rejectedReasons = [...new Set([...candidate.catalog.excluded.map(e=>e.reason), ...task.report?.checks.filter(c=>!c.passed).flatMap(c=>c.issues)??[]])]
      for (const family of candidate.catalog.families) for (const t of family.variants) if (publishedIds.has(t.id)) added.add(t.id)
    }
    if (job.result && !job.result.items) job.result.items = published.filter(t=>added.has(t.id)).map(({id,name,kind,slide})=>({id,name,kind,slide}))
  }
}
