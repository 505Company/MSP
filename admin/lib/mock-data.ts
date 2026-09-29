export type StyleStatus = "published" | "review" | "processing" | "archived"

export type PreviewVariant =
  | "education"
  | "finance"
  | "research"
  | "editorial"
  | "mono"

export type StyleRecord = {
  id: string
  name: string
  purpose: string
  family: string
  variant: string
  version: string
  status: StyleStatus
  updatedAt: string
  sourceCount: number
  slideCount: number
  confidence: number
  palette: string[]
  preview: PreviewVariant
}

export const styleRecords: StyleRecord[] = [
  {
    id: "vk-education",
    name: "VK Education",
    purpose: "Обучение и развитие",
    family: "VK Education",
    variant: "Light",
    version: "v1",
    status: "published",
    updatedAt: "Сегодня, 11:15",
    sourceCount: 1,
    slideCount: 55,
    confidence: 92,
    palette: ["#0077FF", "#000000", "#FFFFFF", "#EBF3F9", "#FF3885"],
    preview: "education",
  },
  {
    id: "cobalt-report",
    name: "Cobalt Report",
    purpose: "Отчёты и аналитика",
    family: "Cobalt",
    variant: "Balanced",
    version: "v2 · черновик",
    status: "review",
    updatedAt: "Сегодня, 10:42",
    sourceCount: 3,
    slideCount: 84,
    confidence: 86,
    palette: ["#1746D1", "#0E1A3B", "#F5F7FC", "#9AB7FF"],
    preview: "finance",
  },
  {
    id: "nordline-annual",
    name: "Nordline Annual",
    purpose: "Годовые отчёты",
    family: "Nordline",
    variant: "Light",
    version: "Новый",
    status: "processing",
    updatedAt: "Сегодня, 10:08",
    sourceCount: 2,
    slideCount: 112,
    confidence: 71,
    palette: ["#11271E", "#2A6B52", "#E6EFEA", "#D6B46B"],
    preview: "research",
  },
  {
    id: "signal-editorial",
    name: "Signal Editorial",
    purpose: "Публичные выступления",
    family: "Signal",
    variant: "Accent",
    version: "v3",
    status: "published",
    updatedAt: "16 сентября",
    sourceCount: 5,
    slideCount: 137,
    confidence: 95,
    palette: ["#F54F25", "#141414", "#F5EEE7", "#FFFFFF"],
    preview: "editorial",
  },
  {
    id: "plain-data",
    name: "Plain Data",
    purpose: "Внутренние исследования",
    family: "Plain",
    variant: "Mono",
    version: "v1",
    status: "published",
    updatedAt: "14 сентября",
    sourceCount: 2,
    slideCount: 43,
    confidence: 89,
    palette: ["#181818", "#686868", "#DDDDDD", "#FAFAFA"],
    preview: "mono",
  },
]

export const processingJobs = [
  {
    id: "job-1",
    name: "Brand platform 2026.pptx",
    stage: "Анализ Qwen",
    stageIndex: 4,
    totalStages: 6,
    progress: 66,
    detail: "47 из 72 слайдов",
  },
  {
    id: "job-2",
    name: "Sales kit · autumn.pptx",
    stage: "Рендеринг",
    stageIndex: 3,
    totalStages: 6,
    progress: 43,
    detail: "18 из 41 слайда",
  },
]

export const reviewSections = [
  { id: "overview", label: "Обзор", status: "accepted", count: 8 },
  { id: "foundations", label: "Основы", status: "attention", count: 16 },
  { id: "elements", label: "Элементы", status: "ready", count: 24 },
  { id: "compositions", label: "Композиции", status: "ready", count: 12 },
  { id: "sources", label: "Источники", status: "accepted", count: 3 },
]
