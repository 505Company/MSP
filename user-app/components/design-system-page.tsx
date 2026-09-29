"use client"

import * as React from "react"
import Link from "@/components/site-link"
import { useParams } from "next/navigation"
import { ArrowLeft, Download, LoaderCircle, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DesignSystemDraft } from "@/lib/uploads/design-system"
import type { UploadJob } from "@/lib/uploads/domain"
import { readProcessingResponse } from "@/lib/uploads/read-processing-response"

const kinds: Record<string, string> = { text: "Текст", image: "Изображение", shape: "Фигура", line: "Линия", group: "Группа", chart: "Диаграмма", table: "Таблица", smartArt: "SmartArt", unknown: "Объект" }
const panel = "rounded-2xl border border-black/[0.07] bg-white p-5 sm:p-6"
type Result = { upload: UploadJob; draft: DesignSystemDraft }

export function DesignSystemPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = React.useState<Result | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedSlide, setSelectedSlide] = React.useState(0)
  const [retrying, setRetrying] = React.useState(false)
  const load = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(id)}/design-system`, { cache: "no-store" })
      const result = await response.json() as Result & { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Не удалось открыть разбор")
      setData(result); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось открыть разбор") }
  }, [id])
  // The shared loader writes state after its fetch settles, as it also does for polling.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load() }, [load])
  const processing = retrying || data?.upload.status === "processing" || data?.upload.status === "queued"
  React.useEffect(() => {
    if (!processing) return
    const timer = setInterval(() => void load(), 3000)
    return () => clearInterval(timer)
  }, [load, processing])

  async function retry() {
    setRetrying(true)
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(id)}/retry`, { method: "POST" })
      const result = await readProcessingResponse<{ error?: string }>(response)
      if (!response.ok) throw new Error(result.error ?? "Не удалось повторить анализ")
      await load()
      toast.success("Анализ возобновлён. Оставьте вкладку открытой.")
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось повторить анализ") }
    finally { setRetrying(false) }
  }

  if (!data) return <div className="mx-auto max-w-5xl px-6 py-12">
    <Link href="/uploads" className="text-sm text-[#1469ff]">← К загрузкам</Link>
    <div className={`${panel} mt-6`}>
      {error ? <><p>{error}</p><Button variant="outline" className="mt-4" onClick={() => void load()}>Повторить</Button></> : <p className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />Открываем разбор презентации</p>}
    </div>
  </div>
  const { draft, upload } = data
  const slide = draft.slides.find((item) => item.index === selectedSlide) ?? draft.slides[0]
  const hasQwen = Boolean(draft.analysis)

  return <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-7 lg:px-8 xl:px-10">
    <Link href="/uploads" className="inline-flex items-center gap-2 text-xs text-[#77818f] hover:text-[#1469ff]"><ArrowLeft className="size-3.5" />Загрузки</Link>
    <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <Badge variant="outline" className="mb-3 border-[#d8e3fb] bg-[#f0f5ff] text-[#345f9e]">Черновик дизайн-системы</Badge>
        <h1 className="break-words text-[30px] font-semibold tracking-[-0.04em]">{upload.fileName}</h1>
        <p className="mt-2 text-sm text-[#77818f]">Цвета, типографика, повторяющиеся элементы и компоновки из вашей презентации</p>
      </div>
      <Button asChild variant="outline" className="shrink-0"><a href={`/api/uploads/${encodeURIComponent(id)}/design-system?download=1`}><Download className="size-4" />Скачать разбор</a></Button>
    </div>

    <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[["Слайдов", draft.coverage.slides], ["Объектов", draft.coverage.objects], ["Цветов", draft.colors.length], ["Текстовых стилей", draft.typography.length]].map(([label, count]) => <div key={label} className={panel}><p className="text-xs text-[#77818f]">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{count}</p></div>)}
    </div>
    {!hasQwen || processing ? <div className="mt-5 flex flex-col justify-between gap-4 rounded-xl border border-[#e9d6b2] bg-[#fff9ee] p-4 sm:flex-row sm:items-center">
      <div><p className="text-sm font-medium text-[#735116]">{processing ? "Модель анализирует композиции" : "Структура извлечена. Анализ модели ещё не завершён"}</p>
        <p className="mt-1 text-xs leading-5 text-[#8b713f]">{processing ? "Оставьте вкладку открытой. Извлечённые свойства уже доступны ниже." : "Исходник и результаты разбора сохранены. Можно изучить их сейчас и отдельно повторить анализ."}</p></div>
      <Button variant="outline" size="sm" disabled={processing} onClick={() => void retry()}>{processing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{processing ? "В работе" : "Повторить анализ"}</Button>
    </div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}

    <Tabs defaultValue="foundations" className="mt-7">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-[#edf0f4] p-1">
        <TabsTrigger value="foundations">Основы</TabsTrigger><TabsTrigger value="repetitions">Повторения</TabsTrigger><TabsTrigger value="layouts">Компоновки</TabsTrigger><TabsTrigger value="slides">Слайды</TabsTrigger><TabsTrigger value="limits">Что проверить</TabsTrigger>
      </TabsList>
      <TabsContent value="foundations" className="mt-5 space-y-5">
        {draft.analysis ? <section className={panel}><h2 className="text-lg font-semibold">Предложение модели</h2><p className="mt-2 text-sm leading-6 text-[#576270]">{draft.analysis.summary}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-[#8b929c]">Сетка</p><p className="mt-1 text-sm">{draft.analysis.foundations.grid}</p></div><div><p className="text-xs text-[#8b929c]">Фон</p><p className="mt-1 text-sm">{draft.analysis.foundations.backgroundStrategy}</p></div></div></section> : null}
        <section className={panel}><h2 className="text-lg font-semibold">Палитра</h2><p className="mt-1 text-xs text-[#8b929c]">Явные значения из объектов презентации. Назначения цветов предложены моделью.</p>
          {draft.colors.length ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">{draft.colors.map((color) => <div key={color.id} className="overflow-hidden rounded-xl border border-black/[0.07]"><div className="h-20 border-b border-black/[0.05]" style={{ backgroundColor: color.hex }} /><div className="p-3"><p className="font-mono text-xs">{color.hex}</p><p className="mt-1 text-xs text-[#77818f]">{color.usageCount} объектов</p>{color.suggestedRoles.length ? <p className="mt-2 text-xs">{color.suggestedRoles.join(", ")}</p> : null}<p className="mt-2 text-[11px] text-[#9299a2]">Примеры слайдов: {slideNumbers(color.occurrences.map((item) => item.slideIndex))}</p></div></div>)}</div> : <Empty>Явные цвета не найдены. Они могут наследоваться из темы.</Empty>}
        </section>
        <section className={panel}><h2 className="text-lg font-semibold">Типографика</h2><p className="mt-1 text-xs text-[#8b929c]">Шрифты и размеры из исходных объектов. Значение «Из темы» требует проверки.</p>
          <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-[#8b929c]"><tr><th className="py-3 font-medium">Шрифт</th><th className="font-medium">Размер</th><th className="font-medium">Начертание</th><th className="font-medium">Объектов</th><th className="font-medium">Примеры на слайдах</th></tr></thead><tbody>{draft.typography.map((style) => <tr key={style.id} className="border-b border-black/[0.04]"><td className="py-3 pr-4">{style.fontFamily?.startsWith("+") ? `Из темы (${style.fontFamily})` : style.fontFamily ?? "Из темы"}</td><td className="pr-4 tabular-nums">{style.fontSizePt} pt</td><td className="pr-4 text-xs">{style.fontWeight === null ? "Не задано" : style.fontWeight >= 600 ? "Жирный" : "Обычный"}{style.italic ? ", курсив" : ""}</td><td className="pr-4 tabular-nums">{style.usageCount}</td><td className="text-xs text-[#77818f]">{slideNumbers(style.occurrences.map((item) => item.slideIndex))}</td></tr>)}</tbody></table></div>
          {!draft.typography.length ? <Empty>Явные текстовые стили не найдены.</Empty> : null}
        </section>
      </TabsContent>
      <TabsContent value="repetitions" className="mt-5"><section className={panel}><h2 className="text-lg font-semibold">Кандидаты повторяющихся элементов</h2><p className="mt-2 text-sm leading-6 text-[#77818f]">Объекты с похожей геометрией и одинаковыми извлечёнными свойствами на разных слайдах. Их содержимое может различаться.</p>
        {draft.repeatedElements.length ? <div className="mt-5 divide-y divide-black/[0.05]">{draft.repeatedElements.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{kinds[item.kind]} · {item.slideCount} слайдов</p><p className="mt-1 text-xs text-[#77818f]">Примеры: {slideNumbers(item.occurrences.map((part) => part.slideIndex))}</p></div><p className="text-xs tabular-nums text-[#77818f]">{item.bounds ? `${Math.round(item.bounds.width * 100)}% × ${Math.round(item.bounds.height * 100)}% слайда` : "Геометрия не определена"}</p></div>)}</div> : <Empty>Подтверждаемых геометрических повторений между слайдами не найдено.</Empty>}
      </section></TabsContent>
      <TabsContent value="layouts" className="mt-5 space-y-5">
        {draft.analysis?.compositionClusters.length ? <section className={panel}><h2 className="text-lg font-semibold">Смысловые группы · предложение модели</h2><div className="mt-4 divide-y divide-black/[0.05]">{draft.analysis.compositionClusters.map((cluster, i) => <div key={i} className="py-4"><p className="font-medium">{cluster.name}</p><p className="mt-1 text-sm text-[#65707d]">{cluster.intent}</p><p className="mt-2 text-xs text-[#8b929c]">Слайды {slideNumbers(cluster.slideIndices)}</p></div>)}</div></section> : null}
        <section className={panel}><h2 className="text-lg font-semibold">Геометрические компоновки</h2><p className="mt-2 text-sm text-[#77818f]">Группировка по расположению и типам объектов. Слайды с неполной геометрией не объединяются автоматически.</p><div className="mt-4 divide-y divide-black/[0.05]">{draft.layouts.map((layout, i) => <div key={layout.id} className="py-4"><p className="text-sm font-medium">Компоновка {i + 1} · {layout.objectCount} объектов</p><p className="mt-1 text-xs text-[#77818f]">Слайды {slideNumbers(layout.slideIndices)}</p>{layout.suggestedNames.length ? <p className="mt-2 text-sm">{layout.suggestedNames.join(", ")}</p> : null}</div>)}</div>{!draft.layouts.length ? <Empty>Для сравнения компоновок нужно раскрыть группы и наследуемую геометрию.</Empty> : null}</section>
      </TabsContent>
      <TabsContent value="slides" className="mt-5"><section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Расположение объектов</h2><p className="mt-1 text-xs text-[#8b929c]">Схема по извлечённым координатам. Она не воспроизводит внешний вид слайда.</p></div><select aria-label="Слайд" value={slide?.index ?? 0} onChange={(event) => setSelectedSlide(Number(event.target.value))} className="rounded-lg border bg-white px-3 py-2 text-sm">{draft.slides.map((item) => <option key={item.index} value={item.index}>Слайд {item.index + 1}{item.hidden ? " · скрыт" : ""}</option>)}</select></div>
        {slide ? <><SlideDiagram slide={slide} ratio={draft.source.slideSizeEmu.width / draft.source.slideSizeEmu.height} /><p className="mt-3 text-xs text-[#77818f]">Показано объектов: {slide.objects.filter((object) => object.box && object.kind !== "group").length} из {slide.objects.length}. Объекты без надёжных координат не показаны.</p></> : null}
      </section></TabsContent>
      <TabsContent value="limits" className="mt-5"><section className={panel}><h2 className="text-lg font-semibold">Что проверить перед использованием</h2><ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-[#65707d]">{draft.warnings.map((warning, i) => <li key={i}>{warning}</li>)}{draft.analysis?.warnings.map((warning, i) => <li key={`model-${i}`}>{warning.message}</li>)}</ul><p className="mt-5 text-sm text-[#65707d]">Скрытых слайдов: {draft.coverage.hiddenSlides ?? "не определено"}. Надёжная геометрия: {draft.coverage.resolvedGeometry ?? "не определено"} из {draft.coverage.objects} объектов.</p></section></TabsContent>
    </Tabs>
  </div>
}

function slideNumbers(indices: number[]) { return [...new Set(indices)].sort((a, b) => a - b).map((index) => index + 1).join(", ") || "—" }
function Empty({ children }: { children: React.ReactNode }) { return <p className="py-8 text-sm text-[#8b929c]">{children}</p> }
function SlideDiagram({ slide, ratio }: { slide: DesignSystemDraft["slides"][number]; ratio: number }) {
  const height = 800 / (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9)
  return <svg viewBox={`0 0 800 ${height}`} role="img" aria-label={`Схема объектов слайда ${slide.index + 1}`} className="mt-5 max-h-[520px] w-full rounded-lg border bg-[#fbfcfe]">
    {slide.objects.filter((object) => object.box && object.kind !== "group").map((object) => {
      const b = object.box!
      return <rect key={object.id} x={b.x * 800} y={b.y * height} width={Math.max(b.width * 800, 1)} height={Math.max(b.height * height, 1)} fill={object.kind === "image" ? "#d9e8ff" : "#e9edf2"} fillOpacity="0.5" stroke={object.kind === "image" ? "#729ada" : "#8794a5"} strokeWidth="0.8"><title>{kinds[object.kind]} · {object.sourceRef.shapeId ?? object.id}</title></rect>
    })}
  </svg>
}
