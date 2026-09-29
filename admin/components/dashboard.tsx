"use client"

import Link from "@/components/site-link"
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileUp,
  GitCompareArrows,
  Layers3,
  MoreHorizontal,
  Search,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { UploadDialog } from "@/components/upload-dialog"
import { processingJobs, styleRecords } from "@/lib/mock-data"
import { StyleCard } from "@/components/style-card"
import { StylePreview } from "@/components/style-preview"

export function Dashboard() {
  const published = styleRecords.filter((style) => style.status === "published")

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-8 lg:px-8 xl:px-10">
      <section className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[12px] font-medium text-[#7d8590]">
            Четверг, 17 сентября
          </p>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.045em] text-[#14181e] md:text-[34px]">
            Рабочая очередь
          </h1>
        </div>
        <div className="relative w-full lg:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#959da7]" />
          <input
            aria-label="Найти стиль"
            placeholder="Найти стиль"
            className="h-10 w-full rounded-[11px] border border-black/[0.08] bg-white pl-9 pr-12 text-[13px] shadow-[0_1px_2px_rgba(21,31,46,0.03)] outline-none transition focus:border-[#1469ff]/35 focus:ring-4 focus:ring-[#1469ff]/10"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-black/[0.08] bg-[#f7f8fa] px-1.5 py-0.5 text-[10px] text-[#8c949e]">
            ⌘ K
          </kbd>
        </div>
      </section>

      <UploadDialog
        trigger={
          <button className="group relative mb-8 flex min-h-[148px] w-full items-center overflow-hidden rounded-[20px] border border-[#1469ff]/18 bg-[#f4f7ff] px-6 py-7 text-left outline-none transition-all hover:border-[#1469ff]/34 hover:bg-[#f0f5ff] focus-visible:ring-4 focus-visible:ring-[#1469ff]/15 md:px-8">
            <div className="absolute -right-8 -top-16 size-56 rounded-full border-[36px] border-[#1469ff]/[0.045]" />
            <div className="absolute right-24 top-8 h-16 w-16 rotate-12 rounded-[18px] border border-[#1469ff]/10 bg-white/45 max-md:hidden" />
            <span className="relative mr-5 flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[#1469ff] text-white shadow-[0_10px_24px_rgba(20,105,255,0.22)] transition-transform group-hover:-translate-y-0.5">
              <FileUp className="size-5" />
            </span>
            <span className="relative flex min-w-0 flex-1 flex-col">
              <span className="text-[16px] font-semibold tracking-[-0.02em] text-[#18243a]">
                Загрузить презентации
              </span>
              <span className="mt-1 max-w-xl text-[13px] leading-5 text-[#70809b]">
                Перетащите один или несколько PPTX — мы разберём стиль и найдём совпадения в банке.
              </span>
            </span>
            <span className="relative ml-4 hidden items-center gap-2 rounded-[10px] border border-[#1469ff]/15 bg-white px-3.5 py-2 text-[12px] font-semibold text-[#1c5dc4] shadow-sm md:flex">
              Выбрать файлы
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.78fr)]">
        <section className="overflow-hidden rounded-[20px] border border-black/[0.07] bg-white shadow-[0_2px_10px_rgba(25,34,50,0.025)]">
          <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4.5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-[10px] bg-[#fff5e8] text-[#a96308]">
                <CircleAlert className="size-4" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
                  Требует решения
                </h2>
                <p className="mt-0.5 text-[11px] text-[#8b929c]">2 задачи</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-[12px] text-[#68717d]">
              Все задачи
              <ChevronRight className="size-3.5" />
            </Button>
          </div>

          <div className="divide-y divide-black/[0.055]">
            <Link
              href="/matches/product-academy"
              className="group grid gap-4 p-5 outline-none transition-colors hover:bg-[#fafbfd] focus-visible:bg-[#f5f8ff] sm:grid-cols-[132px_minmax(0,1fr)_auto] sm:items-center sm:px-6"
            >
              <StylePreview variant="education" compact className="rounded-[10px]" />
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge className="border border-[#f1d2a1] bg-[#fff6e7] text-[#925c11]" variant="outline">
                    Совпадение · 84%
                  </Badge>
                  <span className="text-[11px] text-[#969da6]">12 минут назад</span>
                </div>
                <h3 className="truncate text-[14px] font-semibold tracking-[-0.015em]">
                  Product Academy 2026.pptx
                </h3>
                <p className="mt-1 text-[12px] text-[#747d89]">
                  Похож на VK Education · Light
                </p>
              </div>
              <span className="flex h-9 items-center justify-center gap-2 rounded-[9px] border border-black/[0.08] bg-white px-3 text-[12px] font-semibold shadow-sm transition group-hover:border-[#1469ff]/25 group-hover:text-[#1469ff]">
                <GitCompareArrows className="size-3.5" />
                Сравнить
              </span>
            </Link>

            <Link
              href="/review/cobalt-report"
              className="group grid gap-4 p-5 outline-none transition-colors hover:bg-[#fafbfd] focus-visible:bg-[#f5f8ff] sm:grid-cols-[132px_minmax(0,1fr)_auto] sm:items-center sm:px-6"
            >
              <StylePreview variant="finance" compact className="rounded-[10px]" />
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge className="border border-[#d9e3fa] bg-[#f0f5ff] text-[#345f9e]" variant="outline">
                    Ревью · 4 из 5
                  </Badge>
                  <span className="text-[11px] text-[#969da6]">31 минуту назад</span>
                </div>
                <h3 className="truncate text-[14px] font-semibold tracking-[-0.015em]">
                  Cobalt Report · v2
                </h3>
                <p className="mt-1 text-[12px] text-[#747d89]">
                  Раздел «Основы» обновлён Qwen
                </p>
              </div>
              <span className="flex h-9 items-center justify-center gap-2 rounded-[9px] bg-[#1469ff] px-3 text-[12px] font-semibold text-white shadow-[0_6px_16px_rgba(20,105,255,0.18)] transition group-hover:bg-[#0c5de9]">
                <Sparkles className="size-3.5" />
                Проверить
              </span>
            </Link>
          </div>
        </section>

        <section className="rounded-[20px] border border-black/[0.07] bg-white p-5 shadow-[0_2px_10px_rgba(25,34,50,0.025)] sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-[10px] bg-[#edf3ff] text-[#1469ff]">
                <Clock3 className="size-4" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
                  Обрабатывается
                </h2>
                <p className="mt-0.5 text-[11px] text-[#8b929c]">2 файла</p>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Действия">
              <MoreHorizontal className="size-4" />
            </Button>
          </div>

          <div className="space-y-5">
            {processingJobs.map((job) => (
              <div key={job.id}>
                <div className="mb-2.5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{job.name}</p>
                    <p className="mt-1 text-[11px] text-[#8b929c]">
                      {job.stage} · {job.detail}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-[#657184]">
                    {job.stageIndex}/{job.totalStages}
                  </span>
                </div>
                <Progress
                  value={job.progress}
                  className="h-1.5 bg-[#e7ebf0] [&_[data-slot=progress-indicator]]:bg-[#1469ff]"
                />
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            className="mt-6 h-9 w-full rounded-[9px] border-black/[0.08] text-[12px] shadow-none"
            asChild
          >
            <Link href="/uploads">Открыть загрузки</Link>
          </Button>
        </section>
      </div>

      <section id="bank" className="mt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8a929d]">
              <Layers3 className="size-3.5" />
              Банк стилей
            </div>
            <h2 className="text-[23px] font-semibold tracking-[-0.04em] text-[#181c22]">
              Недавно опубликовано
            </h2>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-[12px] text-[#65707d]">
            <Link href="/styles">
              Смотреть все
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {published.slice(0, 3).map((style, index) => (
            <StyleCard key={style.id} style={style} priority={index === 0} />
          ))}
        </div>
      </section>

      <section className="mt-9 flex flex-col items-start justify-between gap-4 rounded-[18px] border border-black/[0.06] bg-white px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#eaf8f0] text-[#2a7b4d]">
            <Check className="size-4" />
          </span>
          <div>
            <p className="text-[13px] font-medium">4 стиля опубликовано за 7 дней</p>
            <p className="mt-0.5 text-[11px] text-[#8d949d]">
              Последний — VK Education, сегодня в 11:15
            </p>
          </div>
        </div>
        <span className="text-[11px] text-[#9aa1aa]">Всего в банке · 18</span>
      </section>
    </div>
  )
}
