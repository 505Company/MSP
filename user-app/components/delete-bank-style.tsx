"use client"
import { useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import type { BankStyle } from '@/lib/workspace/types'
import { workspaceRequest } from './workspace-data'
import { cancelDesignSystem } from '@/lib/uploads/cancellation-client'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog'

export function DeleteBankStyle({ style, compact = false, onDeleted }: { style: BankStyle; compact?: boolean; onDeleted: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function remove() {
    if (busy) return
    setBusy(true); setError('')
    try {
      await workspaceRequest(`/api/style-bank/${style.id}`, { method: 'DELETE' })
      cancelDesignSystem(style.id)
      window.dispatchEvent(new Event('style-bank:uploads-changed'))
    } catch {
      setError('Не удалось удалить дизайн-систему. Попробуйте ещё раз.')
      setBusy(false)
      return
    }
    setBusy(false); setOpen(false)
    onDeleted()
  }
  return <AlertDialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError('') } }}>
    <AlertDialogTrigger asChild><button type="button" className={compact ? 'ws-style-delete' : 'pw-outline ws-delete-button'} aria-label={`Удалить дизайн-систему ${style.name}`} title="Удалить из банка стилей"><Trash2 size={17} aria-hidden="true" />{!compact && 'Удалить'}</button></AlertDialogTrigger>
    <AlertDialogContent className="ws-delete-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Удалить «{style.name}» из банка стилей?</AlertDialogTitle>
        <AlertDialogDescription>Дизайн-система исчезнет из банка, её обработка остановится. Уже созданные презентации и их оформление сохранятся.</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="ws-delete-error">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); void remove() }}>{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{busy ? 'Удаляем…' : 'Удалить из банка'}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
