"use client"

import * as React from "react"
import Link from "@/components/site-link"
import {
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ServerCog,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UploadDialog } from "@/components/upload-dialog"
import { hasParsedSource, type UploadJob } from "@/lib/uploads/domain"
import { readProcessingResponse } from "@/lib/uploads/read-processing-response"

type QwenCapability = {
  configured: boolean
  region: string
  model: string
}

export function UploadsPage() {
  const [uploads, setUploads] = React.useState<UploadJob[]>([])
  const [capability, setCapability] = React.useState<QwenCapability | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/uploads", { cache: "no-store" })
      const result = (await response.json()) as { uploads?: UploadJob[]; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Не удалось получить очередь")
      setUploads(result.uploads ?? [])
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось получить очередь")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    void fetch("/api/capabilities/qwen", { cache: "no-store" })
      .then(async (response) => (await response.json()) as QwenCapability)
      .then((result) => setCapability(result))
      .catch(() => undefined)

    const changed = () => void refresh()
    window.addEventListener("style-bank:uploads-changed", changed)
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => {
      window.clearTimeout(initialRefresh)
      window.removeEventListener("style-bank:uploads-changed", changed)
      window.clearInterval(timer)
    }
  }, [refresh])

  async function retry(upload: UploadJob) {
    try {
      const response = await fetch(`/api/uploads/${upload.id}/retry`, { method: "POST" })
      const result = await readProcessingResponse<{ error?: string }>(response)
      if (!response.ok) throw new Error(result.error ?? "Не удалось повторить обработку")
      toast.success("Обработка возобновлена", {
        description: hasParsedSource(upload)
          ? "Повторяем анализ Qwen, локальный разбор сохранён."
          : "Повторяем обработку с сохранённого исходника.",
      })
      await refresh()
    } catch (error) {
      toast.error("Не удалось повторить обработку", {
        description: error instanceof Error ? error.message : "Повторите попытку.",
      })
    }
  }

  const processing = uploads.filter((upload) => ["queued", "processing"].includes(upload.status)).length
  const attention = uploads.filter((upload) =>
    ["needs_attention", "ready_for_review", "failed"].includes(upload.status)
  ).length
  const ready = uploads.filter((upload) => upload.status === "ready_for_review").length

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-8 lg:px-8 xl:px-10">
      <div className="flex flex-col gap-5 border-b border-black/[0.06] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[12px] font-medium text-[#7d8590]">Очередь и история обработки</p>
          <h1 className="text-[30px] font-semibold tracking-[-0.045em] text-[#14181e] md:text-[34px]">
            Загрузки
          </h1>
        </div>
        <UploadDialog />
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-3">
        <Metric label="В работе" value={String(processing)} icon={<Clock3 className="size-4" />} tone="blue" />
        <Metric label="Требует решения" value={String(attention)} icon={<AlertTriangle className="size-4" />} tone="amber" />
        <Metric label="Готово к ревью" value={String(ready)} icon={<Check className="size-4" />} tone="green" />
      </div>

      {capability && !capability.configured ? (
        <div className="mt-5 flex flex-col gap-3 rounded-[15px] border border-[#ead4aa] bg-[#fff9ef] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white text-[#a66a12] shadow-sm">
              <ServerCog className="size-4" />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-[#62430f]">Qwen пока не подключён к серверу</p>
              <p className="mt-1 text-[11px] leading-4 text-[#8a6a34]">
                PPTX будет сохранён и реально разобран. После добавления серверного ключа анализ можно продолжить без повторной загрузки.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="w-fit border-[#e5c994] bg-white text-[#8c5a0f]">
            {capability.region} · {capability.model}
          </Badge>
        </div>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-[20px] border border-black/[0.07] bg-white shadow-[0_2px_10px_rgba(25,34,50,0.025)]">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4.5 sm:px-6">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Последние файлы</h2>
            <p className="mt-1 text-[11px] text-[#8b929c]">
              Каждый файл хранится и обрабатывается независимо
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Обновить" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[#78818c]">
            <LoaderCircle className="size-4 animate-spin text-[#1469ff]" />Загружаем очередь
          </div>
        ) : loadError ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <AlertTriangle className="size-5 text-[#b97719]" />
            <p className="mt-3 text-[13px] font-medium">Хранилище временно недоступно</p>
            <p className="mt-1 max-w-md text-[11px] text-[#8a929c]">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>Повторить</Button>
          </div>
        ) : uploads.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-[12px] bg-[#edf3ff] text-[#1469ff]">
              <Clock3 className="size-4" />
            </span>
            <p className="mt-3 text-[13px] font-medium">Реальная очередь пока пуста</p>
            <p className="mt-1 max-w-sm text-[11px] leading-4 text-[#8a929c]">
              Загрузите PPTX — файл попадёт в хранилище, а его структура будет разобрана без передачи исходника в Qwen.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-black/[0.055] bg-[#fafbfc] hover:bg-[#fafbfc]">
                  <TableHead className="h-11 min-w-[270px] pl-6 text-[11px] font-medium text-[#7f8792]">Файл</TableHead>
                  <TableHead className="h-11 text-[11px] font-medium text-[#7f8792]">Слайды</TableHead>
                  <TableHead className="h-11 min-w-[260px] text-[11px] font-medium text-[#7f8792]">Этап</TableHead>
                  <TableHead className="h-11 text-[11px] font-medium text-[#7f8792]">Обновлено</TableHead>
                  <TableHead className="h-11 pr-6 text-right text-[11px] font-medium text-[#7f8792]">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploads.map((upload) => (
                  <TableRow key={upload.id} className="border-black/[0.055] hover:bg-[#fafbfd]">
                    <TableCell className="py-4 pl-6">
                      <p className="max-w-[320px] truncate text-[13px] font-medium">{upload.fileName}</p>
                      <p className="mt-1 text-[11px] text-[#9198a1]">{batchLabel(upload.batchId)} · {formatBytes(upload.sizeBytes)}</p>
                    </TableCell>
                    <TableCell className="text-[12px] tabular-nums text-[#646d79]">{upload.slideCount ?? "—"}</TableCell>
                    <TableCell className="py-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[12px] text-[#535d69]">{upload.stage}</span>
                        <StatusBadge upload={upload} />
                      </div>
                      {["queued", "processing"].includes(upload.status) ? (
                        <Progress
                          value={upload.progress}
                          className="mt-2.5 h-1.5 bg-[#e7ebf0] [&_[data-slot=progress-indicator]]:bg-[#1469ff]"
                        />
                      ) : null}
                      {upload.errorMessage ? (
                        <p className="mt-2 max-w-md text-[10px] leading-4 text-[#a14b55]">{/timeout/i.test(upload.errorMessage) ? "Модель не успела завершить анализ. Разбор сохранён — его можно открыть или повторить анализ." : upload.errorMessage}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-[12px] text-[#8a929c]">{formatTime(upload.updatedAt)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-2">
                      {hasParsedSource(upload) ? <Button asChild variant="outline" size="sm" className="text-[11px]"><Link href={`/uploads/${upload.id}`}>Открыть разбор</Link></Button> : null}
                      {["failed", "needs_attention"].includes(upload.status) ? (
                        <Button variant="outline" size="sm" onClick={() => void retry(upload)} className="border-black/[0.08] text-[11px] shadow-none">
                          <RefreshCw className="size-3.5" />Повторить
                        </Button>
                      ) : upload.status === "ready_for_review" ? (
                        <Badge variant="outline" className="border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]">Черновик готов</Badge>
                      ) : (
                        <Button variant="ghost" size="sm" disabled className="text-[11px] text-[#7d8590]">В работе</Button>
                      )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

function StatusBadge({ upload }: { upload: UploadJob }) {
  if (upload.status === 'cancelled') return <Badge variant="outline">Отменено</Badge>
  if (upload.status === "failed") {
    return <Badge variant="outline" className="border-[#f1c5c9] bg-[#fff4f4] text-[#a03b48]">Ошибка</Badge>
  }
  if (upload.status === "needs_attention") {
    return <Badge variant="outline" className="border-[#f1d2a1] bg-[#fff6e7] text-[#925c11]">Нужно действие</Badge>
  }
  if (upload.status === "ready_for_review") {
    return <Badge variant="outline" className="border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]">Готово</Badge>
  }
  return null
}

function batchLabel(batchId: string): string {
  return `Партия ${batchId.slice(-8).toUpperCase()}`
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function Metric({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone: "blue" | "amber" | "green"
}) {
  const tones = {
    blue: "bg-[#edf3ff] text-[#1469ff]",
    amber: "bg-[#fff5e8] text-[#a96308]",
    green: "bg-[#eaf8f0] text-[#2a7b4d]",
  }

  return (
    <div className="flex items-center justify-between rounded-[16px] border border-black/[0.065] bg-white p-4.5">
      <div>
        <p className="text-[11px] font-medium text-[#858d98]">{label}</p>
        <p className="mt-1 text-[25px] font-semibold leading-none tracking-[-0.04em]">{value}</p>
      </div>
      <span className={`flex size-9 items-center justify-center rounded-[11px] ${tones[tone]}`}>{icon}</span>
    </div>
  )
}
