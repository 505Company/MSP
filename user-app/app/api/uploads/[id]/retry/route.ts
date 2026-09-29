import { waitUntil } from "cloudflare:workers"
import { NextResponse } from "next/server"

import {
  createCloudflareUploadRepository,
  ensureUploadSchema,
} from "@/lib/uploads/cloudflare-repository"
import { processUploadJob } from "@/lib/uploads/process-upload"
import { processingResponse } from "@/lib/uploads/processing-response"
import { UploadCancelledError } from '@/lib/uploads/cancellation'
import { uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { enqueueBackgroundUpload } from '@/lib/uploads/enqueue-background'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureUploadSchema()
  const { id } = await context.params
  const repository = createCloudflareUploadRepository()
  const upload = await repository.get(id)
  if (!upload) return NextResponse.json({ error: "Загрузка не найдена" }, { status: 404 })
  if (upload.status === 'cancelled') return uploadCancellationResponse(new UploadCancelledError())!
  if (!upload.sourceObjectKey) {
    return NextResponse.json({ error: "Исходный файл недоступен" }, { status: 409 })
  }
  if (await enqueueBackgroundUpload(upload, true)) return NextResponse.json({upload,background:true},{status:202})
  if (["queued", "processing"].includes(upload.status)) {
    return NextResponse.json({ error: "Этот файл уже обрабатывается" }, { status: 409 })
  }

  const updated = await repository.update(id, {
    status: "queued",
    stage: upload.profileObjectKey ? "Повтор анализа Qwen" : "Повтор разбора",
    progress: upload.profileObjectKey ? 68 : 14,
    qwenStatus: "pending",
    errorCode: null,
    errorMessage: null,
  })
  await repository.audit({
    actorId: "local-admin",
    action: "upload.retry_requested",
    entityType: "upload_job",
    entityId: id,
  })
  const { response, completion } = processingResponse(
    { upload: updated },
    (signal) => processUploadJob(id, signal)
  )
  waitUntil(completion)
  return response
}
