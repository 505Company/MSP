import { createCloudflareUploadRepository,ensureUploadSchema,objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody,validateImportDescriptor,TransferError } from '@/lib/uploads/binary-contract'
import { createBinarySession } from '@/lib/uploads/binary-session'
import { TRANSFER_LIMITS } from '@/lib/uploads/transfer-limits'
import { transferFailure } from '@/lib/uploads/transfer-response'
export const dynamic='force-dynamic'
export async function POST(request:Request){
  try{
    const bytes=await readLimitedBody(request,TRANSFER_LIMITS.manifestBytes)
    let raw:unknown
    try{raw=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new TransferError('Не удалось прочитать описание шаблона')}
    let descriptor
    try{descriptor=validateImportDescriptor(raw)}catch(error){throw new TransferError(error instanceof Error&&error.message.startsWith('Суммарный')?error.message:'Не удалось проверить структуру шаблона')}
    await ensureUploadSchema()
    return Response.json(await createBinarySession(objectBucket(),createCloudflareUploadRepository(),descriptor),{status:201})
  }catch(error){return transferFailure(error)}
}
