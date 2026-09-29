import { redirect } from 'next/navigation'
export default async function Upload({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; redirect(`/styles/${encodeURIComponent(id)}`) }
