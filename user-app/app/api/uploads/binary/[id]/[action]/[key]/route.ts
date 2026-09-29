import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { uploadSourcePart,uploadVisualObject } from '@/lib/uploads/binary-session'
import { TransferError } from '@/lib/uploads/binary-contract'
import { transferFailure } from '@/lib/uploads/transfer-response'
export const dynamic='force-dynamic'
export async function PUT(request:Request,context:{params:Promise<{id:string;action:string;key:string}>}){
  try{
    const {id,action,key}=await context.params
    if(action==='parts')await uploadSourcePart(objectBucket(),id,/^[1-9][0-9]*$/.test(key)?Number(key):NaN,request)
    else if(action==='assets')await uploadVisualObject(objectBucket(),id,key,request)
    else throw new TransferError('Адрес загрузки не найден',404)
    return Response.json({ok:true})
  }catch(error){return transferFailure(error)}
}
