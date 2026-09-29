export class UploadCancelledError extends Error {
  readonly code = 'UPLOAD_CANCELLED'
  constructor() { super('Дизайн-система удалена. Обработка отменена.'); this.name = 'UploadCancelledError' }
}
export function isUploadCancelled(error: unknown): boolean {
  return error instanceof UploadCancelledError || (!!error && typeof error === 'object' && 'code' in error && error.code === 'UPLOAD_CANCELLED')
}
export const cancellationKey = (id: string) => `upload-cancellations/${id}.json`
export const cancellationPatch = {
  status: 'cancelled' as const, qwenStatus: 'cancelled' as const,
  stage: 'Обработка отменена', errorCode: 'UPLOAD_CANCELLED', errorMessage: null,
}
