import { redirect } from 'next/navigation'
import { PresentationWorkspace } from '@/components/presentation-workspace'
import { Dashboard } from '@/components/dashboard'
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  if (typeof query.template === 'string' && typeof query.component === 'string') redirect(`/styles/${encodeURIComponent(query.template)}?component=${encodeURIComponent(query.component)}`)
  return typeof query.template === 'string' ? <PresentationWorkspace /> : <Dashboard />
}
