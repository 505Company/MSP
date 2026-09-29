import { waitUntil } from "cloudflare:workers"
import { NextResponse } from "next/server"

import {
  createCloudflareUploadRepository,
  ensureUploadSchema,
  objectBucket,
} from "@/lib/uploads/cloudflare-repository"
import { MAX_FILE_BYTES, MAX_UPLOAD_FILES } from "@/lib/uploads/domain"
import { processUploadJob } from "@/lib/uploads/process-upload"
import { processingResponse } from "@/lib/uploads/processing-response"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await ensureUploadSchema()
    const uploads = await createCloudflareUploadRepository().list(100)
    return NextResponse.json(
      { uploads },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    await ensureUploadSchema()
    const form = await request.formData()
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File)
    if (!files.length) {
      return NextResponse.json({ error: "Выберите хотя бы один PPTX" }, { status: 400 })
    }
    if (files.length > MAX_UPLOAD_FILES) {
      return NextResponse.json(
        { error: `В одной партии можно загрузить не больше ${MAX_UPLOAD_FILES} файлов` },
        { status: 400 }
      )
    }

    const repository = createCloudflareUploadRepository()
    const bucket = objectBucket()
    const batchId = `batch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const accepted = []
    const rejected: Array<{ fileName: string; reason: string }> = []
    const processingIds: string[] = []

    for (const file of files) {
      const reason = validateFile(file)
      if (reason) {
        rejected.push({ fileName: file.name, reason })
        continue
      }

      const id = crypto.randomUUID()
      const sourceObjectKey = `sources/${batchId}/${id}.pptx`
      const job = await repository.create({
        id,
        batchId,
        fileName: file.name,
        sizeBytes: file.size,
        sourceObjectKey,
      })

      try {
        await bucket.put(sourceObjectKey, file.stream(), {
          httpMetadata: {
            contentType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
          customMetadata: { uploadJobId: id, batchId },
        })
        await repository.update(id, {
          status: "processing",
          stage: "Файл сохранён",
          progress: 14,
        })
        processingIds.push(id)
        accepted.push({ ...job, status: "processing", stage: "Файл сохранён", progress: 14 })
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Ошибка хранилища"
        await repository.update(id, {
          status: "failed",
          stage: "Загрузка остановлена",
          errorCode: "STORAGE_FAILED",
          errorMessage: message,
        })
        rejected.push({ fileName: file.name, reason: message })
      }
    }

    if (!accepted.length) {
      return NextResponse.json({ batchId, accepted, rejected }, { status: 400 })
    }
    const { response, completion } = processingResponse(
      { batchId, accepted, rejected },
      (signal) => Promise.allSettled(processingIds.map((id) => processUploadJob(id, signal)))
    )
    waitUntil(completion)
    return response
  } catch (error) {
    return failure(error)
  }
}

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".pptx")) return "Поддерживаются только файлы PPTX"
  if (file.size === 0) return "Файл пуст"
  if (file.size > MAX_FILE_BYTES) return "Файл превышает лимит 100 МБ"
  return null
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка"
  return NextResponse.json({ error: message.slice(0, 700) }, { status: 500 })
}
