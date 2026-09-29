import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { createProject, getBankStyle, listProjects, newProject } from '@/lib/workspace/storage'
import { summarizeProject } from '@/lib/workspace/project-summary'
import { LibraryConflict } from '@/lib/design-system/storage'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const bucket = objectBucket(), projects = await listProjects(bucket)
    const summaries = await Promise.all(projects.map(project => summarizeProject(bucket, project)))
    return NextResponse.json({ projects: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Не удалось открыть проекты. Попробуйте ещё раз.' }, { status: 500 }) }
}
export async function POST(request: Request) {
  try {
    const input = newProject.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 512 * 1024))))
    const bucket = objectBucket(), style = await getBankStyle(bucket, input.uploadId)
    if (!style) return NextResponse.json({ error: 'Выберите дизайн-систему из банка стилей' }, { status: 409 })
    return NextResponse.json({ project: await createProject(bucket, input, style) }, { status: 201 })
  } catch (error) { return NextResponse.json({ error: error instanceof LibraryConflict ? error.message : 'Не удалось создать проект. Проверьте название и содержание (до 100 000 символов).' }, { status: error instanceof LibraryConflict ? 409 : 400 }) }
}
