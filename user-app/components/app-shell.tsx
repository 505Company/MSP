"use client"
import Link from './site-link'
import { usePathname, useSearchParams } from 'next/navigation'
import { designSystemSection, designSystemSections } from './design-system-sections'
import { PresentationShell } from './msp2/shell'
import './msp-classic.css'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(), params = useSearchParams()
  if (pathname === '/msp2' || pathname.startsWith('/msp2/')) return <>{children}</>
  const styleId = pathname.match(/^\/styles\/([^/]+)(?:\/components\/[^/]+)?$/)?.[1]
  const section = designSystemSection(pathname.includes('/components/') ? 'components' : params.get('section'))
  const workspace = pathname === '/' || pathname === '/create' || pathname === '/styles' || pathname.startsWith('/projects')
  return <PresentationShell classic>
    {styleId ? <div className="m2-library"><nav aria-label="Раздел дизайн-системы">{designSystemSections.map(([id, label]) => <Link key={id} href={`/styles/${styleId}?section=${id}`} aria-current={section === id ? 'page' : undefined}>{label}</Link>)}</nav><div className="m2-library-content">{children}</div></div>
      : workspace ? children : <div className="m2-library-content msp-utility">{children}</div>}
  </PresentationShell>
}
