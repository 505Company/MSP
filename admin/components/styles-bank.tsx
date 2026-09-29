"use client"

import * as React from "react"
import { Archive, ChevronDown, Grid2X2, ListFilter, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StyleCard } from "@/components/style-card"
import { ExtractedDrafts } from "@/components/extracted-drafts"
import { styleRecords } from "@/lib/mock-data"

const purposes = ["Все", "Обучение", "Отчёты", "Выступления", "Исследования"]

export function StylesBank() {
  const [query, setQuery] = React.useState("")
  const [purpose, setPurpose] = React.useState("Все")

  const visible = styleRecords.filter((style) => {
    const matchesQuery = `${style.name} ${style.purpose} ${style.family}`
      .toLowerCase()
      .includes(query.toLowerCase())
    const matchesPurpose =
      purpose === "Все" || style.purpose.toLowerCase().includes(purpose.toLowerCase())
    return style.status !== "archived" && matchesQuery && matchesPurpose
  })

  return (
    <div className="mx-auto w-full max-w-[1480px] px-5 pb-16 pt-8 lg:px-8 xl:px-10">
      <div className="flex flex-col gap-5 border-b border-black/[0.06] pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[12px] font-medium text-[#7d8590]">Дизайн-системы презентаций</p>
          <h1 className="text-[30px] font-semibold tracking-[-0.045em] text-[#14181e] md:text-[34px]">
            Банк стилей
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-5 text-[#747d89]">
            Разбор загруженных презентаций и примеры визуальных систем.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-10 rounded-[10px] border-black/[0.08] bg-white text-[12px] shadow-none">
            <Archive className="size-4" />
            Архив
          </Button>
          <Button variant="outline" className="h-10 rounded-[10px] border-black/[0.08] bg-white text-[12px] shadow-none">
            По обновлению
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      </div>

      <ExtractedDrafts />
      <h2 className="mt-7 text-lg font-semibold">Демонстрационные примеры</h2>
      <div className="flex flex-col gap-4 py-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full max-w-[420px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#959da7]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название, семейство или назначение"
            className="h-10 rounded-[10px] border-black/[0.08] bg-white pl-9 text-[13px] shadow-none"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0">
          <span className="mr-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[#8a929c]">
            <ListFilter className="size-3.5" />
            Назначение
          </span>
          {purposes.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPurpose(item)}
              className={
                purpose === item
                  ? "h-8 whitespace-nowrap rounded-full bg-[#18202c] px-3 text-[11px] font-medium text-white"
                  : "h-8 whitespace-nowrap rounded-full border border-black/[0.07] bg-white px-3 text-[11px] font-medium text-[#65707d] transition hover:border-black/[0.13]"
              }
            >
              {item}
            </button>
          ))}
          <Button variant="ghost" size="icon-sm" aria-label="Показать сеткой" className="ml-1 text-[#68717c]">
            <Grid2X2 className="size-4" />
          </Button>
        </div>
      </div>

      {visible.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((style) => (
            <StyleCard key={style.id} style={style} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[20px] border border-dashed border-black/[0.12] bg-white text-center">
          <Search className="mb-3 size-5 text-[#9ba2ab]" />
          <p className="text-[14px] font-medium">Ничего не найдено</p>
          <p className="mt-1 text-[12px] text-[#8b929b]">Измените запрос или снимите фильтр.</p>
        </div>
      )}
    </div>
  )
}
