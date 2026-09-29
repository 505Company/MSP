/** Read-only replay of captured evidence. No bucket writes or model requests. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateRefinementReply } from '../lib/design-system/refinement'
import type { VisualManifest } from '../lib/digital-designer/visual-package'
import type { RefinementJob } from '../lib/design-system/refinement-contract'
const directory = resolve(process.argv[2] ?? 'outputs/diagnostics/refinement-recovery')
const read = async <T>(name: string) => JSON.parse(await readFile(resolve(directory, name), 'utf8')) as T
const visual = await read<VisualManifest>('visual.json'), job = await read<RefinementJob>('job.json')
const run = await read<{ id: string }>('model-run.json'), task = job.tasks.find(t => t.runId === run.id)!
const response = await read<{ content: string }>('clarification-response.json')
const raw = JSON.parse(response.content), before = JSON.stringify(raw)
const reply = validateRefinementReply(raw, visual, job, task.slide)
if (before !== JSON.stringify(raw)) throw Error('Replay changed raw evidence')
const result = { accepted: true, slide: task.slide, blocks: reply.slides[0].blocks.length, noteLength: reply.slides[0].note.length, paidRequests: 0, rawUnchanged: true }
await writeFile(resolve(directory, 'replay.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
