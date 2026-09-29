"use client"
/* eslint-disable @next/next/no-img-element -- original local Figma icons */
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from '../site-link'
import { DesignSystemProgress } from '../design-system-progress'
import './msp2.css'

const icons: Record<string, string> = { wand: '66-1535-imgWandSparkles', sparkles: '66-1535-imgSparkles', bulb: '66-1535-imgLightbulb', clip: '66-1535-imgPaperclip', generate: '66-1535-imgWandSparkles1', arrow: '66-1535-imgArrowRight', check: '66-1535-imgCheck', settings: '66-1535-imgSettings2', down: '66-1535-imgChevronDown', right: '71-805-imgChevronRight', more: '71-805-imgEllipsis', edit: '71-805-imgPencil', refresh: '71-805-imgRefreshCw', plus: '71-805-imgPlus', cardArrow: '66-1357-imgArrowRight' }
export function Icon({ name }: { name: string }) { return <span className="m2-icon" aria-hidden="true"><img src={`/msp2/${icons[name]}.svg`} alt="" /></span> }
/** Shared presentation shell; routing and generation stay with each product. */
export function PresentationShell({ children, base = '', classic = false }: { children: ReactNode; base?: string; classic?: boolean }) {
  const path = usePathname()
  return <div className={`msp2${classic ? ' msp-classic' : ''}`}><header className="m2-header">
    <Link href={base || '/'} className="m2-brand" aria-label={classic ? 'Слайды — главная' : 'Слайды — MSP 2'}><span className="m2-logo" aria-hidden="true"><i /><b /><em /><small /></span><span>Слайды</span></Link>
    <div className="m2-header-actions"><nav aria-label="Основная навигация"><Link href={`${base}/styles`} aria-current={path.includes('/styles') ? 'page' : undefined}>Дизайн система</Link>{classic && <Link href="/recipes" aria-current={path.startsWith('/recipes') ? 'page' : undefined}>Рецепты</Link>}<Link href={`${base}/projects`} aria-current={path.includes('/projects') ? 'page' : undefined}>Проекты</Link></nav>
      <Link href={`${base}/create`} className="m2-button m2-white" aria-label={classic ? 'Создать новую презентацию' : undefined}><Icon name="wand" />Создать презентацию</Link></div>
  </header><div className="m2-progress" hidden={path !== `${base}/styles` && !path.startsWith(`${base}/styles/`)}><DesignSystemProgress styleBase={`${base}/styles`} /></div><main>{children}</main></div>
}
export function Msp2Shell({ children }: { children: ReactNode }) { return <PresentationShell base="/msp2">{children}</PresentationShell> }
