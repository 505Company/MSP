import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readBackgroundCatalog } from '@/lib/design-system/background-storage'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  try { return NextResponse.json(await readBackgroundCatalog(objectBucket(), id), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось прочитать фоны' }, { status: 409 }) }
}
