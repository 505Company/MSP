import { env } from "cloudflare:workers"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    {
      configured: Boolean(env.INTELION_API_KEY),
      region: "rus",
      model: env.INTELION_MODEL ?? "qwen3.8-27b",
      imageInput: "not_tested",
      strictJsonSchema: "not_tested",
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}

