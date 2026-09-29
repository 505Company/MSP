export type UploadJobStatus =
  | "cancelled"
  | "queued"
  | "processing"
  | "needs_attention"
  | "ready_for_review"
  | "failed"

export type QwenStatus =
  | "cancelled"
  | "pending"
  | "processing"
  | "analyzed"
  | "not_configured"
  | "failed"

export type UploadJob = {
  id: string
  batchId: string
  fileName: string
  sizeBytes: number
  status: UploadJobStatus
  stage: string
  progress: number
  slideCount: number | null
  objectCount: number | null
  colorCount: number | null
  typographyCount: number | null
  warningCount: number | null
  qwenStatus: QwenStatus
  sourceObjectKey: string | null
  profileObjectKey: string | null
  analysisObjectKey: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type CreateUploadJob = Pick<
  UploadJob,
  "id" | "batchId" | "fileName" | "sizeBytes" | "sourceObjectKey"
>

export type UploadJobPatch = Partial<
  Pick<
    UploadJob,
    | "status"
    | "stage"
    | "progress"
    | "slideCount"
    | "objectCount"
    | "colorCount"
    | "typographyCount"
    | "warningCount"
    | "qwenStatus"
    | "sourceObjectKey"
    | "profileObjectKey"
    | "analysisObjectKey"
    | "errorCode"
    | "errorMessage"
  >
>

export type UploadRepository = {
  create(input: CreateUploadJob): Promise<UploadJob>
  get(id: string): Promise<UploadJob | null>
  list(limit?: number): Promise<UploadJob[]>
  update(id: string, patch: UploadJobPatch): Promise<UploadJob>
  audit(input: {
    actorId: string
    action: string
    entityType: string
    entityId: string
    details?: Record<string, unknown>
  }): Promise<void>
}

export const MAX_UPLOAD_FILES = 20
export const MAX_FILE_BYTES = 100 * 1024 * 1024
export const MAX_SLIDES = 300

export function hasParsedSource(job:Pick<UploadJob,'profileObjectKey'|'slideCount'>):boolean {
  return !!job.profileObjectKey || (job.slideCount!==null && job.slideCount>0)
}
