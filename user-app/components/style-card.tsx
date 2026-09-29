import Link from "@/components/site-link"
import { ArrowUpRight, Clock3, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { StyleRecord } from "@/lib/mock-data"
import { cn } from "@/lib/utils"
import { StylePreview } from "@/components/style-preview"

const statusLabel = {
  published: "Опубликован",
  review: "На ревью",
  processing: "Обрабатывается",
  archived: "В архиве",
}

export function StyleCard({
  style,
  priority = false,
}: {
  style: StyleRecord
  priority?: boolean
}) {
  return (
    <Link
      href={`/styles/${style.id}`}
      className="group block rounded-[18px] outline-none focus-visible:ring-4 focus-visible:ring-[#1469ff]/15"
    >
      <article className="overflow-hidden rounded-[18px] border border-black/[0.07] bg-white transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-black/[0.12] group-hover:shadow-[0_18px_48px_rgba(27,39,63,0.10)]">
        <div className="relative bg-[#eef1f5] p-2.5">
          <StylePreview variant={style.preview} compact={!priority} />
          <Badge
            variant="secondary"
            className={cn(
              "absolute left-5 top-5 border border-white/55 bg-white/88 px-2.5 py-1 text-[10px] font-semibold shadow-sm backdrop-blur-md",
              style.status === "review" && "text-[#9b5d08]",
              style.status === "processing" && "text-[#40546c]"
            )}
          >
            {style.status === "processing" ? (
              <Clock3 className="size-3" />
            ) : style.status === "review" ? (
              <Sparkles className="size-3" />
            ) : null}
            {statusLabel[style.status]}
          </Badge>
          <span className="absolute right-5 top-5 flex size-8 translate-y-1 items-center justify-center rounded-full bg-white/90 text-[#1f252d] opacity-0 shadow-sm backdrop-blur transition-all group-hover:translate-y-0 group-hover:opacity-100">
            <ArrowUpRight className="size-4" />
          </span>
        </div>

        <div className="p-4.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.025em] text-[#171b21]">
                {style.name}
              </h3>
              <p className="mt-1 truncate text-[12px] text-[#7b838e]">
                {style.purpose}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-[#f0f3f6] px-2 py-1 text-[10px] font-semibold text-[#616b78]">
              {style.version}
            </span>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-black/[0.055] pt-3.5">
            <div className="flex -space-x-1">
              {style.palette.slice(0, 5).map((color, index) => (
                <span
                  key={`${style.id}-${color}`}
                  className="size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
                  style={{ background: color, zIndex: 5 - index }}
                />
              ))}
            </div>
            <span className="text-[11px] tabular-nums text-[#9299a2]">
              {style.sourceCount} ист. · {style.slideCount} сл.
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}
