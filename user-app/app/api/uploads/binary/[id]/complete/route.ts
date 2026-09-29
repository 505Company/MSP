import {enqueueBackgroundUpload} from '@/lib/uploads/enqueue-background'
import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { waitUntil } from 'cloudflare:workers'
import { createCloudflareUploadRepository,ensureUploadSchema,objectBucket } from '@/lib/uploads/cloudflare-repository'
import { completeBinarySession } from '@/lib/uploads/binary-session'
import { processingResponse } from '@/lib/uploads/processing-response'
import { processUploadJob } from '@/lib/uploads/process-upload'
import { transferFailure } from '@/lib/uploads/transfer-response'
export const dynamic='force-dynamic'
export async function POST(_request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    await assertUploadActive(objectBucket(),id)
    await ensureUploadSchema()
    const {job,created}=await completeBinarySession(objectBucket(),createCloudflareUploadRepository(),id)
    const accepted=job?[job]:[]
    if(!created)return Response.json({accepted,rejected:[]})
    if(job&&await enqueueBackgroundUpload(job))return Response.json({accepted,rejected:[],background:true},{status:202})
    const {response,completion}=processingResponse({accepted,rejected:[]},signal=>processUploadJob(id,signal))
    waitUntil(completion)
    return response
  }catch(error){return uploadCancellationResponse(error) ?? transferFailure(error)}
}
