"use client"
import { useSearchParams } from 'next/navigation'
import { PresentationInput } from './presentation-input'
import { Icon } from './msp2/shell'

export function PresentationWorkspace() {
  const params = useSearchParams()
  return <div className="ws-page ws-home pw m2-create">
    <header className="m2-intro"><span className="m2-eyebrow"><Icon name="sparkles" />AI-генератор</span><h1>Создайте презентацию из вашего текста</h1><p>Добавьте содержание и выберите дизайн-систему — мы соберём слайды в вашем стиле.</p></header>
    <PresentationInput requestedStyle={params.get('template')} />
  </div>
}
