import { NextResponse } from "next/server"

import {
  createCloudflareUploadRepository,
  ensureUploadSchema,
} from "@/lib/uploads/cloudflare-repository"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureUploadSchema()
  const { id } = await context.params
  const upload = await createCloudflareUploadRepository().get(id)
  if (!upload) return NextResponse.json({ error: "Загрузка не найдена" }, { status: 404 })
  return NextResponse.json({ upload }, { headers: { "Cache-Control": "no-store" } })
}

