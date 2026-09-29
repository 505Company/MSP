import type { ParsedPresentation, Primitive } from "./pptx-profiler.js"
import type { QwenStyleAnalysis } from "./qwen-analysis.js"

type Occurrence = { slideIndex: number; objectId: string }
type Evidence = { occurrenceCount: number; occurrences: Occurrence[] }

export type DesignSystemDraft = {
  schemaVersion: "1.0.0"
  status: "draft"
  source: ParsedPresentation["source"]
  generatedAt: string
  parserVersion: ParsedPresentation["schemaVersion"] | 'source-snapshot/1'
  coverage: { slides: number; hiddenSlides: number | null; objects: number; resolvedGeometry: number | null }
  colors: Array<{ id: string; hex: string; usageCount: number; suggestedRoles: string[] } & Evidence>
  typography: Array<{ id: string; fontFamily: string | null; fontSizePt: number; fontWeight: number | null; italic: boolean | null; usageCount: number } & Evidence>
  repeatedElements: Array<{ id: string; kind: Primitive["kind"]; bounds: Primitive["box"]; slideCount: number } & Evidence>
  layouts: Array<{ id: string; slideIndices: number[]; objectCount: number; suggestedNames: string[] }>
  slides: Array<{ index: number; hidden: boolean; objects: Array<Pick<Primitive, "id" | "kind" | "role" | "roleBasis" | "box" | "colors" | "geometryReason" | "sourceRef" | "parentId">> }>
  analysis: QwenStyleAnalysis | null
  warnings: string[]
}

const styleKey = (t: Primitive["typography"][number]) => JSON.stringify([t.fontFamily, t.fontSizePt, t.fontWeight, t.italic])
const geometryKey = (box: NonNullable<Primitive["box"]>) => [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100)).join(":")
const evidence = (objects: Primitive[]): Evidence => ({
  occurrenceCount: objects.length,
  occurrences: [...new Map(objects.map((object) => [object.slideIndex, object])).values()].slice(0, 12)
    .map((object) => ({ slideIndex: object.slideIndex, objectId: object.id })),
})

// All measurements come from the parser. Model labels remain separate proposals.
// Repeated geometry is evidence of a candidate, not proof of visual identity.
export function buildDesignSystemDraft(profile: ParsedPresentation, analysis: QwenStyleAnalysis | null = null): DesignSystemDraft {
  const repetitions = new Map<string, Primitive[]>()
  for (const object of profile.primitives) {
    if (!object.box || object.kind === "group") continue
    const key = JSON.stringify([object.kind, geometryKey(object.box), [...object.colors].sort(), object.typography.map(styleKey).sort()])
    const group = repetitions.get(key) ?? []
    group.push(object); repetitions.set(key, group)
  }
  const layouts = new Map<string, { slideIndices: number[]; objectCount: number }>()
  for (const slide of profile.slides) {
    const objects = profile.primitives.filter((object) => object.slideIndex === slide.slideIndex && object.parentId === slide.id)
    // Exclude incomplete layouts rather than grouping them as empty slides.
    if (!objects.length || objects.some((object) => !object.box || object.kind === "group")) continue
    const key = objects.map((object) => `${object.kind}:${geometryKey(object.box!)}`).sort().join("|")
    const group = layouts.get(key) ?? { slideIndices: [], objectCount: objects.length }
    group.slideIndices.push(slide.slideIndex); layouts.set(key, group)
  }
  return {
    schemaVersion: "1.0.0", status: "draft", source: profile.source, generatedAt: profile.generatedAt, parserVersion: profile.schemaVersion,
    coverage: {
      slides: profile.slides.length, hiddenSlides: profile.slides.filter((slide) => slide.hidden).length,
      objects: profile.primitives.length, resolvedGeometry: profile.primitives.filter((object) => object.geometryResolved).length,
    },
    colors: profile.palette.map((color) => ({
      id: `color-${color.hex.slice(1)}`, ...color,
      suggestedRoles: analysis?.foundations.paletteRoles.filter((role) => role.color.toUpperCase() === color.hex.toUpperCase()).map((role) => role.role) ?? [],
      ...evidence(profile.primitives.filter((object) => object.colors.includes(color.hex))),
    })),
    typography: profile.typography.map((style, index) => ({
      id: `type-${index + 1}`, ...style,
      ...evidence(profile.primitives.filter((object) => object.typography.some((value) => styleKey(value) === styleKey(style)))),
    })),
    repeatedElements: [...repetitions.values()]
      .filter((objects) => new Set(objects.map((object) => object.slideIndex)).size >= 2)
      .sort((a, b) => b.length - a.length)
      .map((objects, index) => ({ id: `repeat-${index + 1}`, kind: objects[0].kind, bounds: objects[0].box,
        slideCount: new Set(objects.map((object) => object.slideIndex)).size, ...evidence(objects) })),
    layouts: [...layouts.values()].map((layout, index) => ({
      id: `layout-${index + 1}`, ...layout,
      suggestedNames: analysis?.compositionClusters.filter((cluster) => cluster.slideIndices.some((slide) => layout.slideIndices.includes(slide))).map((cluster) => cluster.name) ?? [],
    })),
    slides: profile.slides.map((slide) => ({ index: slide.slideIndex, hidden: slide.hidden,
      objects: profile.primitives.filter((object) => object.slideIndex === slide.slideIndex).map(({ id, kind, role, roleBasis, box, colors, geometryReason, sourceRef, parentId }) => ({ id, kind, role, roleBasis, box, colors, geometryReason, sourceRef, parentId })),
    })),
    analysis,
    warnings: [
      "Это черновик: роли, повторяющиеся элементы и компоновки требуют проверки.",
      "Цвета и шрифты извлечены из явно заданных свойств. Наследование из темы и мастеров пока не раскрывается.",
      "Изображения слайдов пока не анализируются. Схемы показывают расположение объектов, но не точный внешний вид.",
      "Совпадение геометрии не доказывает одинаковое содержимое. Библиотека редактируемых компонентов пока не собрана.",
      ...(!analysis ? ["Анализ модели ещё не получен. Извлечённые свойства доступны независимо от Qwen."] : []),
      ...profile.warnings.map((warning) => `${warning.message} (${warning.count})`),
    ],
  }
}
