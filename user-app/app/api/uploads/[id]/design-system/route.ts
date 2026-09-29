import { NextResponse } from "next/server"
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from "@/lib/uploads/cloudflare-repository"
import { restorePresentationProfile } from "@/lib/uploads/pptx-profiler"
import { buildDesignSystemDraft } from "@/lib/uploads/design-system"
import type { CheckpointResult } from "@/lib/digital-designer/pipeline"
import type { QwenStyleAnalysis } from "@/lib/uploads/qwen-analysis"

import type { VisualManifest } from "@/lib/digital-designer/visual-package"
import { buildVisualDraft } from "@/lib/design-system/visual-draft"

export const dynamic = "force-dynamic"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureUploadSchema()
    const { id } = await context.params
    const upload = await createCloudflareUploadRepository().get(id)
    if (!upload) return NextResponse.json({ error: "Файл не найден" }, { status: 404 })
    const bucket = objectBucket()
    const visualFile = await bucket.get(`visual/${id}/manifest.json`)
    const visual = visualFile ? await visualFile.json<VisualManifest>() : null
    const result = upload.analysisObjectKey && upload.qwenStatus === "analyzed" ? await bucket.get(upload.analysisObjectKey) : null
    const savedAnalysis = result ? await result.json<{ analysis?: QwenStyleAnalysis; checkpoint?: CheckpointResult }>() : null
    const analysis = savedAnalysis?.analysis ?? null
    let draft
    if(visual)draft=buildVisualDraft(visual,upload,analysis)
    else{
      if (!upload.profileObjectKey) return NextResponse.json({ error: "Разбор структуры ещё не завершён" }, { status: 409 })
      const saved = await bucket.get(upload.profileObjectKey)
      if (!saved) return NextResponse.json({ error: "Сохранённый разбор недоступен" }, { status: 404 })
      const profile = await restorePresentationProfile(await saved.json(), upload.fileName, async () => {
        const source = upload.sourceObjectKey ? await bucket.get(upload.sourceObjectKey) : null
        if (!source) throw new Error("Source unavailable")
        return new Uint8Array(await source.arrayBuffer())
      })
      draft=buildDesignSystemDraft(profile,analysis)
    }
    const download = new URL(request.url).searchParams.get("download") === "1"
    return NextResponse.json({ upload, draft, visual, checkpoint: savedAnalysis?.checkpoint ?? null }, { headers: {
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="design-system-${id}.json"` } : {}),
    } })
  } catch {
    return NextResponse.json({ error: "Не удалось открыть разбор. Исходная презентация сохранена; попробуйте ещё раз." }, { status: 500 })
  }
}
