"use client"
/* eslint-disable @next/next/no-img-element -- generated local slide previews */
import { useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Expand, FileText, X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export type SlidePreview = {
  id: string; title: string; image?: string; content?: ReactNode; kind?: string
  status: string; alternatives?: ReactNode
  selection?: { checked: boolean; disabled?: boolean; onChange: () => void }
}

/** Viewing never invokes generation. The same saved preview is used at both sizes. */
export function PresentationSlideGallery({ slides, className = '' }: { slides: SlidePreview[]; className?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const selected = slides.find(s => s.id === selectedId)
  const available = slides.filter(s => s.image || s.content)
  const position = available.findIndex(s => s.id === selectedId)
  const move = (delta: number) => { const next = available[position + delta]; if (next) setSelectedId(next.id) }
  const preview = (slide: SlidePreview, large = false) => slide.image
    ? <img src={slide.image} alt={large ? slide.title : ''} loading={large ? 'eager' : 'lazy'} />
    : slide.content
  if (!slides.length) return null
  return <>
    <div className="ws-slides-heading"><h2>Слайды</h2><span>{slides.length}</span></div>
    <div className={`ws-deck-previews ${className}`}>
      {slides.map((slide, index) => <figure className={`ws-slide-card${slide.selection?.checked ? ' is-selected' : ''}`} key={slide.id} data-component-kind={slide.kind}>
        {slide.image || slide.content ? <button className="ws-slide-open" aria-label={`Открыть слайд ${index + 1}: ${slide.title}`} onClick={event => { opener.current = event.currentTarget; setSelectedId(slide.id) }}>
          <div className="ws-slide-canvas">{preview(slide)}</div><span className="ws-slide-expand" aria-hidden="true"><Expand size={18} /></span>
        </button> : <div className="ws-slide-placeholder"><FileText size={26} aria-hidden="true" /><span>{slide.status}</span></div>}
        <figcaption><span className="ws-slide-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{slide.title}</strong><span>{slide.status}</span></div></figcaption>
        {slide.selection && <label className="msp-slide-select" title={slide.selection.checked ? 'Снять выбор' : 'Выбрать слайд'}><input type="checkbox" aria-label={`Выбрать слайд ${index + 1}: ${slide.title}`} checked={slide.selection.checked} disabled={slide.selection.disabled} onChange={slide.selection.onChange}/></label>}
        {slide.alternatives}
      </figure>)}
    </div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null) }}>
      <DialogContent className="ws-slide-dialog" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus() }} onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1) }
      }}>
        {selected && <>
          <header><div><DialogTitle>{selected.title === `Слайд ${slides.indexOf(selected) + 1}` ? selected.title : `Слайд ${slides.indexOf(selected) + 1}. ${selected.title}`}</DialogTitle><DialogDescription>{selected.status}</DialogDescription></div><DialogClose className="ws-viewer-button" aria-label="Закрыть просмотр слайда"><X size={21} /></DialogClose></header>
          <div className="ws-slide-large">{preview(selected, true)}</div>
          <footer><button className="ws-viewer-button" disabled={position <= 0} onClick={() => move(-1)} aria-label="Предыдущий слайд"><ChevronLeft size={20} /></button><span>{slides.indexOf(selected) + 1} / {slides.length}</span><button className="ws-viewer-button" disabled={position >= available.length - 1} onClick={() => move(1)} aria-label="Следующий слайд"><ChevronRight size={20} /></button></footer>
        </>}
      </DialogContent>
    </Dialog>
  </>
}
