import {env} from 'cloudflare:workers'
import {objectBucket} from '@/lib/uploads/cloudflare-repository'
import {listProcessingJobs,publicProcessingJob,workerIsAvailable} from '@/lib/uploads/processing-jobs'
import {sourceRecoveryView} from '@/lib/uploads/source-repair'
export const dynamic='force-dynamic'
export async function GET(){
 const configured=!!env.MSP_WORKER_TOKEN,bucket=objectBucket()
 return Response.json({configured,available:configured&&await workerIsAvailable(bucket),jobs:await Promise.all((await listProcessingJobs(bucket)).map(job=>sourceRecoveryView(bucket,publicProcessingJob(job))))},{headers:{'Cache-Control':'no-store'}})
}
