import { ZodError } from 'zod'
import { TransferError } from './binary-contract'
export function transferFailure(error:unknown){
  const status=error instanceof TransferError?error.status:error instanceof ZodError?400:500
  const message=error instanceof TransferError?error.message:error instanceof ZodError?'Не удалось проверить структуру загрузки': 'Не удалось сохранить шаблон. Повторите загрузку.'
  return Response.json({error:message},{status})
}
