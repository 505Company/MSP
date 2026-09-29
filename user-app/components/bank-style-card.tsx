"use client"
/* eslint-disable @next/next/no-img-element -- original local presentation previews */
import Link from './site-link'
import { Layers3 } from 'lucide-react'
import type { BankStyle } from '@/lib/workspace/types'
import { DeleteBankStyle } from './delete-bank-style'
import { Icon } from './msp2/shell'
import { Palette } from './style-palette'

export function StyleCover({ style }: { style: BankStyle }) {
  return <div className="ws-style-cover">{style.previewId ? <img src={`/api/uploads/${style.id}/assets/preview-${style.previewId}`} alt={`Превью дизайн-системы ${style.name}`} /> : <span><Layers3 size={28} />{style.name}</span>}</div>
}
export function BankStyleCard({ style, onDeleted }: { style: BankStyle; onDeleted: () => void }) {
  return <article className="msp-card-container"><Link className="m2-card" href={`/styles/${style.id}`} aria-label={`Открыть дизайн-систему ${style.name}`}>
    <div><span className="m2-tag">Дизайн-система</span><h2>{style.name}</h2><p>{style.slideCount} исходных слайдов. Цвета, типографика и компоненты вашей презентации.</p></div>
    <div className="m2-card-preview">{style.previewId ? <img loading="lazy" src={`/api/uploads/${style.id}/assets/preview-${style.previewId}`} alt={`Превью дизайн-системы ${style.name}`} /> : <Palette style={style} />}</div>
    <footer><span>{style.componentCount} компонентов<small>{style.styleCount} стилей</small></span><i><Icon name="cardArrow" /></i></footer>
  </Link><DeleteBankStyle style={style} compact onDeleted={onDeleted} /></article>
}
