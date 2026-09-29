"use client"

import Link from "@/components/site-link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  GitCompareArrows,
  Layers3,
  Split,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StylePreview } from "@/components/style-preview"

const signals = [
  { label: "Палитра", value: 91, detail: "4 из 5 основных цветов совпадают" },
  { label: "Типографика", value: 88, detail: "Play + Arial, близкая шкала" },
  { label: "Композиции", value: 76, detail: "Карточки и асимметричные сетки" },
  { label: "Визуальный ритм", value: 82, detail: "Умеренная плотность, крупные поля" },
]

export function MatchDecision() {
  const router = useRouter()

  function decide(message: string) {
    toast.success(message, { description: "Создан рабочий черновик. Опубликованная версия не изменена." })
    window.setTimeout(() => router.push("/review/product-academy"), 650)
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-6 lg:px-8 xl:px-10">
      <div className="mb-6 flex items-center gap-1.5 text-[11px] text-[#89919b]">
        <Link href="/" className="flex items-center gap-1.5 transition hover:text-[#28313c]">
          <ArrowLeft className="size-3.5" />Главная
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-[#5d6672]">Решение о совпадении</span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge variant="outline" className="border-[#f1d2a1] bg-[#fff6e7] text-[#925c11]">Средняя уверенность · 84%</Badge>
            <span className="text-[11px] text-[#939aa3]">Партия #023</span>
          </div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.045em] text-[#14181e] md:text-[36px]">
            Куда отнести новый источник?
          </h1>
          <p className="mt-2 text-[13px] text-[#747d89]">Система нашла близкий вариант, но решение должен подтвердить администратор.</p>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-[#eef3ff] px-3 py-2 text-[11px] font-medium text-[#345f9e]">
          <GitCompareArrows className="size-3.5" />Сравнение готово
        </span>
      </div>

      <section className="mt-8 grid gap-px overflow-hidden rounded-[22px] border border-black/[0.07] bg-[#e5e8ed] lg:grid-cols-2">
        <SourcePanel
          eyebrow="Новый источник"
          title="Product Academy 2026"
          detail="68 слайдов · загружен 12 минут назад"
          variant="education"
          colors={["#0675FA", "#050A13", "#FFFFFF", "#ECF5FF", "#FF4B91"]}
        />
        <SourcePanel
          eyebrow="Найденный вариант"
          title="VK Education · Light"
          detail="v1 · 55 слайдов · 1 источник"
          variant="education"
          colors={["#0077FF", "#000000", "#FFFFFF", "#EBF3F9", "#FF3885"]}
          published
        />
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="rounded-[20px] border border-black/[0.07] bg-white p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8a929d]">Почему они похожи</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em]">Сигналы визуального сходства</h2>
            </div>
            <span className="text-[24px] font-semibold tracking-[-0.045em] text-[#1469ff]">84%</span>
          </div>
          <div className="space-y-4">
            {signals.map((signal) => (
              <div key={signal.label} className="grid grid-cols-[130px_minmax(0,1fr)_42px] items-center gap-4">
                <div>
                  <p className="text-[12px] font-medium">{signal.label}</p>
                  <p className="mt-1 hidden text-[10px] text-[#8d949d] sm:block">{signal.detail}</p>
                </div>
                <Progress value={signal.value} className="h-1.5 bg-[#e8ebef] [&_[data-slot=progress-indicator]]:bg-[#1469ff]" />
                <span className="text-right text-[11px] font-medium tabular-nums text-[#596572]">{signal.value}%</span>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-[13px] bg-[#fff8ed] px-4 py-3.5 text-[11px] leading-5 text-[#735520]">
            <strong className="font-semibold">Главное отличие:</strong> в новом источнике больше розовых акцентов и плотнее сетка карточек. Это может быть новым вариантом того же семейства.
          </div>
        </section>

        <aside className="rounded-[20px] border border-black/[0.07] bg-white p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8a929d]">Решение</p>
          <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em]">Как продолжить</h2>
          <div className="mt-5 space-y-2.5">
            <DecisionButton
              icon={<Check className="size-4" />}
              title="Добавить в VK Education · Light"
              detail="Создать черновик v2 из двух источников"
              primary
              onClick={() => decide("Источник добавлен в вариант Light")}
            />
            <DecisionButton
              icon={<Split className="size-4" />}
              title="Создать новый вариант семейства"
              detail="VK Education / новый вариант / v1"
              onClick={() => decide("Создан новый вариант семейства VK Education")}
            />
            <DecisionButton
              icon={<Layers3 className="size-4" />}
              title="Создать новое семейство"
              detail="Источник не будет связан с VK Education"
              onClick={() => decide("Создано новое семейство стилей")}
            />
          </div>
          <p className="mt-4 text-[10px] leading-4 text-[#9aa1aa]">Любое решение создаёт черновик. Опубликованный VK Education v1 останется неизменным.</p>
        </aside>
      </div>
    </div>
  )
}

function SourcePanel({
  eyebrow,
  title,
  detail,
  variant,
  colors,
  published = false,
}: {
  eyebrow: string
  title: string
  detail: string
  variant: "education"
  colors: string[]
  published?: boolean
}) {
  return (
    <div className="bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8c949e]">{eyebrow}</p>
          <h2 className="mt-2 text-[16px] font-semibold tracking-[-0.025em]">{title}</h2>
          <p className="mt-1 text-[11px] text-[#8a929c]">{detail}</p>
        </div>
        {published && <Badge variant="outline" className="border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]"><Check className="size-3" />Опубликован</Badge>}
      </div>
      <StylePreview variant={variant} className="rounded-[14px]" />
      <div className="mt-4 flex gap-2">
        {colors.map((color) => <span key={color} className="h-7 flex-1 rounded-[7px] border border-black/[0.07]" style={{ background: color }} />)}
      </div>
    </div>
  )
}

function DecisionButton({
  icon,
  title,
  detail,
  primary = false,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "flex w-full items-center gap-3 rounded-[13px] border border-[#1469ff] bg-[#1469ff] p-3.5 text-left text-white shadow-[0_8px_22px_rgba(20,105,255,0.18)] transition hover:bg-[#0c5de9]"
          : "flex w-full items-center gap-3 rounded-[13px] border border-black/[0.07] bg-white p-3.5 text-left transition hover:border-[#1469ff]/25 hover:bg-[#f8faff]"
      }
    >
      <span className={primary ? "flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white/15" : "flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#eef3ff] text-[#1469ff]"}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold">{title}</span>
        <span className={primary ? "mt-1 block text-[10px] text-white/70" : "mt-1 block text-[10px] text-[#8b929c]"}>{detail}</span>
      </span>
      <ChevronRight className={primary ? "size-4 text-white/70" : "size-4 text-[#a0a6ae]"} />
    </button>
  )
}
