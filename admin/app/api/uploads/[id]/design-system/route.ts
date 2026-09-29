import { NextResponse } from "next/server"
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from "@/lib/uploads/cloudflare-repository"
import { restorePresentationProfile } from "@/lib/uploads/pptx-profiler"
import { buildDesignSystemDraft } from "@/lib/uploads/design-system"
import type { QwenStyleAnalysis } from "@/lib/uploads/qwen-analysis"

export const dynamic = "force-dynamic"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureUploadSchema()
    const { id } = await context.params
    const upload = await createCloudflareUploadRepository().get(id)
    if (!upload) return NextResponse.json({ error: "Файл не найден" }, { status: 404 })
    if (!upload.profileObjectKey) return NextResponse.json({ error: "Разбор структуры ещё не завершён" }, { status: 409 })
    const bucket = objectBucket()
    const saved = await bucket.get(upload.profileObjectKey)
    if (!saved) return NextResponse.json({ error: "Сохранённый разбор недоступен" }, { status: 404 })
    const profile = await restorePresentationProfile(await saved.json(), upload.fileName, async () => {
      const source = upload.sourceObjectKey ? await bucket.get(upload.sourceObjectKey) : null
      if (!source) throw new Error("Source unavailable")
      return new Uint8Array(await source.arrayBuffer())
    })
    const result = upload.analysisObjectKey && upload.qwenStatus === "analyzed" ? await bucket.get(upload.analysisObjectKey) : null
    const analysis = result ? (await result.json<{ analysis?: QwenStyleAnalysis }>()).analysis ?? null : null
    const draft = buildDesignSystemDraft(profile, analysis)
    const download = new URL(request.url).searchParams.get("download") === "1"
    return NextResponse.json({ upload, draft }, { headers: {
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="design-system-${id}.json"` } : {}),
    } })
  } catch {
    return NextResponse.json({ error: "Не удалось открыть разбор. Исходная презентация сохранена; попробуйте ещё раз." }, { status: 500 })
  }
}
