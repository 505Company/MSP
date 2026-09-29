import { waitUntil } from "cloudflare:workers"
import { NextResponse } from "next/server"
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { readCapabilities, startCapabilities } from '@/lib/uploads/qwen-capabilities'
import { processingResponse } from '@/lib/uploads/processing-response'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    await readCapabilities(objectBucket(), modelConfig()),
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const started = await startCapabilities(objectBucket(), modelConfig())
    if (!started.execute) return NextResponse.json({ run: started.run }, { headers: { 'Cache-Control': 'no-store' } })
    const { response, completion } = processingResponse({ run: started.run }, started.execute)
    waitUntil(completion)
    return response
  } catch (error) {
    return NextResponse.json({ error: error instanceof QwenAnalysisError ? error.message : 'Не удалось проверить подключение модели.' }, { status: 409 })
  }
}
