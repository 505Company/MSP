"use client"

import Link from "@/components/site-link"
import { useParams, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  History,
  MoreHorizontal,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Type,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StyleCard } from "@/components/style-card"
import { StylePreview } from "@/components/style-preview"
import { styleRecords } from "@/lib/mock-data"

const palette = [
  { hex: "#000000", label: "Основной текст", usage: 181 },
  { hex: "#0077FF", label: "Основной акцент", usage: 172 },
  { hex: "#FFFFFF", label: "Фон", usage: 87 },
  { hex: "#EBF3F9", label: "Мягкий фон", usage: 54 },
  { hex: "#FF3885", label: "Дополнительный акцент", usage: 15 },
  { hex: "#7CEDF8", label: "Поддерживающий", usage: 6 },
]

const tabs = [
  ["overview", "Обзор"],
  ["foundations", "Основы"],
  ["elements", "Элементы"],
  ["compositions", "Композиции"],
  ["sources", "Источники"],
  ["history", "История"],
] as const

export function StyleDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const style = styleRecords.find((item) => item.id === params.id) ?? styleRecords[0]
  const justPublished = searchParams.get("published") === "1"
  const displayVersion = searchParams.get("version") ?? style.version
  const isPublished = justPublished || style.status === "published"

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-6 lg:px-8 xl:px-10">
      <div className="mb-6 flex items-center gap-1.5 text-[11px] text-[#89919b]">
        <Link href="/styles" className="flex items-center gap-1.5 transition hover:text-[#28313c]">
          <ArrowLeft className="size-3.5" />
          Банк стилей
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-[#5d6672]">{style.name}</span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                isPublished
                  ? "border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]"
                  : "border-[#d7e2fb] bg-[#f0f5ff] text-[#315c9d]"
              }
            >
              {isPublished ? <Check className="size-3" /> : <Sparkles className="size-3" />}
              {isPublished ? "Опубликован" : "Черновик"}
            </Badge>
            <span className="text-[11px] text-[#939aa3]">Обновлён {style.updatedAt.toLowerCase()}</span>
          </div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.05em] text-[#14181e] md:text-[38px]">
            {style.name}
          </h1>
          <p className="mt-2 text-[13px] text-[#747d89]">
            {style.family} / {style.variant} / {displayVersion}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-10 rounded-[10px] border-black/[0.08] bg-white text-[12px] shadow-none">
            <PencilLine className="size-4" />
            Метаданные
          </Button>
          <Button
            onClick={() => toast.success("Создан рабочий черновик новой версии")}
            className="h-10 rounded-[10px] bg-[#1469ff] text-[12px] hover:bg-[#0c5de9]"
          >
            <Plus className="size-4" />
            Новая версия
          </Button>
          <Button variant="ghost" size="icon" aria-label="Другие действия" className="size-10 rounded-[10px]">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.72fr)]">
        <div className="rounded-[22px] border border-black/[0.07] bg-[#eef1f5] p-3 sm:p-5">
          <StylePreview variant={style.preview} className="rounded-[16px]" />
        </div>
        <aside className="rounded-[22px] border border-black/[0.07] bg-white p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8c949e]">Паспорт стиля</p>
          <dl className="mt-5 divide-y divide-black/[0.055]">
            <DetailRow label="Назначение" value={style.purpose} />
            <DetailRow label="Источники" value={`${style.sourceCount} презентация`} />
            <DetailRow label="Слайды" value={`${style.slideCount}`} />
            <DetailRow label="Уверенность" value={`${style.confidence}%`} />
            <DetailRow label="Версия профайлера" value="0.1.0" />
          </dl>
          <div className="mt-5">
            <p className="mb-2.5 text-[11px] font-medium text-[#8c949e]">Основная палитра</p>
            <div className="flex gap-2">
              {style.palette.map((color) => (
                <span
                  key={color}
                  title={color}
                  className="h-8 flex-1 rounded-[8px] border border-black/[0.07] first:rounded-l-[11px] last:rounded-r-[11px]"
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-black/[0.07] pb-0">
          {tabs.map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="h-11 flex-none px-3 text-[12px]">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="pt-6">
          <Overview />
        </TabsContent>
        <TabsContent value="foundations" className="pt-6">
          <Foundations />
        </TabsContent>
        <TabsContent value="elements" className="pt-6">
          <Elements />
        </TabsContent>
        <TabsContent value="compositions" className="pt-6">
          <Compositions />
        </TabsContent>
        <TabsContent value="sources" className="pt-6">
          <Sources />
        </TabsContent>
        <TabsContent value="history" className="pt-6">
          <HistoryTab />
        </TabsContent>
      </Tabs>

      <section className="mt-11 border-t border-black/[0.06] pt-8">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8a929d]">Похожие</p>
            <h2 className="text-[21px] font-semibold tracking-[-0.035em]">Визуально близкие стили</h2>
          </div>
          <span className="text-[11px] text-[#9299a2]">По палитре и композициям</span>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {styleRecords
            .filter((item) => item.id !== style.id)
            .slice(0, 3)
            .map((item) => (
              <StyleCard key={item.id} style={item} />
            ))}
        </div>
      </section>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
      <dt className="text-[12px] text-[#858d98]">{label}</dt>
      <dd className="text-right text-[12px] font-medium text-[#343b45]">{value}</dd>
    </div>
  )
}

function Overview() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[18px] border border-black/[0.07] bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8a929d]">Покрытие</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em]">Что извлечено из источника</h3>
          </div>
          <Badge variant="outline" className="border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]">Проверено</Badge>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-black/[0.06] bg-[#e8ebef] md:grid-cols-4">
          {[
            ["16", "цветов"],
            ["32", "стиля текста"],
            ["647", "объектов"],
            ["55", "слайдов"],
          ].map(([value, label]) => (
            <div key={label} className="bg-white p-4.5">
              <p className="text-[25px] font-semibold tracking-[-0.045em]">{value}</p>
              <p className="mt-1 text-[11px] text-[#848c97]">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <Signal title="Высокий контраст" detail="Чёрный текст и яркий синий акцент" />
          <Signal title="Умеренная плотность" detail="Крупные смысловые зоны и свободные поля" />
          <Signal title="Обучающий ритм" detail="Пошаговая подача и повторяемые карточки" />
          <Signal title="Акцентная графика" detail="Геометрия поддерживает, а не заменяет смысл" />
        </div>
      </section>
      <section className="rounded-[18px] border border-black/[0.07] bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <CircleAlert className="size-4 text-[#a96308]" />
          <h3 className="text-[14px] font-semibold">15 предупреждений профайлера</h3>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[#7b848f]">
          Большинство связано с наследованием геометрии из master/layout и не блокирует использование токенов.
        </p>
        <div className="mt-5 space-y-3">
          <Warning text="4 объекта используют наследуемый шрифт" />
          <Warning text="7 групп требуют уточнения трансформаций" />
          <Warning text="4 близких цвета оставлены раздельно" />
        </div>
      </section>
    </div>
  )
}

function Signal({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[13px] bg-[#f6f8fa] p-4">
      <p className="text-[12px] font-semibold">{title}</p>
      <p className="mt-1.5 text-[11px] leading-4 text-[#7e8791]">{detail}</p>
    </div>
  )
}

function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[11px] border border-black/[0.055] px-3 py-2.5">
      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#e6a23c]" />
      <span className="text-[11px] leading-4 text-[#59626e]">{text}</span>
    </div>
  )
}

function Foundations() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
      <section className="rounded-[18px] border border-black/[0.07] bg-white p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8a929d]">Палитра</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em]">Основные цветовые токены</h3>
          </div>
          <span className="text-[11px] text-[#9198a1]">16 всего</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {palette.map((color) => (
            <div key={color.hex} className="overflow-hidden rounded-[13px] border border-black/[0.07]">
              <div className="h-24" style={{ background: color.hex }} />
              <div className="flex items-center justify-between bg-white px-3 py-3">
                <div>
                  <p className="font-mono text-[11px] font-semibold">{color.hex}</p>
                  <p className="mt-1 text-[10px] text-[#8d949d]">{color.label}</p>
                </div>
                <span className="text-[10px] tabular-nums text-[#a0a6ae]">{color.usage}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-[18px] border border-black/[0.07] bg-white p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-2">
          <Type className="size-4 text-[#1469ff]" />
          <h3 className="text-[14px] font-semibold">Типографическая шкала</h3>
        </div>
        <div className="space-y-2.5">
          {[
            ["Play", "44 pt", "Заголовок"],
            ["Play", "32 pt", "Подзаголовок"],
            ["Arial", "18 pt", "Основной текст"],
            ["Play", "16 pt", "Подпись"],
            ["Arial", "14 pt", "Служебный текст"],
          ].map(([font, size, role]) => (
            <div key={`${font}-${size}`} className="flex items-center justify-between rounded-[12px] bg-[#f7f8fa] px-3.5 py-3">
              <div>
                <p className="text-[12px] font-semibold">{font}</p>
                <p className="mt-0.5 text-[10px] text-[#8c949d]">{role}</p>
              </div>
              <span className="text-[11px] font-medium text-[#56616e]">{size}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Elements() {
  const items = [
    ["Карточка шага", "Заголовок + пояснение + номер"],
    ["Акцентная метрика", "Число + короткая подпись"],
    ["Служебная плашка", "Категория или стадия"],
    ["Разделитель", "Тонкая линия с акцентной точкой"],
  ]
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map(([title, detail], index) => (
        <div key={title} className="rounded-[16px] border border-black/[0.07] bg-white p-4">
          <div className="flex aspect-[1.6] items-center justify-center rounded-[12px] bg-[#eef5ff] p-5">
            {index === 0 && <div className="w-full rounded-[8px] bg-white p-3 shadow-sm"><span className="block h-2 w-8 rounded-full bg-[#0077ff]" /><span className="mt-3 block h-1.5 w-3/4 rounded-full bg-black/70" /><span className="mt-2 block h-1.5 w-full rounded-full bg-black/15" /></div>}
            {index === 1 && <div className="text-center"><p className="text-[30px] font-semibold tracking-[-0.06em] text-[#0077ff]">84%</p><p className="mt-1 text-[8px] font-medium">усвоили материал</p></div>}
            {index === 2 && <span className="rounded-full bg-[#0077ff] px-4 py-2 text-[9px] font-semibold text-white">Модуль 03</span>}
            {index === 3 && <div className="flex w-full items-center"><span className="size-2 rounded-full bg-[#ff3885]" /><span className="h-px flex-1 bg-[#0077ff]" /></div>}
          </div>
          <h3 className="mt-4 text-[13px] font-semibold">{title}</h3>
          <p className="mt-1 text-[11px] leading-4 text-[#838b95]">{detail}</p>
        </div>
      ))}
    </div>
  )
}

function Compositions() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        ["Тезис + визуал", "asymmetric-two-column"],
        ["Сетка карточек", "modular-grid"],
        ["Ключевой показатель", "metric-focus"],
      ].map(([title, label], index) => (
        <div key={title} className="rounded-[16px] border border-black/[0.07] bg-white p-4">
          <div className="aspect-video rounded-[11px] bg-[#f1f5fa] p-3">
            {index === 0 && <div className="grid h-full grid-cols-[1.15fr_0.85fr] gap-2"><div className="rounded-md bg-white p-2"><div className="h-2 w-2/3 rounded-full bg-black/70" /><div className="mt-2 h-1.5 w-full rounded-full bg-black/10" /><div className="mt-1 h-1.5 w-4/5 rounded-full bg-black/10" /></div><div className="rounded-md bg-[#0077ff]" /></div>}
            {index === 1 && <div className="grid h-full grid-cols-3 gap-2">{[0,1,2,3,4,5].map((item) => <div key={item} className="rounded-md bg-white shadow-sm" />)}</div>}
            {index === 2 && <div className="flex h-full items-center justify-center rounded-md bg-white"><div className="text-center"><div className="mx-auto h-3 w-12 rounded-full bg-[#0077ff]" /><div className="mx-auto mt-3 h-1.5 w-20 rounded-full bg-black/15" /></div></div>}
          </div>
          <h3 className="mt-4 text-[13px] font-semibold">{title}</h3>
          <p className="mt-1 font-mono text-[10px] text-[#8c949e]">{label}</p>
        </div>
      ))}
    </div>
  )
}

function Sources() {
  return (
    <section className="rounded-[18px] border border-black/[0.07] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[#eef3ff] text-[#1469ff]"><FileText className="size-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">Шаблон презентации VK Education.pptx</p>
            <p className="mt-1 text-[10px] text-[#8c949e]">55 слайдов · добавлен 17 сентября 2026</p>
          </div>
        </div>
        <Badge variant="outline" className="border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]"><ShieldCheck className="size-3" />Источник сохранён</Badge>
      </div>
      <div className="mt-5 rounded-[12px] bg-[#f7f8fa] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <code className="truncate text-[10px] text-[#64707e]">9ef2323ed5f49f464aee5ae7065f1f57…</code>
          <Button variant="ghost" size="icon-xs" aria-label="Скопировать хеш"><Copy className="size-3" /></Button>
        </div>
      </div>
    </section>
  )
}

function HistoryTab() {
  return (
    <section className="rounded-[18px] border border-black/[0.07] bg-white p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-2"><History className="size-4 text-[#1469ff]" /><h3 className="text-[14px] font-semibold">История версии</h3></div>
      <div className="space-y-0">
        {[
          ["Опубликована версия v1", "Анна Куратор · сегодня, 11:15"],
          ["Приняты все разделы", "Анна Куратор · сегодня, 11:12"],
          ["Завершён технический разбор", "Profiler 0.1.0 · сегодня, 11:03"],
          ["Загружен исходный PPTX", "Партия #021 · сегодня, 10:58"],
        ].map(([title, detail], index) => (
          <div key={title} className="relative flex gap-3 pb-5 last:pb-0">
            {index < 3 && <span className="absolute bottom-0 left-[5px] top-3 w-px bg-[#e3e7ec]" />}
            <span className="relative mt-1 size-[11px] shrink-0 rounded-full border-[3px] border-white bg-[#1469ff] shadow-[0_0_0_1px_rgba(20,105,255,.3)]" />
            <div><p className="text-[12px] font-medium">{title}</p><p className="mt-1 text-[10px] text-[#9097a0]">{detail}</p></div>
          </div>
        ))}
      </div>
    </section>
  )
}
