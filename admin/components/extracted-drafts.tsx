"use client"

import * as React from "react"
import Link from "@/components/site-link"
import { ArrowUpRight, FileStack, LoaderCircle } from "lucide-react"
import type { UploadJob } from "@/lib/uploads/domain"
import { UploadDialog } from "@/components/upload-dialog"

export function ExtractedDrafts() {
  const [uploads, setUploads] = React.useState<UploadJob[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  React.useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch("/api/uploads", { cache: "no-store" })
        if (!response.ok) throw new Error()
        const result = await response.json() as { uploads: UploadJob[] }
        if (active) { setUploads(result.uploads); setError(false) }
      } catch { if (active) setError(true) }
      finally { if (active) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const drafts = uploads.filter((upload) => upload.profileObjectKey)
  return <section className="mt-7 border-b border-black/[0.06] pb-8">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-tight">Из ваших презентаций</h2><p className="mt-1 text-xs text-[#858e9b]">Сохранённые черновики дизайн-систем</p></div><UploadDialog /></div>
    {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-[#858e9b]"><LoaderCircle className="size-4 animate-spin" />Загружаем черновики</p>
      : error ? <p className="mt-5 text-sm text-[#a14b55]">Не удалось обновить черновики. <Link href="/uploads" className="underline">Открыть загрузки</Link></p>
      : !drafts.length ? <div className="mt-5 rounded-2xl border border-dashed bg-white p-6"><p className="text-sm">Загрузите PPTX, чтобы получить первый разбор.</p><p className="mt-2 text-xs text-[#858e9b]">Сервис извлечёт палитру, типографику и расположение объектов. Результат появится здесь.</p></div>
      : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{drafts.map((upload) => <Link key={upload.id} href={`/uploads/${upload.id}`} className="group rounded-2xl border border-black/[0.07] bg-white p-5 transition hover:border-[#1469ff]/40 hover:shadow-sm"><div className="flex items-center justify-between"><FileStack className="size-5 text-[#1469ff]" /><ArrowUpRight className="size-4 text-[#9aa3af] group-hover:text-[#1469ff]" /></div><h3 className="mt-5 truncate text-base font-semibold">{upload.fileName}</h3><p className="mt-2 text-xs text-[#7c8693]">{upload.slideCount ?? "—"} слайдов · {upload.objectCount ?? "—"} объектов</p><p className="mt-4 text-xs text-[#456286]">{upload.qwenStatus === "analyzed" ? "Черновик с анализом модели" : "Структура извлечена"}</p></Link>)}</div>}
  </section>
}
