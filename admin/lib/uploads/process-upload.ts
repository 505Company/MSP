import {
  createCloudflareUploadRepository,
  ensureUploadSchema,
  objectBucket,
} from "@/lib/uploads/cloudflare-repository"
import { MAX_SLIDES } from "@/lib/uploads/domain"
import { restorePresentationProfile, sha256 } from "@/lib/uploads/pptx-profiler"
import { buildQwenInput, QWEN_PROMPT_VERSION } from "@/lib/uploads/qwen-input"
import { analyzeStyleWithQwen } from "@/lib/uploads/qwen-client"
import { QwenAnalysisError } from "@/lib/uploads/qwen-analysis"

class ProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export async function processUploadJob(jobId: string, signal?: AbortSignal): Promise<void> {
  await ensureUploadSchema()
  const repository = createCloudflareUploadRepository()
  const bucket = objectBucket()
  const job = await repository.get(jobId)
  if (!job?.sourceObjectKey) return
  const sourceObjectKey = job.sourceObjectKey

  try {
    await repository.update(jobId, {
      status: "processing",
      stage: job.profileObjectKey ? "Повтор анализа Qwen" : "Разбор структуры",
      progress: job.profileObjectKey ? 68 : 24,
      qwenStatus: "pending",
      errorCode: null,
      errorMessage: null,
    })

    signal?.throwIfAborted()
    const savedProfile = job.profileObjectKey ? await bucket.get(job.profileObjectKey) : null
    const profile = await restorePresentationProfile(savedProfile ? await savedProfile.json() : null, job.fileName, async () => {
      await repository.update(jobId, { stage: "Разбор структуры", progress: 24 })
      const source = await bucket.get(sourceObjectKey)
      if (!source) throw new ProcessingError("SOURCE_NOT_FOUND", "Исходный PPTX не найден в хранилище")
      return new Uint8Array(await source.arrayBuffer())
    })
    signal?.throwIfAborted()
    if (profile.source.slideCount > MAX_SLIDES) {
      throw new ProcessingError(
        "TOO_MANY_SLIDES",
        `В файле ${profile.source.slideCount} слайдов; максимум — ${MAX_SLIDES}`
      )
    }

    const profileObjectKey = `profiles/${job.batchId}/${job.id}.json`
    await bucket.put(profileObjectKey, JSON.stringify(profile), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { sourceSha256: profile.source.sha256 },
    })

    await repository.update(jobId, {
      stage: "Анализ Qwen",
      progress: 68,
      slideCount: profile.source.slideCount,
      objectCount: profile.primitives.length,
      colorCount: profile.palette.length,
      typographyCount: profile.typography.length,
      warningCount: profile.warnings.reduce((sum, warning) => sum + warning.count, 0),
      profileObjectKey,
      qwenStatus: "processing",
    })

    const qwenInput = buildQwenInput(profile)
    const inputJson = JSON.stringify(qwenInput)
    const inputSha256 = await sha256(new TextEncoder().encode(inputJson))
    const inputObjectKey = `qwen-inputs/${job.batchId}/${job.id}/${inputSha256}.json`
    await bucket.put(inputObjectKey, inputJson, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { sourceSha256: profile.source.sha256, schemaVersion: qwenInput.schemaVersion },
    })
    const qwen = await analyzeStyleWithQwen(qwenInput, signal)
    if (qwen.status === "not_configured") {
      await repository.update(jobId, {
        status: "needs_attention",
        stage: "Нужна настройка Qwen",
        progress: 68,
        qwenStatus: "not_configured",
      })
      await repository.audit({
        actorId: "system",
        action: "upload.parsed",
        entityType: "upload_job",
        entityId: jobId,
        details: { qwenStatus: "not_configured", inputObjectKey, inputSha256 },
      })
      return
    }

    const analysisObjectKey = `analyses/${job.batchId}/${job.id}.json`
    await bucket.put(
      analysisObjectKey,
      JSON.stringify({
        schemaVersion: "0.2.0",
        provider: "intelion",
        model: qwen.model,
        promptVersion: QWEN_PROMPT_VERSION,
        input: { objectKey: inputObjectKey, sha256: inputSha256, schemaVersion: qwenInput.schemaVersion, sourceSha256: profile.source.sha256 },
        responseFormat: qwen.format,
        generatedAt: new Date().toISOString(),
        analysis: qwen.analysis,
      }),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } }
    )

    await repository.update(jobId, {
      status: "ready_for_review",
      stage: "Черновик подготовлен",
      progress: 100,
      qwenStatus: "analyzed",
      analysisObjectKey,
    })
    await repository.audit({
      actorId: "system",
      action: "upload.analyzed",
      entityType: "upload_job",
      entityId: jobId,
      details: { responseFormat: qwen.format, model: qwen.model, inputObjectKey, inputSha256 },
    })
  } catch (error) {
    const code = signal?.aborted
      ? "PROCESSING_INTERRUPTED"
      : error instanceof ProcessingError || error instanceof QwenAnalysisError ? error.code : "PROCESSING_FAILED"
    const message = safeMessage(error)
    await repository.update(jobId, {
      status: error instanceof QwenAnalysisError ? "needs_attention" : "failed",
      stage: error instanceof QwenAnalysisError ? "Разбор сохранён · анализ не завершён" : "Обработка остановлена",
      qwenStatus: error instanceof QwenAnalysisError || ["PROCESSING_FAILED", "PROCESSING_INTERRUPTED"].includes(code) ? "failed" : "pending",
      errorCode: code,
      errorMessage: message,
    })
    await repository.audit({
      actorId: "system",
      action: "upload.failed",
      entityType: "upload_job",
      entityId: jobId,
      details: { code, message },
    })
  }
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Неизвестная ошибка обработки"
  return error.message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 700)
}
