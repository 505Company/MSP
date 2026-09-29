"use client"

import * as React from "react"
import Link from "@/components/site-link"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  MessageSquareText,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StylePreview } from "@/components/style-preview"
import { reviewSections } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const oldPalette = ["#0E1A3B", "#1746D1", "#9AB7FF", "#F5F7FC", "#FFFFFF"]
const newPalette = ["#0E1A3B", "#1746D1", "#7EA2FF", "#F5F7FC", "#FFFFFF"]

export function ReviewPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const isAcademy = params.id === "product-academy"
  const title = isAcademy ? "Product Academy" : "Cobalt Report"
  const variant = isAcademy ? "education" : "finance"
  const [comment, setComment] = React.useState("")
  const [selected, setSelected] = React.useState<number[]>([2])
  const [accepted, setAccepted] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)
  const [publishOpen, setPublishOpen] = React.useState(false)

  function toggle(index: number) {
    setSelected((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    )
  }

  function requestRevision() {
    if (!comment.trim()) {
      toast.error("Опишите, что нужно изменить")
      return
    }
    setRegenerating(true)
    toast.success("Комментарий отправлен Qwen", {
      description: "Перерабатываются только отмеченные элементы раздела.",
    })
  }

  function accept() {
    setAccepted(true)
    setRegenerating(false)
    toast.success("Раздел «Основы» принят")
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-6 lg:px-8 xl:px-10">
      <div className="mb-6 flex items-center gap-1.5 text-[11px] text-[#89919b]">
        <Link href="/" className="flex items-center gap-1.5 transition hover:text-[#28313c]">
          <ArrowLeft className="size-3.5" />
          Главная
        </Link>
        <ChevronRight className="size-3" />
        <span>Ревью</span>
        <ChevronRight className="size-3" />
        <span className="text-[#5d6672]">{title}</span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge variant="outline" className="border-[#d8e3fb] bg-[#f0f5ff] text-[#345f9e]">
              <Sparkles className="size-3" />Черновик
            </Badge>
            <span className="text-[11px] text-[#9299a2]">v2 · итерация 3</span>
          </div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.045em] text-[#14181e] md:text-[36px]">
            {title}
          </h1>
          <p className="mt-2 text-[13px] text-[#747d89]">Проверка извлечённого стиля перед публикацией</p>
        </div>
        <div className="flex w-full max-w-[470px] items-center gap-3">
          <div className="flex-1 rounded-[13px] border border-black/[0.06] bg-white px-4 py-3">
            <div className="mb-2.5 flex items-center justify-between text-[11px]">
              <span className="font-medium text-[#4f5966]">Готовность к публикации</span>
              <span className="font-semibold tabular-nums text-[#1c2633]">{accepted ? "5 из 5" : "4 из 5"}</span>
            </div>
            <Progress value={accepted ? 100 : 80} className="h-1.5 bg-[#e8ebef] [&_[data-slot=progress-indicator]]:bg-[#1469ff]" />
          </div>
          <Button
            disabled={!accepted}
            onClick={() => setPublishOpen(true)}
            className="h-[50px] rounded-[11px] bg-[#1469ff] px-4 text-[12px] hover:bg-[#0c5de9]"
          >
            Опубликовать
          </Button>
        </div>
      </div>

      <Tabs defaultValue="foundations" className="mt-8">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-[15px] bg-[#eef1f4] p-1 md:grid-cols-3 xl:grid-cols-6">
          {reviewSections.map((section) => (
            <TabsTrigger
              key={section.id}
              value={section.id}
              className="h-10 rounded-[11px] px-3 text-[11px] data-[state=active]:shadow-[0_2px_8px_rgba(23,31,45,0.08)]"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  section.status === "accepted" && "bg-[#3ca66a]",
                  section.status === "attention" && "bg-[#e2a03f]",
                  section.status === "ready" && "bg-[#8e99a7]"
                )}
              />
              {section.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="history" className="h-10 rounded-[11px] px-3 text-[11px] data-[state=active]:shadow-sm">
            История
          </TabsTrigger>
        </TabsList>

        <TabsContent value="foundations" className="pt-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-[20px] border border-black/[0.07] bg-white">
              <div className="flex flex-col gap-3 border-b border-black/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Основы</h2>
                    {accepted ? (
                      <Badge className="bg-[#eaf8f0] text-[#276b44]" variant="secondary"><Check className="size-3" />Принято</Badge>
                    ) : regenerating ? (
                      <Badge className="bg-[#edf3ff] text-[#345f9e]" variant="secondary"><RotateCcw className="size-3 animate-spin" />Перерабатывается</Badge>
                    ) : (
                      <Badge className="bg-[#fff5e8] text-[#925c11]" variant="secondary"><CircleAlert className="size-3" />Требует решения</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-[#858d98]">Палитра и типографика · предложение Qwen</p>
                </div>
                <span className="text-[11px] text-[#9299a2]">Обновлено 31 минуту назад</span>
              </div>

              <div className="grid gap-px bg-[#e6e9ed] lg:grid-cols-2">
                <PaletteVersion title="Текущая версия · v1" colors={oldPalette} muted />
                <PaletteVersion
                  title="Новый черновик · v2"
                  colors={newPalette}
                  selected={selected}
                  onToggle={toggle}
                />
              </div>

              <div className="border-t border-black/[0.06] p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[13px] font-semibold">Изменения в типографике</h3>
                    <p className="mt-1 text-[11px] text-[#8b929c]">2 изменения · 1 требует внимания</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-[11px] text-[#66717d]"><Eye className="size-3.5" />Показать источники</Button>
                </div>
                <div className="overflow-hidden rounded-[13px] border border-black/[0.06]">
                  <ChangeRow role="Подзаголовок" from="Play · 28 pt" to="Play · 32 pt" confidence="94%" />
                  <ChangeRow role="Основной текст" from="Arial · 16 pt" to="Arial · 18 pt" confidence="78%" attention />
                </div>
              </div>
            </section>

            <aside className="h-fit rounded-[20px] border border-black/[0.07] bg-white p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <MessageSquareText className="size-4 text-[#1469ff]" />
                <h2 className="text-[14px] font-semibold">Комментарий для Qwen</h2>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-[#7e8791]">
                Отметьте элементы слева. Остальная часть принятого результата не изменится.
              </p>
              <div className="mt-4 rounded-[11px] bg-[#f5f7fa] px-3 py-2.5 text-[11px] text-[#596471]">
                Выбрано элементов: <strong>{selected.length}</strong>
              </div>
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Например: не объединяй голубой с основным синим — это отдельный цвет для информационных блоков."
                className="mt-3 min-h-36 resize-none rounded-[12px] border-black/[0.08] bg-[#fbfcfd] text-[12px] leading-5 shadow-none"
              />
              <Button
                onClick={requestRevision}
                disabled={regenerating}
                className="mt-3 h-10 w-full rounded-[10px] bg-[#1469ff] text-[12px] hover:bg-[#0c5de9]"
              >
                <Send className="size-3.5" />
                Отправить на переработку
              </Button>
              <div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-[#e7eaee]" /><span className="text-[10px] text-[#a0a6ae]">или</span><span className="h-px flex-1 bg-[#e7eaee]" /></div>
              <Button
                variant="outline"
                onClick={accept}
                className="h-10 w-full rounded-[10px] border-black/[0.08] text-[12px] shadow-none"
              >
                <Check className="size-3.5" />
                Принять раздел
              </Button>
              <p className="mt-4 text-center text-[10px] leading-4 text-[#9aa1aa]">Решение сохранится в журнале вместе с автором и временем.</p>
            </aside>
          </div>
        </TabsContent>

        {reviewSections
          .filter((section) => section.id !== "foundations")
          .map((section) => (
            <TabsContent key={section.id} value={section.id} className="pt-6">
              <SectionPlaceholder title={section.label} variant={variant} />
            </TabsContent>
          ))}
        <TabsContent value="history" className="pt-6">
          <SectionPlaceholder title="История изменений" variant={variant} />
        </TabsContent>
      </Tabs>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="rounded-[18px] border-black/[0.08] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-[20px] tracking-[-0.03em]">Опубликовать новую версию?</DialogTitle>
            <DialogDescription className="pt-1 text-[13px] leading-5">
              Будет создана неизменяемая версия. Новые источники и правки в дальнейшем попадут только в следующий черновик.
            </DialogDescription>
          </DialogHeader>
          <div className="my-2 rounded-[12px] bg-[#f5f7fa] p-4">
            <div className="flex items-center justify-between text-[12px]"><span className="text-[#7a838e]">Стиль</span><strong>{title}</strong></div>
            <div className="mt-3 flex items-center justify-between text-[12px]"><span className="text-[#7a838e]">Версия</span><strong>v2</strong></div>
            <div className="mt-3 flex items-center justify-between text-[12px]"><span className="text-[#7a838e]">Разделы</span><strong>5 из 5 приняты</strong></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>Отмена</Button>
            <Button
              className="bg-[#1469ff] hover:bg-[#0c5de9]"
              onClick={() => {
                setPublishOpen(false)
                toast.success("Версия v2 опубликована")
                router.push(isAcademy ? "/styles/vk-education?published=1&version=v2" : "/styles/cobalt-report?published=1&version=v2")
              }}
            >
              <Check className="size-4" />Опубликовать v2
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PaletteVersion({
  title,
  colors,
  muted = false,
  selected = [],
  onToggle,
}: {
  title: string
  colors: string[]
  muted?: boolean
  selected?: number[]
  onToggle?: (index: number) => void
}) {
  return (
    <div className={cn("bg-white p-5 sm:p-6", muted && "bg-[#fafbfc]")}> 
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#626c78]">{title}</p>
        {!muted && <span className="text-[10px] text-[#1469ff]">Нажмите, чтобы отметить</span>}
      </div>
      <div className="space-y-2">
        {colors.map((color, index) => {
          const changed = !muted && oldPalette[index] !== color
          const active = selected.includes(index)
          return (
            <button
              key={`${title}-${color}`}
              type="button"
              disabled={muted}
              onClick={() => onToggle?.(index)}
              className={cn(
                "flex w-full items-center gap-3 rounded-[11px] border px-3 py-2.5 text-left transition",
                muted && "border-transparent bg-white",
                !muted && "border-black/[0.065] hover:border-[#1469ff]/30",
                active && "border-[#1469ff]/35 bg-[#f2f6ff] ring-2 ring-[#1469ff]/10"
              )}
            >
              <span className="size-7 rounded-[8px] border border-black/[0.08]" style={{ background: color }} />
              <span className="flex-1 font-mono text-[11px] font-medium">{color}</span>
              {changed && <Badge className="bg-[#eef3ff] text-[9px] text-[#3561a2]" variant="secondary">Изменён</Badge>}
              {active && <Check className="size-3.5 text-[#1469ff]" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ChangeRow({
  role,
  from,
  to,
  confidence,
  attention = false,
}: {
  role: string
  from: string
  to: string
  confidence: string
  attention?: boolean
}) {
  return (
    <div className="grid grid-cols-[minmax(100px,0.8fr)_1fr_20px_1fr_auto] items-center gap-3 border-b border-black/[0.055] px-3.5 py-3 last:border-0">
      <span className="text-[11px] font-medium">{role}</span>
      <span className="text-[11px] text-[#8a929c] line-through decoration-black/25">{from}</span>
      <ArrowLeft className="size-3 rotate-180 text-[#a0a6ae]" />
      <span className="text-[11px] font-medium text-[#3e4854]">{to}</span>
      <Badge variant="outline" className={attention ? "border-[#f1d2a1] bg-[#fff6e7] text-[#925c11]" : "border-black/[0.07] text-[#68727e]"}>{confidence}</Badge>
    </div>
  )
}

function SectionPlaceholder({ title, variant }: { title: string; variant: "education" | "finance" }) {
  return (
    <div className="grid gap-5 rounded-[20px] border border-black/[0.07] bg-white p-5 md:grid-cols-[260px_minmax(0,1fr)] sm:p-6">
      <StylePreview variant={variant} compact />
      <div className="flex flex-col justify-center">
        <Badge variant="outline" className="mb-3 border-[#bfe1cb] bg-[#eef9f2] text-[#276b44]"><Check className="size-3" />Готово к проверке</Badge>
        <h2 className="text-[19px] font-semibold tracking-[-0.03em]">{title}</h2>
        <p className="mt-2 max-w-xl text-[12px] leading-5 text-[#7c8590]">Раздел собран из исходных наблюдений и связан с конкретными слайдами и объектами. Здесь будет соответствующий набор кандидатов.</p>
      </div>
    </div>
  )
}
