"use client"
/* eslint-disable @next/next/no-img-element -- original design-system cover */
import { useState } from 'react'
import type { BankStyle } from '@/lib/workspace/types'

export function Palette({ style }: { style: Pick<BankStyle, 'colors'> }) {
  return <span className="m2-palette" aria-hidden="true">{style.colors.slice(0, 4).map((color, i) => <i key={i} style={{ background: color }} />)}<b /><em /></span>
}

export function StyleThumbnail({ style }: { style: BankStyle }) {
  const src = style.previewId ? `/api/uploads/${style.id}/assets/preview-${style.previewId}` : ''
  const [failed, setFailed] = useState('')
  return <span className="msp-style-thumbnail" aria-hidden="true">{src && failed !== src
    ? <img src={src} loading="lazy" alt="" onError={() => setFailed(src)} />
    : <Palette style={style} />}</span>
}
