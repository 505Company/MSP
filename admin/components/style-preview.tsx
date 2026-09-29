import { cn } from "@/lib/utils"
import type { PreviewVariant } from "@/lib/mock-data"

type StylePreviewProps = {
  variant: PreviewVariant
  className?: string
  compact?: boolean
}

export function StylePreview({
  variant,
  className,
  compact = false,
}: StylePreviewProps) {
  return (
    <div
      aria-label="Превью стиля презентации"
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-[14px] border border-black/[0.07] bg-white shadow-[0_12px_34px_rgba(24,32,54,0.08)]",
        className
      )}
    >
      {variant === "education" && <EducationPreview compact={compact} />}
      {variant === "finance" && <FinancePreview compact={compact} />}
      {variant === "research" && <ResearchPreview compact={compact} />}
      {variant === "editorial" && <EditorialPreview compact={compact} />}
      {variant === "mono" && <MonoPreview compact={compact} />}
    </div>
  )
}

function EducationPreview({ compact }: { compact: boolean }) {
  return (
    <div className="absolute inset-0 bg-[#eef6ff] p-[8%] text-[#080d18]">
      <div className="absolute inset-y-0 right-0 w-[34%] bg-[#0878f9]" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-center gap-[3%]">
          <div className="h-[9px] w-[9px] rounded-full bg-[#0878f9]" />
          <div className="h-[4px] w-[20%] rounded-full bg-[#080d18]/80" />
        </div>
        <div className="max-w-[60%]">
          <p
            className={cn(
              "font-semibold leading-[0.96] tracking-[-0.055em]",
              compact ? "text-[14px]" : "text-[clamp(22px,3.2vw,44px)]"
            )}
          >
            Образование
            <br />
            меняет траекторию
          </p>
          <div className="mt-[7%] h-[4px] w-[46%] rounded-full bg-[#0878f9]" />
        </div>
        <div className="flex gap-[2%]">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[5px] w-[5px] rounded-full bg-[#080d18]/75" />
          ))}
        </div>
      </div>
      <div className="absolute bottom-[10%] right-[8%] h-[30%] w-[20%] rounded-t-[45%] bg-[#ff3f86]" />
      <div className="absolute right-[17%] top-[18%] h-[17%] w-[17%] rounded-full border-[5px] border-white" />
    </div>
  )
}

function FinancePreview({ compact }: { compact: boolean }) {
  return (
    <div className="absolute inset-0 bg-[#f7f8fc] p-[8%] text-[#111a3d]">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-[8%] h-[4px] w-[42%] rounded-full bg-[#1746d1]" />
          <p
            className={cn(
              "font-semibold leading-none tracking-[-0.05em]",
              compact ? "text-[15px]" : "text-[clamp(22px,3vw,42px)]"
            )}
          >
            Динамика
            <br />портфеля
          </p>
        </div>
        <span className="rounded-full bg-[#e2e9ff] px-[4%] py-[2%] text-[8px] font-semibold text-[#1746d1]">
          Q3
        </span>
      </div>
      <div className="absolute bottom-[12%] left-[8%] right-[8%] flex h-[31%] items-end gap-[4%] border-b border-[#111a3d]/15">
        {[38, 54, 47, 72, 63, 88].map((height, index) => (
          <div
            key={height}
            className={cn(
              "flex-1 rounded-t-sm",
              index === 5 ? "bg-[#1746d1]" : "bg-[#9ab7ff]"
            )}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function ResearchPreview({ compact }: { compact: boolean }) {
  return (
    <div className="absolute inset-0 bg-[#eaf1ed] p-[8%] text-[#13271f]">
      <div className="absolute bottom-0 right-0 h-[70%] w-[42%] rounded-tl-[48%] bg-[#2a6b52]" />
      <p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-[#2a6b52]">
        Nordline · 2026
      </p>
      <p
        className={cn(
          "relative mt-[14%] max-w-[62%] font-medium leading-[1.02] tracking-[-0.05em]",
          compact ? "text-[14px]" : "text-[clamp(22px,3vw,42px)]"
        )}
      >
        Рост через ясные решения
      </p>
      <div className="absolute bottom-[12%] left-[8%] flex items-center gap-[5%]">
        <div className="h-[4px] w-8 rounded-full bg-[#d6b46b]" />
        <span className="text-[7px] font-medium">Годовой обзор</span>
      </div>
      <div className="absolute bottom-[17%] right-[10%] h-[25%] w-[25%] rounded-full border-[5px] border-[#d6b46b]" />
    </div>
  )
}

function EditorialPreview({ compact }: { compact: boolean }) {
  return (
    <div className="absolute inset-0 bg-[#f4ede5] p-[8%] text-[#171717]">
      <div className="absolute right-0 top-0 h-full w-[44%] bg-[#f54f25]" />
      <div className="relative flex h-full flex-col justify-between">
        <p className="text-[7px] font-semibold uppercase tracking-[0.22em]">
          Signal / 03
        </p>
        <p
          className={cn(
            "max-w-[60%] font-black uppercase leading-[0.84] tracking-[-0.07em]",
            compact ? "text-[15px]" : "text-[clamp(24px,3.5vw,48px)]"
          )}
        >
          Идеи,
          <br />которые
          <br />двигают
        </p>
        <div className="h-[3px] w-[18%] bg-[#171717]" />
      </div>
      <div className="absolute bottom-[13%] right-[10%] h-[42%] w-[24%] border-[6px] border-[#171717]" />
    </div>
  )
}

function MonoPreview({ compact }: { compact: boolean }) {
  return (
    <div className="absolute inset-0 bg-[#fafafa] p-[8%] text-[#181818]">
      <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-[8%]">
        <div className="flex flex-col justify-between border-r border-black/15 pr-[12%]">
          <p className="text-[7px] font-medium uppercase tracking-[0.18em]">
            Research note
          </p>
          <p
            className={cn(
              "font-medium leading-[0.98] tracking-[-0.055em]",
              compact ? "text-[15px]" : "text-[clamp(22px,3vw,42px)]"
            )}
          >
            Сигналы
            <br />в данных
          </p>
          <p className="text-[7px] text-black/55">17.09.2026</p>
        </div>
        <div className="flex flex-col justify-end gap-[7%]">
          {[82, 54, 68, 39].map((width, index) => (
            <div key={width}>
              <div className="mb-[3%] flex justify-between text-[6px] text-black/55">
                <span>0{index + 1}</span>
                <span>{width}%</span>
              </div>
              <div className="h-[5px] bg-black/[0.08]">
                <div className="h-full bg-[#181818]" style={{ width: `${width}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
