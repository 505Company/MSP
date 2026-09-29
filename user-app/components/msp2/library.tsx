"use client"
import type { ReactNode } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from '../site-link'
import { designSystemSections } from '../design-system-sections'
export function Msp2Library({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>(), params = useSearchParams(), router = useRouter()
  return <div className="m2-library" onClickCapture={e => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="/styles"]')
    if (a && !e.metaKey && !e.ctrlKey && e.button === 0) { e.preventDefault(); e.stopPropagation(); router.push('/msp2' + a.getAttribute('href')) }
  }}><nav aria-label="Раздел дизайн-системы">{designSystemSections.map(([key, label]) => <Link key={key} href={`/msp2/styles/${id}?section=${key}`} aria-current={(params.get('section') ?? 'components') === key ? 'page' : undefined}>{label}</Link>)}</nav><div className="m2-library-content">{children}</div></div>
}
