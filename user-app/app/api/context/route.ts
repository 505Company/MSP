import { NextResponse } from "next/server"
import { objectBucket } from "@/lib/uploads/cloudflare-repository"

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get("file")
    const text = form.get("text")
    if (file instanceof File && (!/\.(txt|md)$/i.test(file.name) || file.size > 2 * 1024 * 1024 || !file.size)) {
      return NextResponse.json({ error: "Выберите TXT или MD до 2 МБ" }, { status: 400 })
    }
    const content = file instanceof File ? new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) : typeof text === "string" ? text : ""
    if (!content.trim() || content.length > 100_000 || content.includes("\0")) return NextResponse.json({ error: "Нужен текст до 100 000 символов в UTF-8" }, { status: 400 })
    const id = crypto.randomUUID()
    const context = { id, name: file instanceof File ? file.name : "Контекст презентации", text: content, createdAt: new Date().toISOString() }
    await objectBucket().put(`presentation-context/${id}.json`, JSON.stringify(context), { httpMetadata: { contentType: "application/json" } })
    return NextResponse.json({ context })
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить контекст. Проверьте кодировку UTF-8 и повторите." }, { status: 400 })
  }
}
