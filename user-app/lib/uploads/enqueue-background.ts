import {env} from 'cloudflare:workers'
import type {UploadJob} from './domain'
import {objectBucket} from './cloudflare-repository'
import {enqueueProcessingJob} from './processing-jobs'
/** A durable acknowledgment replaces the browser-owned long request only when
 * a separate worker is configured. No queueing before the source is saved. */
export async function enqueueBackgroundUpload(upload:UploadJob,restart=false){
 if(!env.MSP_WORKER_TOKEN||!env.INTELION_API_KEY)return false
 const bucket=objectBucket()
 if(!await bucket.head(`visual/${upload.id}/manifest.json`))return false
 await enqueueProcessingJob(bucket,upload.id,upload.fileName,restart)
 return true
}
