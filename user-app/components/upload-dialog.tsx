"use client"

import * as React from "react"
import { Check, FileUp, LoaderCircle, UploadCloud, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { readProcessingResponse } from "@/lib/uploads/read-processing-response"

type UploadDialogProps = {
  trigger?: React.ReactNode
}

export function UploadDialog({ trigger }: UploadDialogProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [files, setFiles] = React.useState<File[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  function addFiles(list: FileList | null) {
    if (!list) return
    const selected = Array.from(list)
    const invalid = selected.filter(
      (file) => !file.name.toLowerCase().endsWith(".pptx") || file.size > 100 * 1024 * 1024
    )
    if (invalid.length) {
      toast.error("Часть файлов не добавлена", {
        description: "Поддерживаются PPTX размером до 100 МБ.",
      })
    }
    const next = selected
      .filter(
        (file) => file.name.toLowerCase().endsWith(".pptx") && file.size <= 100 * 1024 * 1024
      )
      .slice(0, Math.max(0, 20 - files.length))
    setFiles((current) => [...current, ...next])
  }

  async function submit() {
    if (!files.length) return
    setSubmitting(true)
    try {
      const body = new FormData()
      for (const file of files) body.append("files", file)
      const response = await fetch("/api/uploads", { method: "POST", body })
      const result = await readProcessingResponse<{
        error?: string
        accepted?: Array<{ id: string }>
        rejected?: Array<{ fileName: string; reason: string }>
      }>(response)
      if (!response.ok && !result.accepted?.length) {
        throw new Error(result.error ?? result.rejected?.[0]?.reason ?? "Не удалось создать задачи")
      }

      setSubmitting(false)
      setFiles([])
      setOpen(false)
      toast.success("Презентации добавлены в обработку", {
        description: result.rejected?.length
          ? `Принято: ${result.accepted?.length ?? 0}. Ошибок: ${result.rejected.length}.`
          : "Разбор запущен. Оставьте эту вкладку открытой до его завершения.",
      })
      window.dispatchEvent(new Event("style-bank:uploads-changed"))
    } catch (error) {
      setSubmitting(false)
      toast.error("Не удалось загрузить презентации", {
        description: error instanceof Error ? error.message : "Повторите попытку.",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="h-10 rounded-[10px] bg-[#1469ff] px-4 text-[14px] shadow-[0_8px_22px_rgba(20,105,255,0.2)] hover:bg-[#0c5de9]">
            <UploadCloud className="size-4" />
            Загрузить PPTX
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden rounded-[20px] border-black/[0.08] p-0 sm:max-w-[620px]">
        <DialogHeader className="px-6 pb-5 pt-6">
          <DialogTitle className="text-[20px] tracking-[-0.03em]">
            Загрузить презентации
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-5">
            Выберите до 20 PPTX для извлечения палитры, шрифтов и композиционных правил.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              addFiles(event.dataTransfer.files)
            }}
            className="group flex min-h-48 w-full flex-col items-center justify-center rounded-[16px] border border-dashed border-[#bfc7d2] bg-[#f8fafc] px-8 text-center transition-colors hover:border-[#1469ff]/55 hover:bg-[#f5f8ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1469ff]/15"
          >
            <span className="mb-4 flex size-11 items-center justify-center rounded-[13px] border border-black/[0.06] bg-white text-[#1469ff] shadow-sm">
              <FileUp className="size-5" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.015em]">
              Перетащите PPTX сюда
            </span>
            <span className="mt-1.5 text-[13px] text-[#7c8490]">
              или нажмите, чтобы выбрать файлы
            </span>
            <span className="mt-4 text-[11px] text-[#a0a7b0]">
              До 100 МБ и 300 слайдов на файл
            </span>
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            multiple
            onChange={(event) => addFiles(event.target.files)}
          />

          {files.length ? (
            <div className="mt-4 space-y-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3 rounded-[11px] border border-black/[0.06] bg-white px-3 py-2.5"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-[#edf3ff] text-[#1469ff]">
                    <Check className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{file.name}</p>
                    <p className="mt-0.5 text-[11px] text-[#8b929c]">
                      {(file.size / 1024 / 1024).toFixed(1)} МБ
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Удалить ${file.name}`}
                    onClick={() =>
                      setFiles((current) => current.filter((_, item) => item !== index))
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {submitting ? (
            <div className="mt-5 rounded-[12px] bg-[#f6f8fb] p-4">
              <div className="mb-3 flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-2 font-medium">
                  <LoaderCircle className="size-3.5 animate-spin text-[#1469ff]" />
                  Загружаем в защищённое хранилище
                </span>
                <span className="text-[#7c8490]">Не закрывайте окно</span>
              </div>
              <Progress value={62} className="h-1.5 bg-[#dfe6f0] [&_[data-slot=progress-indicator]]:bg-[#1469ff]" />
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-black/[0.06] bg-[#fafbfc] px-6 py-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button
            disabled={!files.length || submitting}
            onClick={submit}
            className="bg-[#1469ff] hover:bg-[#0c5de9]"
          >
            {submitting ? "Добавляем…" : `Начать анализ${files.length ? ` · ${files.length}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
