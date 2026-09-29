import { z } from 'zod'

// ============================================================================
// ADAPTIVE RECIPE CONTRACT v5 — FIGMA SECTION 33:223
// 6 authored frames, content-agnostic, design-system-driven.
//
// Changes relative to v3 recipes:
// - Qwen cannot choose/downgrade semantic block type. It assigns immutable,
//   pre-normalized block IDs to regions. Structured content therefore cannot be
//   relabelled as `text` to bypass component-first behavior.
// - Primitive fallbacks have explicit internal flex trees. Field placement,
//   gaps, free-space distribution and repeated-item structure are deterministic.
// - Decorations are attached to an owner group/node and either reserve flow
//   space or follow an owner edge. No decoration keeps an absolute runtime y/x.
// - Presence is hierarchical. Tag/header/footer are structural rows/groups;
//   removing a child collapses only that child. Footer space is not released
//   while the page-number child is still present.
// - Region and group dimensions are searched on every feasible 4px value inside
//   the +/-30% authored range. 10% samples are only coarse starting points.
//
// Figma contributes authored composition/reference geometry only. Runtime text,
// imagery, typography, colors, surfaces and components come from immutable input
// blocks and the active MSP design system.
// v5 adds strict source/snapshot validation, scoped measurements, deterministic
// primitive binding, stable trailing alignment and a complete definition audit.
// This is a standalone contract, not a browser renderer or an integrated MSP run.
// ============================================================================

export const RECIPE_ID = 'section-33-223-structured-content-v5' as const
export const SOURCE_SECTION = '33:223' as const

export type Rect = { x: number; y: number; w: number; h: number }
export type Range = { min: number; preferred: number; max: number }
export type Insets = { top: number; right: number; bottom: number; left: number }
export type Axis = 'x' | 'y'
export type Direction = 'row' | 'column' | 'wrap'
export type Align = 'start' | 'center' | 'end' | 'stretch'
export type Justify = 'start' | 'center' | 'end' | 'space-between'
export type Emphasis = 'primary' | 'secondary'
export type VisualType = 'photo' | 'illustration' | 'diagram' | 'abstract-graphic'

export type TypographyRole =
  | 'header'
  | 'tag'
  | 'title'
  | 'body'
  | 'footer'
  | 'page'
  | 'step-marker'
  | 'step-heading'
  | 'comparison-heading'
  | 'comparison-marker'
  | 'thesis-marker'
  | 'thesis-heading'
  | 'fact-index'
  | 'fact-value'
  | 'explanation-heading'
  | 'article-title'
  | 'feature-period'
  | 'feature-title'
  | 'feature-comment'
  | 'metric-value'
  | 'metric-caption'

export type SurfaceRole =
  | 'plain'
  | 'tag'
  | 'panel-outline'
  | 'comparison-panel'
  | 'fact-panel'
  | 'feature-panel'
  | 'metric-panel'

export type SemanticBlockType =
  | 'text'
  | 'label'
  | 'step'
  | 'comparison-side'
  | 'thesis'
  | 'fact'
  | 'explanation'
  | 'article'
  | 'feature'
  | 'metric'
  | 'visual'

export type SemanticRole =
  | 'context'
  | 'year'
  | 'format'
  | 'tag'
  | 'title'
  | 'steps'
  | 'comparison-left'
  | 'comparison-right'
  | 'theses'
  | 'fact'
  | 'explanations'
  | 'article'
  | 'feature'
  | 'metrics'
  | 'visual'
  | 'footer'
  | 'page'

export type TextPolicy = {
  typographyRole: TypographyRole
  fontStepPx: 4
  minScale: 0.7
  maxScale: 1.3
  lineHeight: 'design-system-coupled'
  adaptationPhase: 'last-resort'
}

export type RegionFlex = {
  width?: { growPriority: number; shrinkPriority: number }
  height?: { growPriority: number; shrinkPriority: number }
}

export type ComponentQuery = {
  semanticRole: SemanticBlockType | SemanticRole | string
  requiredFields: readonly string[]
  allowedLayouts: readonly string[]
  designSystem: 'active'
}

export const FALLBACK_REASONS = [
  'no-compatible-component',
  'component-does-not-fit',
  'component-field-contract-mismatch',
] as const
export type FallbackReason = (typeof FALLBACK_REASONS)[number]

export type PrimitiveFallback = {
  kind: 'semantic-primitive'
  reasonRequired: true
  allowedReasons: readonly FallbackReason[]
}

// ============================================================================
// IMMUTABLE NORMALIZED CONTENT
// Qwen structural assignment receives block IDs; it never emits a block type.
// ============================================================================

export type FieldBinding = { sourceRefs: readonly [string, ...string[]] }
export type StructuredItemBinding = {
  sourceRefs: readonly [string, ...string[]]
  fields: Readonly<Record<string, FieldBinding>>
}
export type NormalizedFieldValue = FieldBinding | readonly StructuredItemBinding[]

export type NormalizedBlock = {
  id: string
  type: SemanticBlockType
  /** Roles are fixed by the semantic-normalization stage, not by assignment Qwen. */
  allowedRoles: readonly [SemanticRole, ...SemanticRole[]]
  /** Stable reading/order key. Group renderers sort by this, not model output order. */
  sequenceIndex: number
  sourceRefs: readonly [string, ...string[]]
  fields: Readonly<Record<string, NormalizedFieldValue | VisualType>>
}

// ============================================================================
// INTERNAL PRIMITIVE LAYOUT
// A primitive fallback is itself a small recipe; executor does not invent field
// placement inside metric/fact/step/etc.
// ============================================================================

export type InternalFlex = {
  grow?: number
  shrink?: number
  basis?: number | 'auto'
}

export type InternalNodeSpec = {
  kind: 'field' | 'group' | 'repeat'
  id: string
  fieldPath?: string
  typographyRole?: TypographyRole
  alignSelf?: Align
  flex?: InternalFlex
  minLines?: number
  maxLines?: number
  direction?: 'row' | 'column' | 'wrap'
  gap?: Range
  gapX?: Range
  gapY?: Range
  padding?: Insets
  align?: Align
  justify?: Justify
  surfaceRole?: SurfaceRole
  children?: InternalNodeSpec[]
  minItems?: number
  maxItems?: number
  columns?: number
  item?: InternalNodeSpec
}

export type InternalDecoration = {
  id: string
  ownerNodeId: string
  edge: 'top' | 'right' | 'bottom' | 'left'
  placement: 'inside-edge' | 'outside-edge'
  reserveInsetPx: number
  preferredThicknessPx: number
  componentQuery: {
    semanticRole: string
    designSystem: 'active'
  }
  repeatPolicy: 'once' | 'each-repeat-item' | 'first-repeat-item' | 'last-repeat-item'
}

export type PrimitiveLayoutVariant = {
  id: string
  minStructuredItems?: number
  maxStructuredItems?: number
  root: InternalNodeSpec
  decorations?: readonly InternalDecoration[]
}

export type FieldContract =
  | { kind: 'single'; required: boolean }
  | {
      kind: 'structured-list'
      required: boolean
      minItems: number
      maxItems: number
      itemFields: Readonly<Record<string, { required: boolean }>>
    }

export type SemanticBlockContract = {
  type: SemanticBlockType
  fields: Readonly<Record<string, FieldContract>>
  componentQuery: ComponentQuery | null
  primitiveFallback: PrimitiveFallback | null
  primitiveLayouts: readonly PrimitiveLayoutVariant[]
}

// ============================================================================
// STATE LAYOUT TREE
// ============================================================================

export type GroupLayout = {
  id: string
  direction: Direction
  columns: number
  minItems: number
  maxItems: number
  gapX: Range
  gapY: Range
  referenceItems?: readonly Rect[]
}

export type VisualFitPolicy = {
  photo: 'cover'
  illustration: 'contain'
  diagram: 'contain'
  'abstract-graphic': 'contain'
}

export type RegionContent = {
  role: SemanticRole
  required: boolean
  minItems: number
  maxItems: number
  accepts: readonly SemanticBlockType[]
  componentPriority: 'component-first' | 'primitive-first' | 'asset-only'
  primitiveTypographyRole?: TypographyRole
  textPolicy?: TextPolicy
  group?: {
    qwenMayChooseLayout: boolean
    allowedLayouts: readonly GroupLayout[]
    preferredLayoutId: string
  }
  visualFit?: VisualFitPolicy
  emphasis: {
    allowed: readonly Emphasis[]
    preferred: Emphasis
    maxPrimaryItems: number
  }
}

export type RegionSpec = {
  id: string
  preferredRect: Rect
  size: { width: Range; height: Range }
  flex?: RegionFlex
  content: RegionContent
}

export type GroupChildRef = (
  | { kind: 'region'; id: string; flex?: InternalFlex }
  | { kind: 'group'; id: string; flex?: InternalFlex }
  | { kind: 'decoration'; id: string; flex?: InternalFlex }
) & {
  /** Auto margin before THIS child, independent of missing siblings. */
  pushToEnd?: boolean
}

export type LayoutGroupSpec = {
  id: string
  preferredRect: Rect
  size: { width: Range; height: Range }
  direction: Direction
  columns?: number
  gapX: Range
  gapY: Range
  padding: Insets
  align: Align
  justify: Justify
  children: readonly GroupChildRef[]
  /** Gap is inserted only between children that survived presence resolution. */
  gapBetweenPresentChildren: true
  /** Empty nested groups disappear and release their area. */
  collapseEmpty: true
  flex?: RegionFlex
}

export type StateDecorationSpec = {
  id: string
  ownerGroupId: string
  placement: 'flow-after-region' | 'flow-before-region'
  regionId: string
  preferredSize: { width: number; height: number }
  reserveFlowSpace: true
  componentQuery: {
    semanticRole: string
    designSystem: 'active'
  }
  onlyWhenRegionsPresent: readonly string[]
}

export type AuthoredState = {
  id: string
  modeId: ModeId
  sourceFrame: SourceFrameId
  densityRank: number
  regions: readonly RegionSpec[]
  groups: readonly LayoutGroupSpec[]
  rootGroupId: string
  decorations: readonly StateDecorationSpec[]
  notes?: readonly string[]
}

export const SOURCE_FRAMES = ['21:527', '21:563', '21:601', '21:645', '21:672', '21:700'] as const
export type SourceFrameId = (typeof SOURCE_FRAMES)[number]

export const MODE_IDS = [
  'four-steps',
  'comparison',
  'theses-visual',
  'fact-explanations',
  'columns-photo',
  'feature-metrics',
] as const
export type ModeId = (typeof MODE_IDS)[number]

const CANVAS = { width: 1920, height: 1080 } as const
const SAFE = { left: 46, right: 46, top: 44, bottom: 34 } as const
const INITIAL_SCALE_SAMPLES = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3] as const
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 } as const

const snap4 = (n: number) => Math.round(n / 4) * 4
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const fixed = (n: number): Range => ({ min: n, preferred: n, max: n })
const range = (min: number, preferred: number, max: number): Range => ({ min, preferred, max })

export const scale30 = (value: number, minCap = 0, maxCap = Number.POSITIVE_INFINITY): Range => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(minCap) || minCap < 0 ||
      !(Number.isFinite(maxCap) || maxCap === Number.POSITIVE_INFINITY)) {
    throw new Error('Invalid base dimension or caps')
  }
  const min = Math.ceil(Math.max(value * 0.7, minCap) / 4) * 4
  const max = Math.floor(Math.min(value * 1.3, maxCap) / 4) * 4
  if (min > max || value < min || value > max) throw new Error('Infeasible dimension range')
  return { min, preferred: value, max }
}

/** Exact 4px fit inside the complete +/-30% interval. */
export function fitDimension(requested: number, bounds: Range): number {
  if (![requested, bounds.min, bounds.max].every(Number.isFinite)) throw new Error('Non-finite dimension')
  const min = Math.ceil(bounds.min / 4) * 4
  const max = Math.floor(bounds.max / 4) * 4
  if (min > max) throw new Error('No feasible 4px dimension')
  return clamp(snap4(requested), min, max)
}

const size30 = (rect: Rect, caps?: { minW?: number; maxW?: number; minH?: number; maxH?: number }) => ({
  width: scale30(rect.w, caps?.minW ?? 0, caps?.maxW ?? Number.POSITIVE_INFINITY),
  height: scale30(rect.h, caps?.minH ?? 0, caps?.maxH ?? Number.POSITIVE_INFINITY),
})

const textPolicy = (typographyRole: TypographyRole): TextPolicy => ({
  typographyRole,
  fontStepPx: 4,
  minScale: 0.7,
  maxScale: 1.3,
  lineHeight: 'design-system-coupled',
  adaptationPhase: 'last-resort',
})

const visualFit: VisualFitPolicy = {
  photo: 'cover',
  illustration: 'contain',
  diagram: 'contain',
  'abstract-graphic': 'contain',
}

const emph = (allowed: readonly Emphasis[], preferred: Emphasis, maxPrimaryItems: number) =>
  ({ allowed, preferred, maxPrimaryItems })

const region = (
  id: string,
  role: SemanticRole,
  rect: Rect,
  required: boolean,
  minItems: number,
  maxItems: number,
  accepts: readonly SemanticBlockType[],
  componentPriority: RegionContent['componentPriority'],
  options?: {
    primitiveTypographyRole?: TypographyRole
    group?: RegionContent['group']
    visual?: boolean
    flex?: RegionFlex
    emphasis?: RegionContent['emphasis']
    caps?: { minW?: number; maxW?: number; minH?: number; maxH?: number }
  },
): RegionSpec => ({
  id,
  preferredRect: rect,
  size: size30(rect, options?.caps),
  flex: options?.flex,
  content: {
    role,
    required,
    minItems,
    maxItems,
    accepts,
    componentPriority,
    primitiveTypographyRole: options?.primitiveTypographyRole,
    textPolicy: options?.primitiveTypographyRole ? textPolicy(options.primitiveTypographyRole) : undefined,
    group: options?.group,
    visualFit: options?.visual ? visualFit : undefined,
    emphasis: options?.emphasis ?? emph(['secondary'], 'secondary', 0),
  },
})

const group = (
  id: string,
  rect: Rect,
  direction: Direction,
  children: readonly GroupChildRef[],
  options?: {
    gapX?: Range
    gapY?: Range
    padding?: Insets
    align?: Align
    justify?: Justify
    columns?: number
    flex?: RegionFlex
    fixedW?: boolean
    fixedH?: boolean
  },
): LayoutGroupSpec => ({
  id,
  preferredRect: rect,
  size: {
    width: options?.fixedW ? fixed(rect.w) : scale30(rect.w),
    height: options?.fixedH ? fixed(rect.h) : scale30(rect.h),
  },
  direction,
  columns: options?.columns,
  gapX: options?.gapX ?? fixed(0),
  gapY: options?.gapY ?? fixed(0),
  padding: options?.padding ?? ZERO,
  align: options?.align ?? 'start',
  justify: options?.justify ?? 'start',
  children,
  gapBetweenPresentChildren: true,
  collapseEmpty: true,
  flex: options?.flex,
})

const field = (id: string, fieldPath: string, typographyRole: TypographyRole, options: Partial<InternalNodeSpec> = {}): InternalNodeSpec => ({
  kind: 'field', id, fieldPath, typographyRole, ...options,
})

const inodeGroup = (
  id: string,
  direction: 'row' | 'column',
  children: InternalNodeSpec[],
  options: Partial<InternalNodeSpec> = {},
): InternalNodeSpec => ({
  kind: 'group',
  id,
  direction,
  gap: options.gap ?? fixed(0),
  padding: options.padding ?? ZERO,
  align: options.align ?? 'start',
  justify: options.justify ?? 'start',
  surfaceRole: options.surfaceRole ?? 'plain',
  flex: options.flex,
  children,
})

const repeat = (
  id: string,
  fieldPath: string,
  direction: 'row' | 'column' | 'wrap',
  minItems: number,
  maxItems: number,
  item: InternalNodeSpec,
  options: Partial<InternalNodeSpec> = {},
): InternalNodeSpec => ({
  kind: 'repeat',
  id,
  fieldPath,
  direction,
  minItems,
  maxItems,
  gapX: options.gapX ?? fixed(0),
  gapY: options.gapY ?? fixed(0),
  columns: options.columns,
  item,
})

// ============================================================================
// SEMANTIC BLOCK CONTRACTS WITH INTERNAL COMPOSITION
// ============================================================================

const primitiveReason: PrimitiveFallback = {
  kind: 'semantic-primitive',
  reasonRequired: true,
  allowedReasons: FALLBACK_REASONS,
}

const simpleTextLayout = (id: string, fieldName: string, role: TypographyRole): PrimitiveLayoutVariant => ({
  id,
  root: inodeGroup('root', 'column', [field('value', fieldName, role)], { surfaceRole: 'plain' }),
})

const stepLayout: PrimitiveLayoutVariant = {
  id: 'step-card',
  root: inodeGroup(
    'step-root',
    'column',
    [
      field('marker', 'marker', 'step-marker'),
      inodeGroup('description', 'column', [
        field('heading', 'heading', 'step-heading'),
        field('body', 'body', 'body'),
      ], { gap: range(8, 14, 20) }),
    ],
    {
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      justify: 'space-between',
      surfaceRole: 'panel-outline',
    },
  ),
}

const comparisonItem = inodeGroup(
  'comparison-item',
  'row',
  [
    field('marker', 'marker', 'comparison-marker'),
    field('text', 'text', 'body', { flex: { grow: 1, shrink: 1 } }),
  ],
  {
    gap: range(12, 18, 24),
    padding: { top: 21, right: 0, bottom: 21, left: 0 },
    align: 'start',
    surfaceRole: 'plain',
  },
)

const comparisonLayout: PrimitiveLayoutVariant = {
  id: 'comparison-side',
  root: inodeGroup(
    'comparison-root',
    'column',
    [
      field('heading', 'heading', 'comparison-heading'),
      repeat('items', 'items', 'column', 1, 4, comparisonItem),
    ],
    {
      gap: fixed(24),
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      surfaceRole: 'comparison-panel',
    },
  ),
  decorations: [
    {
      id: 'comparison-item-top-line',
      ownerNodeId: 'comparison-item',
      edge: 'top',
      placement: 'inside-edge',
      reserveInsetPx: 0,
      preferredThicknessPx: 2,
      componentQuery: { semanticRole: 'list-separator', designSystem: 'active' },
      repeatPolicy: 'each-repeat-item',
    },
    {
      id: 'comparison-item-bottom-line',
      ownerNodeId: 'comparison-item',
      edge: 'bottom',
      placement: 'inside-edge',
      reserveInsetPx: 0,
      preferredThicknessPx: 2,
      componentQuery: { semanticRole: 'list-separator', designSystem: 'active' },
      repeatPolicy: 'each-repeat-item',
    },
  ],
}

const thesisLayout: PrimitiveLayoutVariant = {
  id: 'thesis-card',
  root: inodeGroup(
    'thesis-root',
    'column',
    [
      field('marker', 'marker', 'thesis-marker'),
      inodeGroup('description', 'column', [
        field('heading', 'heading', 'thesis-heading'),
        field('body', 'body', 'body'),
      ], { gap: fixed(12) }),
    ],
    {
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      justify: 'space-between',
      surfaceRole: 'panel-outline',
    },
  ),
}

const factLayout: PrimitiveLayoutVariant = {
  id: 'fact-panel',
  root: inodeGroup(
    'fact-root',
    'column',
    [field('index', 'index', 'fact-index'), field('text', 'text', 'fact-value')],
    {
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      justify: 'space-between',
      surfaceRole: 'fact-panel',
    },
  ),
}

const explanationLayout: PrimitiveLayoutVariant = {
  id: 'explanation-row',
  root: inodeGroup(
    'explanation-root',
    'column',
    [field('heading', 'heading', 'explanation-heading'), field('body', 'body', 'body')],
    {
      gap: fixed(14),
      padding: { top: 22, right: 0, bottom: 22, left: 0 },
      surfaceRole: 'plain',
    },
  ),
  decorations: [
    {
      id: 'explanation-top-separator',
      ownerNodeId: 'explanation-root',
      edge: 'top',
      placement: 'inside-edge',
      reserveInsetPx: 0,
      preferredThicknessPx: 2,
      componentQuery: { semanticRole: 'section-separator', designSystem: 'active' },
      repeatPolicy: 'once',
    },
  ],
}

const articleBodyItem = inodeGroup(
  'article-body-item',
  'column',
  [field('text', 'text', 'body')],
  { surfaceRole: 'plain' },
)

const articleTwoColumns: PrimitiveLayoutVariant = {
  id: 'article-2-columns',
  minStructuredItems: 2,
  maxStructuredItems: 2,
  root: inodeGroup('article-root', 'column', [
    field('title', 'title', 'article-title'),
    repeat('bodies', 'bodies', 'row', 2, 2, articleBodyItem, {
      columns: 2,
      gapX: range(20, 28, 40),
    }),
  ], { gap: fixed(24), surfaceRole: 'plain' }),
}

const articleOneColumn: PrimitiveLayoutVariant = {
  id: 'article-1-column',
  minStructuredItems: 1,
  maxStructuredItems: 2,
  root: inodeGroup('article-root', 'column', [
    field('title', 'title', 'article-title'),
    repeat('bodies', 'bodies', 'column', 1, 2, articleBodyItem, {
      columns: 1,
      gapY: range(20, 28, 40),
    }),
  ], { gap: fixed(24), surfaceRole: 'plain' }),
}

const featureLayout: PrimitiveLayoutVariant = {
  id: 'feature-panel',
  root: inodeGroup(
    'feature-root',
    'column',
    [
      field('period', 'period', 'feature-period'),
      field('title', 'title', 'feature-title'),
      field('comment', 'comment', 'feature-comment'),
    ],
    {
      padding: { top: 28, right: 28, bottom: 28, left: 28 },
      justify: 'space-between',
      surfaceRole: 'feature-panel',
    },
  ),
}

const metricLayout: PrimitiveLayoutVariant = {
  id: 'metric-panel',
  root: inodeGroup(
    'metric-root',
    'column',
    [field('value', 'value', 'metric-value'), field('caption', 'caption', 'metric-caption')],
    {
      padding: { top: 26, right: 26, bottom: 26, left: 26 },
      justify: 'space-between',
      surfaceRole: 'metric-panel',
    },
  ),
}

export const semanticBlockContracts: Record<SemanticBlockType, SemanticBlockContract> = {
  text: {
    type: 'text',
    fields: { text: { kind: 'single', required: true } },
    componentQuery: null,
    primitiveFallback: null,
    primitiveLayouts: [simpleTextLayout('text', 'text', 'body')],
  },
  label: {
    type: 'label',
    fields: { text: { kind: 'single', required: true } },
    componentQuery: {
      semanticRole: 'label',
      requiredFields: ['text'],
      allowedLayouts: ['inline', 'pill', 'chip'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [{ id: 'label', root: inodeGroup('tag-root', 'column', [field('value', 'text', 'tag')], {
      padding: { top: 12, right: 24, bottom: 12, left: 24 }, surfaceRole: 'tag',
    }) }],
  },
  step: {
    type: 'step',
    fields: {
      marker: { kind: 'single', required: true },
      heading: { kind: 'single', required: true },
      body: { kind: 'single', required: true },
    },
    componentQuery: {
      semanticRole: 'step',
      requiredFields: ['marker', 'heading', 'body'],
      allowedLayouts: ['vertical-card'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [stepLayout],
  },
  'comparison-side': {
    type: 'comparison-side',
    fields: {
      heading: { kind: 'single', required: true },
      items: {
        kind: 'structured-list',
        required: true,
        minItems: 1,
        maxItems: 4,
        itemFields: { marker: { required: true }, text: { required: true } },
      },
    },
    componentQuery: {
      semanticRole: 'comparison-side',
      requiredFields: ['heading', 'items'],
      allowedLayouts: ['panel-list'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [comparisonLayout],
  },
  thesis: {
    type: 'thesis',
    fields: {
      marker: { kind: 'single', required: true },
      heading: { kind: 'single', required: true },
      body: { kind: 'single', required: true },
    },
    componentQuery: {
      semanticRole: 'thesis',
      requiredFields: ['marker', 'heading', 'body'],
      allowedLayouts: ['compact-card'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [thesisLayout],
  },
  fact: {
    type: 'fact',
    fields: {
      index: { kind: 'single', required: true },
      text: { kind: 'single', required: true },
    },
    componentQuery: {
      semanticRole: 'fact',
      requiredFields: ['index', 'text'],
      allowedLayouts: ['feature-panel'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [factLayout],
  },
  explanation: {
    type: 'explanation',
    fields: {
      heading: { kind: 'single', required: true },
      body: { kind: 'single', required: true },
    },
    componentQuery: {
      semanticRole: 'explanation',
      requiredFields: ['heading', 'body'],
      allowedLayouts: ['stacked-row'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [explanationLayout],
  },
  article: {
    type: 'article',
    fields: {
      title: { kind: 'single', required: true },
      bodies: {
        kind: 'structured-list',
        required: true,
        minItems: 1,
        maxItems: 2,
        itemFields: { text: { required: true } },
      },
    },
    componentQuery: {
      semanticRole: 'article',
      requiredFields: ['title', 'bodies'],
      allowedLayouts: ['two-column', 'one-column'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [articleTwoColumns, articleOneColumn],
  },
  feature: {
    type: 'feature',
    fields: {
      period: { kind: 'single', required: true },
      title: { kind: 'single', required: true },
      comment: { kind: 'single', required: true },
    },
    componentQuery: {
      semanticRole: 'feature',
      requiredFields: ['period', 'title', 'comment'],
      allowedLayouts: ['feature-panel'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [featureLayout],
  },
  metric: {
    type: 'metric',
    fields: {
      value: { kind: 'single', required: true },
      caption: { kind: 'single', required: true },
    },
    componentQuery: {
      semanticRole: 'metric',
      requiredFields: ['value', 'caption'],
      allowedLayouts: ['metric-panel', 'metric-card'],
      designSystem: 'active',
    },
    primitiveFallback: primitiveReason,
    primitiveLayouts: [metricLayout],
  },
  visual: {
    type: 'visual',
    fields: {
      assetRef: { kind: 'single', required: true },
      visualType: { kind: 'single', required: true },
    },
    componentQuery: null,
    primitiveFallback: null,
    primitiveLayouts: [],
  },
}

// ============================================================================
// COMMON STATE CHROME
// ============================================================================

const headerRegions = (formatRect: Rect): RegionSpec[] => [
  region('context', 'context', { x: 46, y: 56.5, w: 197, h: 29 }, false, 0, 1, ['text'], 'primitive-first', {
    primitiveTypographyRole: 'header',
    emphasis: emph(['secondary'], 'secondary', 0),
  }),
  region('year', 'year', { x: 393, y: 56.5, w: 59, h: 29 }, false, 0, 1, ['text'], 'primitive-first', {
    primitiveTypographyRole: 'header',
    emphasis: emph(['secondary'], 'secondary', 0),
  }),
  region('format', 'format', formatRect, false, 0, 1, ['text'], 'primitive-first', {
    primitiveTypographyRole: 'header',
    emphasis: emph(['secondary'], 'secondary', 0),
  }),
]

const tagRegion = (rect: Rect): RegionSpec =>
  region('tag', 'tag', rect, false, 0, 1, ['label'], 'component-first', {
    primitiveTypographyRole: 'tag',
    emphasis: emph(['secondary'], 'secondary', 0),
  })

const footerRegions = (pageRect: Rect): RegionSpec[] => [
  region('footer', 'footer', { x: 46, y: 1019, w: 530, h: 27 }, false, 0, 1, ['text'], 'primitive-first', {
    primitiveTypographyRole: 'footer',
    emphasis: emph(['secondary'], 'secondary', 0),
  }),
  region('page', 'page', pageRect, false, 0, 1, ['text'], 'primitive-first', {
    primitiveTypographyRole: 'page',
    emphasis: emph(['secondary'], 'secondary', 0),
  }),
]

const headerDecoration = (): StateDecorationSpec => ({
  id: 'context-year-separator',
  ownerGroupId: 'header-row',
  placement: 'flow-after-region',
  regionId: 'context',
  preferredSize: { width: 118, height: 2 },
  reserveFlowSpace: true,
  componentQuery: { semanticRole: 'context-separator', designSystem: 'active' },
  onlyWhenRegionsPresent: ['context', 'year'],
})

const commonGroups = (mainGroupId: string): LayoutGroupSpec[] => [
  group(
    'header-row',
    { x: 46, y: 44, w: 1828, h: 54 },
    'row',
    [
      { kind: 'region', id: 'context' },
      { kind: 'decoration', id: 'context-year-separator' },
      { kind: 'region', id: 'year' },
      { kind: 'region', id: 'format', pushToEnd: true },
    ],
    { gapX: fixed(16), align: 'center', justify: 'start', fixedW: true, fixedH: true },
  ),
  group(
    'content-stack',
    { x: 46, y: 122, w: 1828, h: 866 },
    'column',
    [{ kind: 'region', id: 'tag' }, { kind: 'group', id: mainGroupId, flex: { grow: 1, shrink: 1 } }],
    { gapY: fixed(24), align: 'stretch', justify: 'start', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } },
  ),
  group(
    'footer-row',
    { x: 46, y: 1012, w: 1828, h: 34 },
    'row',
    [{ kind: 'region', id: 'footer' }, { kind: 'region', id: 'page', pushToEnd: true }],
    { justify: 'start', align: 'end', fixedW: true, fixedH: true },
  ),
  group(
    'slide-stack',
    { x: 46, y: 44, w: 1828, h: 1002 },
    'column',
    [
      { kind: 'group', id: 'header-row' },
      { kind: 'group', id: 'content-stack', flex: { grow: 1, shrink: 1 } },
      { kind: 'group', id: 'footer-row' },
    ],
    { gapY: fixed(24), align: 'stretch', justify: 'start', fixedW: true, fixedH: true },
  ),
]

const fixedGroupPolicy = (layout: GroupLayout): RegionContent['group'] => ({
  qwenMayChooseLayout: false,
  allowedLayouts: [layout],
  preferredLayoutId: layout.id,
})

const stepsRow4: GroupLayout = {
  id: 'steps-row-4', direction: 'row', columns: 4, minItems: 4, maxItems: 4,
  gapX: fixed(16), gapY: fixed(0),
  referenceItems: [
    { x: 0, y: 0, w: 445, h: 703 }, { x: 461, y: 0, w: 445, h: 703 },
    { x: 922, y: 0, w: 445, h: 703 }, { x: 1383, y: 0, w: 445, h: 703 },
  ],
}

const thesisGrid4: GroupLayout = {
  id: 'thesis-grid-2x2', direction: 'wrap', columns: 2, minItems: 4, maxItems: 4,
  gapX: fixed(16), gapY: fixed(16),
  referenceItems: [
    { x: 0, y: 0, w: 522, h: 320 }, { x: 538, y: 0, w: 522, h: 320 },
    { x: 0, y: 336, w: 522, h: 320 }, { x: 538, y: 336, w: 522, h: 320 },
  ],
}

const explanationColumn3: GroupLayout = {
  id: 'explanations-column-3', direction: 'column', columns: 1, minItems: 3, maxItems: 3,
  gapX: fixed(0), gapY: fixed(0),
  referenceItems: [
    { x: 0, y: 0, w: 1040, h: 263 }, { x: 0, y: 263, w: 1040, h: 263 }, { x: 0, y: 526, w: 1040, h: 263 },
  ],
}

const metricGrid4: GroupLayout = {
  id: 'metrics-grid-2x2', direction: 'wrap', columns: 2, minItems: 4, maxItems: 4,
  gapX: fixed(16), gapY: fixed(16),
  referenceItems: [
    { x: 0, y: 0, w: 572, h: 316 }, { x: 588, y: 0, w: 572, h: 316 },
    { x: 0, y: 332, w: 572, h: 316 }, { x: 588, y: 332, w: 572, h: 316 },
  ],
}

// ============================================================================
// COMPLETE 6-STATE RECIPE
// ============================================================================

export const states: AuthoredState[] = [
  // --------------------------------------------------------------------------
  // 1 — 21:527 / four steps
  // --------------------------------------------------------------------------
  {
    id: 'four-steps-01',
    modeId: 'four-steps',
    sourceFrame: '21:527',
    densityRank: 1,
    regions: [
      ...headerRegions({ x: 1584, y: 56.5, w: 290, h: 29 }),
      tagRegion({ x: 46, y: 122, w: 390, h: 53 }),
      region('title', 'title', { x: 46, y: 199, w: 1828, h: 68 }, true, 1, 1, ['text'], 'primitive-first', {
        primitiveTypographyRole: 'title',
        flex: { height: { growPriority: 1, shrinkPriority: 3 } },
        emphasis: emph(['primary'], 'primary', 1),
      }),
      region('steps', 'steps', { x: 46, y: 285, w: 1828, h: 703 }, true, 4, 4, ['step'], 'component-first', {
        group: fixedGroupPolicy(stepsRow4),
        flex: { height: { growPriority: 3, shrinkPriority: 1 }, width: { growPriority: 2, shrinkPriority: 2 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      ...footerRegions({ x: 1807, y: 1019, w: 67, h: 27 }),
    ],
    groups: [
      group('sequence-main', { x: 46, y: 199, w: 1828, h: 789 }, 'column', [
        { kind: 'region', id: 'title' }, { kind: 'region', id: 'steps', flex: { grow: 1, shrink: 1 } },
      ], { gapY: fixed(18), align: 'stretch', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } }),
      ...commonGroups('sequence-main'),
    ],
    rootGroupId: 'slide-stack',
    decorations: [headerDecoration()],
  },

  // --------------------------------------------------------------------------
  // 2 — 21:563 / comparison
  // --------------------------------------------------------------------------
  {
    id: 'comparison-01',
    modeId: 'comparison',
    sourceFrame: '21:563',
    densityRank: 1,
    regions: [
      ...headerRegions({ x: 1592, y: 56.5, w: 282, h: 29 }),
      tagRegion({ x: 46, y: 122, w: 309, h: 53 }),
      region('comparison-left', 'comparison-left', { x: 46, y: 199, w: 902, h: 789 }, true, 1, 1, ['comparison-side'], 'component-first', {
        flex: { width: { growPriority: 1, shrinkPriority: 1 }, height: { growPriority: 1, shrinkPriority: 1 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      region('comparison-right', 'comparison-right', { x: 972, y: 199, w: 902, h: 789 }, true, 1, 1, ['comparison-side'], 'component-first', {
        flex: { width: { growPriority: 1, shrinkPriority: 1 }, height: { growPriority: 1, shrinkPriority: 1 } },
        emphasis: emph(['primary'], 'primary', 1),
      }),
      ...footerRegions({ x: 1805, y: 1019, w: 69, h: 27 }),
    ],
    groups: [
      group('comparison-main', { x: 46, y: 199, w: 1828, h: 789 }, 'row', [
        { kind: 'region', id: 'comparison-left', flex: { grow: 1, shrink: 1 } },
        { kind: 'region', id: 'comparison-right', flex: { grow: 1, shrink: 1 } },
      ], { gapX: fixed(24), align: 'stretch', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } }),
      ...commonGroups('comparison-main'),
    ],
    rootGroupId: 'slide-stack',
    decorations: [headerDecoration()],
    notes: ['Left/right comparison surface contrast is resolved from active-DS emphasis profiles; no Figma colors are copied.'],
  },

  // --------------------------------------------------------------------------
  // 3 — 21:601 / four theses + visual
  // --------------------------------------------------------------------------
  {
    id: 'theses-visual-01',
    modeId: 'theses-visual',
    sourceFrame: '21:601',
    densityRank: 1,
    regions: [
      ...headerRegions({ x: 1664, y: 56.5, w: 210, h: 29 }),
      tagRegion({ x: 46, y: 122, w: 408, h: 53 }),
      region('theses', 'theses', { x: 46, y: 199, w: 1060, h: 789 }, true, 4, 4, ['thesis'], 'component-first', {
        group: fixedGroupPolicy(thesisGrid4),
        flex: { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      region('visual', 'visual', { x: 1130, y: 199, w: 744, h: 656 }, true, 1, 1, ['visual'], 'asset-only', {
        visual: true,
        flex: { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      ...footerRegions({ x: 1805, y: 1019, w: 69, h: 27 }),
    ],
    groups: [
      group('theses-visual-main', { x: 46, y: 199, w: 1828, h: 789 }, 'row', [
        { kind: 'region', id: 'theses' }, { kind: 'region', id: 'visual', flex: { grow: 1, shrink: 1 } },
      ], { gapX: fixed(24), align: 'start', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } }),
      ...commonGroups('theses-visual-main'),
    ],
    rootGroupId: 'slide-stack',
    decorations: [headerDecoration()],
    notes: ['Visual asset fit is semantic: photo may cover; illustration/diagram/abstract graphic use contain.'],
  },

  // --------------------------------------------------------------------------
  // 4 — 21:645 / fact + three explanations
  // --------------------------------------------------------------------------
  {
    id: 'fact-explanations-01',
    modeId: 'fact-explanations',
    sourceFrame: '21:645',
    densityRank: 1,
    regions: [
      ...headerRegions({ x: 1632, y: 56.5, w: 242, h: 29 }),
      tagRegion({ x: 46, y: 122, w: 351, h: 53 }),
      region('fact', 'fact', { x: 46, y: 199, w: 760, h: 789 }, true, 1, 1, ['fact'], 'component-first', {
        flex: { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 1 } },
        emphasis: emph(['primary'], 'primary', 1),
      }),
      region('explanations', 'explanations', { x: 834, y: 199, w: 1040, h: 789 }, true, 3, 3, ['explanation'], 'component-first', {
        group: fixedGroupPolicy(explanationColumn3),
        flex: { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 1 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      ...footerRegions({ x: 1809, y: 1019, w: 65, h: 27 }),
    ],
    groups: [
      group('fact-explanations-main', { x: 46, y: 199, w: 1828, h: 789 }, 'row', [
        { kind: 'region', id: 'fact' }, { kind: 'region', id: 'explanations', flex: { grow: 1, shrink: 1 } },
      ], { gapX: fixed(28), align: 'stretch', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } }),
      ...commonGroups('fact-explanations-main'),
    ],
    rootGroupId: 'slide-stack',
    decorations: [headerDecoration()],
  },

  // --------------------------------------------------------------------------
  // 5 — 21:672 / article + photo
  // --------------------------------------------------------------------------
  {
    id: 'columns-photo-01',
    modeId: 'columns-photo',
    sourceFrame: '21:672',
    densityRank: 1,
    regions: [
      ...headerRegions({ x: 1620, y: 56.5, w: 254, h: 29 }),
      tagRegion({ x: 46, y: 122, w: 335, h: 53 }),
      region('article', 'article', { x: 46, y: 199, w: 1180, h: 789 }, true, 1, 1, ['article'], 'component-first', {
        flex: { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 1 } },
        emphasis: emph(['primary'], 'primary', 1),
      }),
      region('visual', 'visual', { x: 1254, y: 199, w: 620, h: 650 }, true, 1, 1, ['visual'], 'asset-only', {
        visual: true,
        flex: { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      ...footerRegions({ x: 1813, y: 1019, w: 61, h: 27 }),
    ],
    groups: [
      group('columns-photo-main', { x: 46, y: 199, w: 1828, h: 789 }, 'row', [
        { kind: 'region', id: 'article' }, { kind: 'region', id: 'visual', flex: { grow: 1, shrink: 1 } },
      ], { gapX: fixed(28), align: 'start', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } }),
      ...commonGroups('columns-photo-main'),
    ],
    rootGroupId: 'slide-stack',
    decorations: [headerDecoration()],
    notes: [
      'Article primitive fallback explicitly supports authored 2-column flow and an allowed 1-column reflow; executor chooses by measured fit, not Qwen geometry.',
    ],
  },

  // --------------------------------------------------------------------------
  // 6 — 21:700 / feature + 4 metrics
  // --------------------------------------------------------------------------
  {
    id: 'feature-metrics-01',
    modeId: 'feature-metrics',
    sourceFrame: '21:700',
    densityRank: 1,
    regions: [
      ...headerRegions({ x: 1634, y: 56.5, w: 240, h: 29 }),
      tagRegion({ x: 46, y: 122, w: 522, h: 53 }),
      region('feature', 'feature', { x: 46, y: 199, w: 620, h: 789 }, true, 1, 1, ['feature'], 'component-first', {
        flex: { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 1 } },
        emphasis: emph(['primary'], 'primary', 1),
      }),
      region('metrics', 'metrics', { x: 682, y: 199, w: 1192, h: 789 }, true, 4, 4, ['metric'], 'component-first', {
        group: fixedGroupPolicy(metricGrid4),
        flex: { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } },
        emphasis: emph(['secondary'], 'secondary', 0),
      }),
      ...footerRegions({ x: 1810, y: 1019, w: 64, h: 27 }),
    ],
    groups: [
      group('feature-metrics-main', { x: 46, y: 199, w: 1828, h: 789 }, 'row', [
        { kind: 'region', id: 'feature' }, { kind: 'region', id: 'metrics', flex: { grow: 1, shrink: 1 } },
      ], { gapX: fixed(16), align: 'stretch', fixedW: true, flex: { height: { growPriority: 1, shrinkPriority: 1 } } }),
      ...commonGroups('feature-metrics-main'),
    ],
    rootGroupId: 'slide-stack',
    decorations: [headerDecoration()],
  },
]

// ============================================================================
// RECIPE
// ============================================================================

export const recipe = {
  id: RECIPE_ID,
  version: 5,
  sourceSection: SOURCE_SECTION,
  canvas: CANVAS,
  safeArea: SAFE,

  runtimeSourcePolicy: {
    figmaProvides: [
      'composition',
      'authored-reference-geometry',
      'hierarchy',
      'density-states',
      'structural-group-relations',
      'visual-region-proportions',
    ],
    figmaMustNotProvide: [
      'runtime-text',
      'runtime-numbers',
      'runtime-icons',
      'runtime-images',
      'font-family',
      'font-weight',
      'text-color',
      'surface-color',
      'component-id',
    ],
    typographySource: 'active-design-system',
    colorSource: 'active-design-system',
    surfaceSource: 'active-design-system',
    componentSource: 'active-design-system-registry',
  },

  adaptation: {
    initialScaleSamples: INITIAL_SCALE_SAMPLES,
    initialSamplesAreExhaustive: false,
    dimensionSearch: 'all-feasible-4px-values-within-region-and-group-size-range',
    blockScaleAppliesTo: ['region-width', 'region-height', 'group-width', 'group-height'],
    scalingMethod: 'relayout-not-transform',
    adaptedDimensionStepPx: 4,
    unchangedAuthoredDimensionsMayBeOffGrid: true,
    fontStepPx: 4,
    lineHeightPolicy: 'resolve-with-font-size-from-active-design-system',
    nativeArtworkStretch: 'forbidden',
    groupOrderSource: 'normalized-block-sequence-index',
    internalPrimitiveLayout: 'contract-only-no-free-placement',
    primitiveCompiler: 'createStateRenderPlan',
    singleFieldTypography: 'region-role-overrides-semantic-default',
    measurementFreshness: 'content-and-design-system-revisions-plus-normalized-block-key',
  },

  presence: {
    resolver: 'resolvePresentState',
    model: 'hierarchical-flow-groups',
    emptyOptionalRegion: 'remove-child-before-solving',
    groupOccupancy: 'group-remains-while-any-present-child-remains',
    gaps: 'insert-only-between-present-children',
    tagAbsent: 'content-stack-collapses-tag-child-and-main-group-moves-up',
    footerAbsentButPagePresent: 'footer-row-remains-occupied',
    footerAndPageAbsent: 'footer-row-collapses-and-content-stack-may-grow-down',
    decorationAbsent: 'remove-its-reserved-flow-item-before-solving',
    trailingAlignment: 'pushToEnd-on-specific-child-never-last-surviving-child',
  },

  hardValidation: {
    overflow: 'reject',
    collision: 'reject',
    outOfBounds: 'reject',
    preserveAllSuppliedContent: true,
    optionalRegionMeansDroppableContent: false,
    immutableNormalizedBlockType: true,
    validDesignSystemComponentsOnly: true,
    validateComponentFieldBindings: true,
    componentFirstCannotBeBypassedByTextRelabel: true,
    validateInternalPrimitiveLayout: true,
    validateAttachedDecorations: true,
    validateAllowedGroupLayouts: true,
    preserveVisualAspectRatio: true,
    diagramCropping: 'forbidden',
    adaptedDimensionStepPx: 4,
  },

  stateSelection: {
    qwenMayChooseMode: true,
    qwenMayChooseState: false,
    order: [
      'filter-state-by-mode-and-locked-semantic-blocks',
      'try-native-active-design-system-typography',
      'try-real-design-system-components',
      'adapt-region-and-group-geometry-on-full-4px-grid',
      'adapt-only-declared-group-and-internal-layout-variants',
      'fallback-to-semantic-primitive-with-executor-evidence',
      'reduce-font-size-in-4px-steps-as-last-resort',
      'hard-validate',
      'reject-state-if-invalid',
      'reject-mode-if-no-state-valid',
    ],
    tieBreakers: [
      'retain-real-components',
      'least-font-reduction',
      'least-geometry-deviation-from-authored-reference',
      'preferred-internal-layout',
    ],
  },

  semanticBlocks: semanticBlockContracts,
  modes: [
    { id: 'four-steps', states: ['four-steps-01'] },
    { id: 'comparison', states: ['comparison-01'] },
    { id: 'theses-visual', states: ['theses-visual-01'] },
    { id: 'fact-explanations', states: ['fact-explanations-01'] },
    { id: 'columns-photo', states: ['columns-photo-01'] },
    { id: 'feature-metrics', states: ['feature-metrics-01'] },
  ],
  states,
}

// ============================================================================
// QWEN STRUCTURAL ASSIGNMENT
// Qwen assigns immutable normalized block IDs. It cannot emit `type`, fields,
// sourceRefs, coordinates, sizes or arbitrary component IDs.
// ============================================================================

export type MeasurementScope = {
  blockId: string
  blockKey: string
  contentRevision: string
  designSystemId: string
  designSystemRevision: string
  stateIds: readonly string[]
  regionIds: readonly string[]
  emphasis: Emphasis
  groupLayoutId: string | null
}

export type MeasuredComponentVariant = MeasurementScope & { id: string; componentId: string }

export type FallbackEvidence = MeasurementScope & { reason: FallbackReason }

export type QwenSchemaContext = {
  designSystemId: string
  designSystemRevision: string
  contentRevision: string
  sourceRefs: readonly [string, ...string[]]
  sourceUseCounts?: Readonly<Record<string, number>>
  blocks: readonly [NormalizedBlock, ...NormalizedBlock[]]
  componentVariants: readonly MeasuredComponentVariant[]
  fallbackEvidence: readonly FallbackEvidence[]
  visualAssets: readonly { blockId: string; sourceRef: string; assetId: string; visualType: VisualType }[]
}

const ALL_REGION_IDS = [
  'context', 'year', 'format', 'tag', 'title', 'steps',
  'comparison-left', 'comparison-right', 'theses', 'fact', 'explanations',
  'article', 'feature', 'metrics', 'visual', 'footer', 'page',
] as const

const visualTypes = ['photo', 'illustration', 'diagram', 'abstract-graphic'] as const
const nonemptyRefs = z.array(z.string().min(1)).min(1)
const fieldBindingShape = z.object({ sourceRefs: nonemptyRefs }).strict()
const structuredItemShape = z.object({ sourceRefs: nonemptyRefs, fields: z.record(fieldBindingShape) }).strict()
const normalizedBlockShape = z.object({
  id: z.string().min(1), type: z.enum(['text', 'label', 'step', 'comparison-side', 'thesis', 'fact', 'explanation', 'article', 'feature', 'metric', 'visual']),
  allowedRoles: z.array(z.enum(ALL_REGION_IDS)).min(1), sequenceIndex: z.number().int().nonnegative(),
  sourceRefs: nonemptyRefs,
  fields: z.record(z.union([fieldBindingShape, z.array(structuredItemShape), z.enum(visualTypes)])),
}).strict()
const measurementScopeShape = {
  blockId: z.string().min(1), blockKey: z.string().min(1), contentRevision: z.string().min(1),
  designSystemId: z.string().min(1), designSystemRevision: z.string().min(1),
  stateIds: z.array(z.string().min(1)).min(1), regionIds: z.array(z.string().min(1)).min(1),
  emphasis: z.enum(['primary', 'secondary']), groupLayoutId: z.string().min(1).nullable(),
} as const
const contextShape = z.object({
  designSystemId: z.string().min(1), designSystemRevision: z.string().min(1), contentRevision: z.string().min(1),
  sourceRefs: nonemptyRefs, sourceUseCounts: z.record(z.number().int().positive()).optional(),
  blocks: z.array(normalizedBlockShape).min(1),
  componentVariants: z.array(z.object({ ...measurementScopeShape, id: z.string().min(1), componentId: z.string().min(1) }).strict()),
  fallbackEvidence: z.array(z.object({ ...measurementScopeShape, reason: z.enum(FALLBACK_REASONS) }).strict()),
  visualAssets: z.array(z.object({ blockId: z.string().min(1), sourceRef: z.string().min(1), assetId: z.string().min(1), visualType: z.enum(visualTypes) }).strict()),
}).strict()

/** Stable binding identity, not a hash of private text. Array order is preserved;
 * object property insertion order is irrelevant. Source IDs must be immutable
 * within contentRevision; change the revision when their underlying text changes. */
export function normalizedBlockKey(block: NormalizedBlock): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value
  return JSON.stringify(canonical(block))
}

export function createQwenAssignmentSchema(ctx: QwenSchemaContext) {
  assertContext(ctx)
  const blockIds = ctx.blocks.map(b => b.id) as [string, ...string[]]
  const variantIds = ctx.componentVariants.map(v => v.id)
  const primitive = z.object({ kind: z.literal('primitive'), reason: z.enum(FALLBACK_REASONS).nullable() }).strict()
  const asset = z.object({ kind: z.literal('asset') }).strict()
  const render = variantIds.length
    ? z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('component'), variantId: z.enum(variantIds as [string, ...string[]]) }).strict(),
        primitive,
        asset,
      ])
    : z.discriminatedUnion('kind', [primitive, asset])

  return z.object({
    modeId: z.enum(MODE_IDS),
    assignments: z.array(z.object({
      blockId: z.enum(blockIds),
      regionId: z.enum(ALL_REGION_IDS),
      emphasis: z.enum(['primary', 'secondary']),
      render,
    }).strict()).min(1),
  }).strict()
}

export type QwenRenderChoice =
  | { kind: 'component'; variantId: string }
  | { kind: 'primitive'; reason: FallbackReason | null }
  | { kind: 'asset' }

export type QwenAssignment = {
  modeId: ModeId
  assignments: { blockId: string; regionId: string; emphasis: Emphasis; render: QwenRenderChoice }[]
}

export class RecipeAssignmentError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(issues.join('\n'))
    this.name = 'RecipeAssignmentError'
  }
}

function isStructuredList(value: NormalizedFieldValue | VisualType): value is readonly StructuredItemBinding[] {
  return Array.isArray(value)
}

function isFieldBinding(value: NormalizedFieldValue | VisualType): value is FieldBinding {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray((value as FieldBinding).sourceRefs)
}

function sourceRefsFromValue(value: NormalizedFieldValue | VisualType): string[] {
  if (typeof value === 'string') return []
  if (isStructuredList(value)) return value.flatMap(item => [...item.sourceRefs])
  return [...value.sourceRefs]
}

function validateNormalizedBlock(block: NormalizedBlock): string[] {
  const issues: string[] = []
  const contract = semanticBlockContracts[block.type]
  if (!contract) return [`unknown-block-type:${block.id}`]
  if (!block.id || !Number.isFinite(block.sequenceIndex)) issues.push(`invalid-block-identity:${block.id}`)
  if (!block.allowedRoles.length) issues.push(`missing-role-contract:${block.id}`)
  if (new Set(block.allowedRoles).size !== block.allowedRoles.length) issues.push(`duplicate-allowed-role:${block.id}`)
  if (new Set(block.sourceRefs).size !== block.sourceRefs.length) issues.push(`duplicate-block-source-ref:${block.id}`)

  const fieldKeys = new Set(Object.keys(block.fields))
  for (const [name, fieldContract] of Object.entries(contract.fields)) {
    fieldKeys.delete(name)
    const value = block.fields[name]
    if (fieldContract.required && value === undefined) issues.push(`missing-field:${block.id}:${name}`)
    if (value === undefined) continue
    if (name === 'visualType') {
      if (typeof value !== 'string' || !['photo', 'illustration', 'diagram', 'abstract-graphic'].includes(value)) {
        issues.push(`invalid-visual-type:${block.id}`)
      }
      continue
    }
    if (fieldContract.kind === 'single') {
      if (!isFieldBinding(value) || !value.sourceRefs.length) issues.push(`invalid-single-field:${block.id}:${name}`)
    } else {
      if (!isStructuredList(value) || value.length < fieldContract.minItems || value.length > fieldContract.maxItems) {
        issues.push(`invalid-structured-list-count:${block.id}:${name}`)
      } else {
        for (const [i, item] of value.entries()) {
          const keys = new Set(Object.keys(item.fields))
          for (const [f, spec] of Object.entries(fieldContract.itemFields)) {
            if (spec.required && !item.fields[f]?.sourceRefs?.length) issues.push(`missing-item-field:${block.id}:${name}:${i}:${f}`)
            keys.delete(f)
          }
          if (keys.size) issues.push(`unknown-item-field:${block.id}:${name}:${i}:${[...keys].join(',')}`)
          const itemFieldRefs = Object.values(item.fields).flatMap(v => [...v.sourceRefs]).sort()
          const itemRefs = [...item.sourceRefs].sort()
          if (itemFieldRefs.length !== itemRefs.length || itemFieldRefs.some((id, j) => id !== itemRefs[j])) {
            issues.push(`item-fields-do-not-match-source-refs:${block.id}:${name}:${i}`)
          }
          if (new Set(itemRefs).size !== itemRefs.length) issues.push(`duplicate-item-source-ref:${block.id}:${name}:${i}`)
        }
      }
    }
    fieldKeys.delete(name)
  }
  if (fieldKeys.size) issues.push(`unknown-field:${block.id}:${[...fieldKeys].join(',')}`)

  const refs = Object.values(block.fields).flatMap(sourceRefsFromValue)
  const sortedA = [...refs].sort()
  const sortedB = [...block.sourceRefs].sort()
  if (sortedA.length !== sortedB.length || sortedA.some((id, i) => id !== sortedB[i])) {
    issues.push(`block-fields-do-not-match-source-refs:${block.id}`)
  }
  if (block.type === 'visual' && (!isFieldBinding(block.fields.assetRef) || block.fields.assetRef.sourceRefs.length !== 1)) {
    issues.push(`visual-requires-one-asset-ref:${block.id}`)
  }
  return issues
}

function assertContext(ctx: QwenSchemaContext): void {
  const shape = contextShape.safeParse(ctx)
  if (!shape.success) throw new RecipeAssignmentError(shape.error.issues.map(i => `invalid-context:${i.path.join('.')}:${i.message}`))
  const issues: string[] = []
  if (!ctx.designSystemId) issues.push('missing-active-design-system')
  if (!ctx.sourceRefs.length || new Set(ctx.sourceRefs).size !== ctx.sourceRefs.length) issues.push('source-refs-must-be-unique')
  if (new Set(ctx.blocks.map(b => b.id)).size !== ctx.blocks.length) issues.push('duplicate-block-id')
  if (new Set(ctx.blocks.map(b => b.sequenceIndex)).size !== ctx.blocks.length) issues.push('duplicate-sequence-index')
  for (const id of Object.keys(ctx.sourceUseCounts ?? {})) if (!ctx.sourceRefs.includes(id)) issues.push(`unknown-source-use-count:${id}`)
  for (const b of ctx.blocks) issues.push(...validateNormalizedBlock(b))
  const assetRefs = new Set(ctx.blocks.filter(b => b.type === 'visual').flatMap(b =>
    isFieldBinding(b.fields.assetRef) ? [...b.fields.assetRef.sourceRefs] : []))
  for (const b of ctx.blocks) if (b.type !== 'visual' && b.sourceRefs.some(id => assetRefs.has(id))) issues.push(`asset-used-as-text:${b.id}`)

  const uses = new Map<string, number>()
  for (const b of ctx.blocks) for (const id of b.sourceRefs) {
    if (!ctx.sourceRefs.includes(id)) issues.push(`unknown-source-ref:${b.id}:${id}`)
    uses.set(id, (uses.get(id) ?? 0) + 1)
  }
  for (const id of ctx.sourceRefs) {
    const expected = ctx.sourceUseCounts?.[id] ?? 1
    if ((uses.get(id) ?? 0) !== expected) issues.push(`normalized-source-coverage:${id}:expected=${expected}:actual=${uses.get(id) ?? 0}`)
  }

  if (new Set(ctx.componentVariants.map(v => v.id)).size !== ctx.componentVariants.length) issues.push('duplicate-variant-id')
  for (const scope of [...ctx.componentVariants, ...ctx.fallbackEvidence]) {
    const b = ctx.blocks.find(b => b.id === scope.blockId)
    if (!b) { issues.push(`measurement-for-unknown-block:${scope.blockId}`); continue }
    if (scope.designSystemId !== ctx.designSystemId || scope.designSystemRevision !== ctx.designSystemRevision) issues.push(`measurement-from-another-design-system:${scope.blockId}`)
    if (scope.contentRevision !== ctx.contentRevision || scope.blockKey !== normalizedBlockKey(b)) issues.push(`stale-block-measurement:${scope.blockId}`)
    for (const stateId of scope.stateIds) {
      const s = states.find(s => s.id === stateId)
      if (!s) { issues.push(`measurement-unknown-state:${stateId}`); continue }
      for (const regionId of scope.regionIds) {
        const r = s.regions.find(r => r.id === regionId)
        if (!r) { issues.push(`measurement-unknown-region:${stateId}:${regionId}`); continue }
        if (!r.content.accepts.includes(b.type) || !b.allowedRoles.includes(r.content.role) ||
            !r.content.emphasis.allowed.includes(scope.emphasis)) issues.push(`measurement-incompatible-with-region:${scope.blockId}:${regionId}`)
        if (scope.groupLayoutId !== (r.content.group?.preferredLayoutId ?? null)) issues.push(`measurement-layout-mismatch:${scope.blockId}:${regionId}`)
      }
    }
  }
  for (const v of ctx.componentVariants) {
    const b = ctx.blocks.find(b => b.id === v.blockId)
    if (b && !semanticBlockContracts[b.type]?.componentQuery) issues.push(`component-type-not-supported:${v.blockId}`)
  }
  if (new Set(ctx.visualAssets.map(a => a.blockId)).size !== ctx.visualAssets.length) issues.push('duplicate-visual-block')
  for (const a of ctx.visualAssets) {
    const b = ctx.blocks.find(x => x.id === a.blockId)
    const assetField = b?.fields.assetRef
    const visualType = b?.fields.visualType
    const boundAssetRef = assetField && isFieldBinding(assetField) ? assetField.sourceRefs[0] : null
    if (!b || b.type !== 'visual' || boundAssetRef !== a.sourceRef || visualType !== a.visualType || !a.assetId) issues.push(`invalid-visual-asset:${a.blockId}`)
  }
  if (issues.length) throw new RecipeAssignmentError(issues)
}

export function validateQwenAssignment(raw: unknown, ctx: QwenSchemaContext): {
  assignment: QwenAssignment
  compatibleStateIds: string[]
  requiresRenderedValidation: true
} {
  const assignment = createQwenAssignmentSchema(ctx).parse(raw) as QwenAssignment
  const issues: string[] = []
  const assignmentCounts = new Map<string, number>()

  for (const a of assignment.assignments) assignmentCounts.set(a.blockId, (assignmentCounts.get(a.blockId) ?? 0) + 1)
  for (const b of ctx.blocks) {
    if ((assignmentCounts.get(b.id) ?? 0) !== 1) issues.push(`block-assignment-count:${b.id}:${assignmentCounts.get(b.id) ?? 0}`)
  }
  if (assignment.assignments.length !== ctx.blocks.length) issues.push('all-normalized-blocks-must-be-assigned-once')
  if (issues.length) throw new RecipeAssignmentError(issues)

  const compatibleStateIds: string[] = []
  const rejected: string[] = []

  for (const state of states.filter(s => s.modeId === assignment.modeId)) {
    const problems: string[] = []
    const assignmentByRegion = new Map<string, typeof assignment.assignments>()
    for (const a of assignment.assignments) {
      const arr = assignmentByRegion.get(a.regionId) ?? []
      arr.push(a)
      assignmentByRegion.set(a.regionId, arr)
    }

    for (const regionSpec of state.regions) {
      const items = assignmentByRegion.get(regionSpec.id) ?? []
      const p = regionSpec.content
      if (items.length < p.minItems || items.length > p.maxItems || (p.required && !items.length)) {
        problems.push(`region-count:${regionSpec.id}:${items.length}`)
      }
      if (items.filter(a => a.emphasis === 'primary').length > p.emphasis.maxPrimaryItems) {
        problems.push(`too-many-primary-items:${regionSpec.id}`)
      }
      if (p.group && items.length) {
        const layout = p.group.allowedLayouts.find(l => l.id === p.group!.preferredLayoutId)
        if (!layout || items.length < layout.minItems || items.length > layout.maxItems) problems.push(`fixed-group-layout-count:${regionSpec.id}`)
      }
    }

    for (const a of assignment.assignments) {
      const block = ctx.blocks.find(b => b.id === a.blockId)!
      const r = state.regions.find(x => x.id === a.regionId)
      if (!r) { problems.push(`unknown-region:${a.regionId}`); continue }
      if (!block.allowedRoles.includes(r.content.role)) problems.push(`semantic-role-not-allowed:${block.id}:${r.content.role}`)
      if (!r.content.accepts.includes(block.type)) problems.push(`block-type-not-allowed:${block.id}:${a.regionId}:${block.type}`)
      if (!r.content.emphasis.allowed.includes(a.emphasis)) problems.push(`emphasis-not-allowed:${block.id}:${a.regionId}`)

      const contract = semanticBlockContracts[block.type]
      const measured = ctx.componentVariants.filter(v =>
        v.blockId === block.id && v.stateIds.includes(state.id) && v.regionIds.includes(r.id))
      const render = a.render

      if (render.kind === 'component') {
        if (r.content.componentPriority === 'asset-only' || !contract.componentQuery || !measured.some(v => v.id === render.variantId && v.emphasis === a.emphasis)) {
          problems.push(`component-not-measured-for-block:${block.id}:${r.id}`)
        }
      } else if (render.kind === 'asset') {
        if (block.type !== 'visual' || r.content.componentPriority !== 'asset-only' || !r.content.visualFit) {
          problems.push(`asset-not-allowed:${block.id}:${r.id}`)
        } else if (!ctx.visualAssets.some(v => v.blockId === block.id)) {
          problems.push(`visual-asset-missing:${block.id}`)
        }
      } else {
        if (block.type === 'visual' || r.content.componentPriority === 'asset-only') problems.push(`visual-must-use-asset:${block.id}`)
        const needsComponentEvidence = r.content.componentPriority === 'component-first'
        if (needsComponentEvidence) {
          if (!render.reason) problems.push(`fallback-reason-required:${block.id}`)
          if (measured.length) problems.push(`compatible-component-must-be-used:${block.id}`)
          if (!ctx.fallbackEvidence.some(e =>
            e.blockId === block.id && e.stateIds.includes(state.id) && e.regionIds.includes(r.id) && e.emphasis === a.emphasis && e.reason === render.reason)) {
            problems.push(`fallback-not-supported-by-executor:${block.id}`)
          }
        } else if (render.reason !== null) {
          problems.push(`direct-primitive-must-have-null-reason:${block.id}`)
        }
        if (!contract.primitiveLayouts.length) problems.push(`no-primitive-layout-contract:${block.id}`)
      }
    }

    if (problems.length) rejected.push(...problems.map(p => `${state.id}:${p}`))
    else compatibleStateIds.push(state.id)
  }

  if (!compatibleStateIds.length) throw new RecipeAssignmentError(['no-compatible-state', ...rejected])
  return { assignment, compatibleStateIds, requiresRenderedValidation: true }
}

// ============================================================================
// BOUND RENDER PLANS — no model-authored fields or geometry.
// ============================================================================

export type BoundInternalNode = Omit<InternalNodeSpec, 'kind' | 'children' | 'item'> & {
  kind: 'field' | 'group'
  templateId: string
  minWidth: 0
  sourceRefs?: readonly string[]
  measureWidth?: 'available' | 'intrinsic'
  heightMode?: 'fill' | 'hug'
  children?: BoundInternalNode[]
  repeatScope?: string
  repeatIndex?: number
  decorations?: InternalDecoration[]
  decorationMargins?: Insets
}

export type BoundBlockPlan = {
  blockId: string
  regionId: string
  emphasis: Emphasis
  sequenceIndex: number
  sourceRefs: readonly string[]
  content:
    | { kind: 'component'; variantId: string; componentId: string }
    | { kind: 'asset'; assetId: string; sourceRef: string; visualType: VisualType; fit: 'cover' | 'contain' }
    | { kind: 'primitive'; layoutId: string; root: BoundInternalNode }
}

export function eligiblePrimitiveLayouts(block: NormalizedBlock): readonly PrimitiveLayoutVariant[] {
  const contract = semanticBlockContracts[block.type]
  if (!contract) throw new Error(`Unknown block type: ${block.type}`)
  const count = Object.values(block.fields).filter(isStructuredList).reduce((n, items) => n + items.length, 0)
  return contract.primitiveLayouts.filter(l =>
    (l.minStructuredItems === undefined || count >= l.minStructuredItems) &&
    (l.maxStructuredItems === undefined || count <= l.maxStructuredItems))
}

const boundNodes = (root: BoundInternalNode): BoundInternalNode[] => [root, ...(root.children?.flatMap(boundNodes) ?? [])]

function bindPrimitiveLayout(block: NormalizedBlock, region: RegionSpec, layout: PrimitiveLayoutVariant): BoundInternalNode {
  const bind = (
    spec: InternalNodeSpec, values: NormalizedBlock['fields'], prefix: string,
    parentDirection: Direction = 'column', repeatScope?: string, repeatIndex?: number,
  ): BoundInternalNode | null => {
    const { children, item, kind, ...props } = structuredClone(spec)
    const id = `${prefix}/${spec.id}`
    const base = { ...props, id, templateId: spec.id, minWidth: 0 as const, repeatScope, repeatIndex }
    if (kind === 'field') {
      const value = values[spec.fieldPath ?? '']
      if (value === undefined) return null
      if (!isFieldBinding(value)) throw new Error(`Field binding expected: ${id}`)
      return { ...base, kind: 'field', sourceRefs: [...value.sourceRefs],
        measureWidth: parentDirection === 'row' && !spec.flex?.grow ? 'intrinsic' : 'available',
        typographyRole: (block.type === 'text' || block.type === 'label') && region.content.primitiveTypographyRole
          ? region.content.primitiveTypographyRole : spec.typographyRole }
    }
    if (kind === 'repeat') {
      const items = values[spec.fieldPath ?? '']
      if (!isStructuredList(items) || !item || items.length < (spec.minItems ?? 0) || items.length > (spec.maxItems ?? Infinity)) {
        throw new Error(`Incompatible repeated content: ${id}`)
      }
      return { ...base, kind: 'group', heightMode: 'hug', children: items.map((value, index) => {
        const node = bind(item, value.fields, `${id}/${index}`, spec.direction ?? 'column', id, index)
        if (!node) throw new Error(`Empty repeated item: ${id}/${index}`)
        // A declared row divides the available width between its columns. This
        // prevents long body text from imposing an intrinsic overflowing width.
        if (spec.direction === 'row' && !node.flex) node.flex = { grow: 1, shrink: 1, basis: 0 }
        return node
      }) }
    }
    const bound = (children ?? []).map(c => bind(c, values, id, spec.direction ?? 'column', repeatScope, repeatIndex))
      .filter((n): n is BoundInternalNode => n !== null)
    if (!bound.length) return null
    return { ...base, kind: 'group', heightMode: spec.flex?.grow ? 'fill' : 'hug', children: bound,
      justify: bound.length === 1 ? 'start' : spec.justify }
  }
  const root = bind(layout.root, block.fields, `${block.id}/${layout.id}`)
  if (!root) throw new Error(`Empty primitive: ${block.id}`)
  root.heightMode = 'fill'
  const nodes = boundNodes(root)
  for (const decoration of layout.decorations ?? []) {
    const owners = nodes.filter(n => n.templateId === decoration.ownerNodeId)
    if (decoration.repeatPolicy === 'once' && owners.length > 1) throw new Error(`Ambiguous decoration owner: ${decoration.id}`)
    for (const owner of owners) {
      const peers = owners.filter(n => n.repeatScope === owner.repeatScope)
      const first = Math.min(...peers.map(n => n.repeatIndex ?? 0)), last = Math.max(...peers.map(n => n.repeatIndex ?? 0))
      if (decoration.repeatPolicy === 'first-repeat-item' && owner.repeatIndex !== first) continue
      if (decoration.repeatPolicy === 'last-repeat-item' && owner.repeatIndex !== last) continue
      owner.decorations = [...(owner.decorations ?? []), { ...structuredClone(decoration), id: `${owner.id}/${decoration.id}`, ownerNodeId: owner.id }]
      const reserve = decoration.preferredThicknessPx + decoration.reserveInsetPx
      if (decoration.placement === 'inside-edge') {
        owner.padding = { ...ZERO, ...owner.padding, [decoration.edge]: Math.max(owner.padding?.[decoration.edge] ?? 0, reserve) }
      } else {
        owner.decorationMargins = { ...ZERO, ...owner.decorationMargins,
          [decoration.edge]: Math.max(owner.decorationMargins?.[decoration.edge] ?? 0, reserve) }
      }
    }
  }
  const actual = nodes.flatMap(n => n.sourceRefs ?? []).sort(), expected = [...block.sourceRefs].sort()
  if (actual.length !== expected.length || actual.some((ref, i) => ref !== expected[i])) throw new Error(`Primitive loses or repeats content: ${block.id}`)
  return root
}

/** Validate the complete model answer before building any output. Layout choices
 * are executor-owned results of measured fit, not extra Qwen freedom. If omitted,
 * choose the first declared variant compatible with the immutable item count.
 * Re-run measurement/overflow/collision validation using the actual DS and final
 * sizes; this function does not claim rendered fit. */
export function createStateRenderPlan(
  stateId: string, raw: unknown, ctx: QwenSchemaContext,
  primitiveChoices: Readonly<Record<string, string>> = {},
): { state: ResolvedState; regions: { regionId: string; blocks: BoundBlockPlan[] }[]; requiresRenderedValidation: true } {
  const verified = validateQwenAssignment(raw, ctx)
  if (!verified.compatibleStateIds.includes(stateId)) throw new Error(`Assignment is incompatible with state: ${stateId}`)
  const state = resolvePresentState(states.find(s => s.id === stateId)!, verified.assignment.assignments.map(a => a.regionId))
  for (const blockId of Object.keys(primitiveChoices)) {
    if (!verified.assignment.assignments.some(a => a.blockId === blockId && a.render.kind === 'primitive')) throw new Error(`Unused primitive choice: ${blockId}`)
  }
  const regions = state.regions.map(region => ({ regionId: region.id, blocks: verified.assignment.assignments
    .filter(a => a.regionId === region.id)
    .sort((a, b) => ctx.blocks.find(n => n.id === a.blockId)!.sequenceIndex - ctx.blocks.find(n => n.id === b.blockId)!.sequenceIndex)
    .map(a => {
      const block = ctx.blocks.find(b => b.id === a.blockId)!
      let content: BoundBlockPlan['content']
      if (a.render.kind === 'component') {
        const render = a.render, v = ctx.componentVariants.find(v => v.id === render.variantId)!
        content = { kind: 'component', componentId: v.componentId, variantId: v.id }
      } else if (a.render.kind === 'asset') {
        const asset = ctx.visualAssets.find(v => v.blockId === block.id)!
        content = { kind: 'asset', assetId: asset.assetId, sourceRef: asset.sourceRef, visualType: asset.visualType,
          fit: region.content.visualFit![asset.visualType] }
      } else {
        const eligible = eligiblePrimitiveLayouts(block), choice = primitiveChoices[block.id]
        const layout = choice === undefined ? eligible[0] : eligible.find(l => l.id === choice)
        if (!layout) throw new Error(`Incompatible primitive layout: ${block.id}:${choice ?? 'default'}`)
        content = { kind: 'primitive', layoutId: layout.id, root: bindPrimitiveLayout(block, region, layout) }
      }
      return { blockId: block.id, regionId: region.id, emphasis: a.emphasis, sequenceIndex: block.sequenceIndex,
        sourceRefs: [...block.sourceRefs], content }
    }) }))
  return { state, regions, requiresRenderedValidation: true }
}

// ============================================================================
// GENERIC HIERARCHICAL PRESENCE RESOLUTION
// No state-specific tag/footer hacks. Structural groups determine occupancy.
// ============================================================================

export type ResolvedState = AuthoredState

export function resolvePresentState(state: AuthoredState, presentRegionIds: readonly string[]): ResolvedState {
  const present = new Set(presentRegionIds)
  const regionIds = new Set(state.regions.map(r => r.id))
  if ([...present].some(id => !regionIds.has(id))) throw new Error('Unknown present region')
  if (state.regions.some(r => r.content.required && !present.has(r.id))) throw new Error('Required region is absent')

  const result = structuredClone(state)
  result.regions = result.regions.filter(r => present.has(r.id))

  const keptDecorationIds = new Set(
    result.decorations
      .filter(d => d.onlyWhenRegionsPresent.every(id => present.has(id)))
      .map(d => d.id),
  )
  result.decorations = result.decorations.filter(d => keptDecorationIds.has(d.id))

  const groups = new Map(result.groups.map(g => [g.id, g]))
  const keepGroup = new Map<string, boolean>()
  const visiting = new Set<string>()

  const prune = (groupId: string): boolean => {
    if (keepGroup.has(groupId)) return keepGroup.get(groupId)!
    if (visiting.has(groupId)) throw new Error(`Group cycle:${groupId}`)
    visiting.add(groupId)
    const g = groups.get(groupId)
    if (!g) throw new Error(`Unknown group:${groupId}`)
    g.children = g.children.filter(child => {
      if (child.kind === 'region') return present.has(child.id)
      if (child.kind === 'decoration') return keptDecorationIds.has(child.id)
      return prune(child.id)
    })
    visiting.delete(groupId)
    const keep = g.id === result.rootGroupId || g.children.length > 0 || !g.collapseEmpty
    keepGroup.set(groupId, keep)
    return keep
  }

  prune(result.rootGroupId)
  result.groups = result.groups.filter(g => keepGroup.get(g.id) === true)

  // A decoration's owner group must survive; otherwise the decoration disappears.
  const liveGroupIds = new Set(result.groups.map(g => g.id))
  result.decorations = result.decorations.filter(d => liveGroupIds.has(d.ownerGroupId))
  const liveDecorations = new Set(result.decorations.map(d => d.id))
  for (const g of result.groups) g.children = g.children.filter(c => c.kind !== 'decoration' || liveDecorations.has(c.id))

  return result
}

// ============================================================================
// RECIPE DEFINITION VALIDATION
// ============================================================================

export function validateRecipeDefinition(
  definitions: readonly AuthoredState[] = states,
  contracts: Readonly<Record<SemanticBlockType, SemanticBlockContract>> = semanticBlockContracts,
): string[] {
  const issues: string[] = []
  if (definitions.length !== SOURCE_FRAMES.length) issues.push('state-count-must-match-source-frame-count')
  if (new Set(definitions.map(s => s.sourceFrame)).size !== definitions.length) issues.push('duplicate-source-frame')
  if (new Set(definitions.map(s => s.id)).size !== definitions.length) issues.push('duplicate-state-id')
  const validRange = (r: Range) => [r.min, r.preferred, r.max].every(Number.isFinite) && r.min >= 0 && r.min <= r.preferred && r.preferred <= r.max

  for (const s of definitions) {
    if (!SOURCE_FRAMES.includes(s.sourceFrame)) issues.push(`${s.id}:unknown-source-frame`)
    const regionIds = new Set(s.regions.map(r => r.id))
    const groupIds = new Set(s.groups.map(g => g.id))
    const decorationIds = new Set(s.decorations.map(d => d.id))
    if (regionIds.size !== s.regions.length) issues.push(`${s.id}:duplicate-region-id`)
    if (groupIds.size !== s.groups.length) issues.push(`${s.id}:duplicate-group-id`)
    if (decorationIds.size !== s.decorations.length) issues.push(`${s.id}:duplicate-decoration-id`)
    if (!groupIds.has(s.rootGroupId)) issues.push(`${s.id}:missing-root-group`)

    for (const r of s.regions) {
      for (const dim of [r.size.width, r.size.height]) {
        if (!(dim.min <= dim.preferred && dim.preferred <= dim.max)) issues.push(`${s.id}:${r.id}:invalid-range`)
      }
      // Structured main regions deliberately exclude generic text; this is a
      // second guard against semantic downgrading in addition to locked block type.
      if (['steps', 'comparison-left', 'comparison-right', 'theses', 'fact', 'explanations', 'article', 'feature', 'metrics'].includes(r.id) &&
          r.content.accepts.includes('text')) issues.push(`${s.id}:${r.id}:structured-region-accepts-generic-text`)
    }

    for (const d of s.decorations) {
      if (!groupIds.has(d.ownerGroupId)) issues.push(`${s.id}:${d.id}:unknown-decoration-owner`)
      if (!regionIds.has(d.regionId)) issues.push(`${s.id}:${d.id}:unknown-decoration-region`)
      if (d.onlyWhenRegionsPresent.some(id => !regionIds.has(id))) issues.push(`${s.id}:${d.id}:unknown-decoration-presence-region`)
    }

    for (const g of s.groups) {
      if (![g.size.width, g.size.height, g.gapX, g.gapY].every(validRange)) issues.push(`${s.id}:${g.id}:invalid-group-range`)
      if (Object.values(g.padding).some(v => !Number.isFinite(v) || v < 0)) issues.push(`${s.id}:${g.id}:invalid-group-padding`)
      for (const child of g.children) {
        if (child.kind === 'region' && !regionIds.has(child.id)) issues.push(`${s.id}:${g.id}:unknown-region-child:${child.id}`)
        if (child.kind === 'group' && !groupIds.has(child.id)) issues.push(`${s.id}:${g.id}:unknown-group-child:${child.id}`)
        if (child.kind === 'decoration' && !decorationIds.has(child.id)) issues.push(`${s.id}:${g.id}:unknown-decoration-child:${child.id}`)
      }
    }

    const parents = new Map<string, number>()
    for (const g of s.groups) for (const child of g.children) {
      const key = `${child.kind}:${child.id}`
      parents.set(key, (parents.get(key) ?? 0) + 1)
    }
    for (const [kind, ids] of [['region', regionIds], ['group', groupIds], ['decoration', decorationIds]] as const) for (const id of ids) {
      const expected = kind === 'group' && id === s.rootGroupId ? 0 : 1
      if ((parents.get(`${kind}:${id}`) ?? 0) !== expected) issues.push(`${s.id}:${kind}:${id}:invalid-parent-count`)
    }
    const reached = new Set<string>(), visiting = new Set<string>()
    const visit = (id: string) => {
      if (visiting.has(id)) { issues.push(`${s.id}:group-cycle:${id}`); return }
      if (reached.has(id)) return
      reached.add(id); visiting.add(id)
      for (const child of s.groups.find(g => g.id === id)?.children ?? []) if (child.kind === 'group') visit(child.id)
      visiting.delete(id)
    }
    visit(s.rootGroupId)
    for (const id of groupIds) if (!reached.has(id)) issues.push(`${s.id}:unreachable-group:${id}`)
    for (const d of s.decorations) {
      const owner = s.groups.find(g => g.id === d.ownerGroupId)
      const index = owner?.children.findIndex(c => c.kind === 'decoration' && c.id === d.id) ?? -1
      const reference = owner?.children.findIndex(c => c.kind === 'region' && c.id === d.regionId) ?? -1
      if (index < 0 || reference < 0 || index !== reference + (d.placement === 'flow-after-region' ? 1 : -1)) issues.push(`${s.id}:${d.id}:invalid-decoration-flow-position`)
    }
  }

  for (const contract of Object.values(contracts)) for (const layout of contract.primitiveLayouts) {
    const nodes = new Map<string, { spec: InternalNodeSpec; repeated: boolean }>()
    const bound = new Map<string, number>()
    const inspect = (n: InternalNodeSpec, fields: Readonly<Record<string, FieldContract>>, prefix: string, repeated: boolean) => {
      if (!n.id || nodes.has(n.id)) issues.push(`${contract.type}:${layout.id}:duplicate-internal-id:${n.id}`)
      nodes.set(n.id, { spec: n, repeated })
      if (n.kind === 'field' || n.kind === 'repeat') {
        const field = fields[n.fieldPath ?? ''], key = `${prefix}${n.fieldPath}`
        if (!field || field.kind !== (n.kind === 'field' ? 'single' : 'structured-list')) issues.push(`${contract.type}:${layout.id}:invalid-field-path:${key}`)
        if (n.kind === 'field') {
          bound.set(key, (bound.get(key) ?? 0) + 1)
          if (!n.typographyRole) issues.push(`${contract.type}:${layout.id}:missing-typography-role:${n.id}`)
        } else if (field?.kind === 'structured-list' && n.item) {
          if (n.minItems === undefined || n.maxItems === undefined || n.minItems < field.minItems || n.maxItems > field.maxItems || n.minItems > n.maxItems) issues.push(`${contract.type}:${layout.id}:invalid-repeat-range:${n.id}`)
          const itemFields = Object.fromEntries(Object.entries(field.itemFields).map(([key, rule]) => [key, { kind: 'single' as const, required: rule.required }]))
          inspect(n.item, itemFields, `${key}[].`, true)
        } else issues.push(`${contract.type}:${layout.id}:missing-repeat-template:${n.id}`)
      } else if (n.kind === 'group') {
        if (!n.children?.length || !n.direction) issues.push(`${contract.type}:${layout.id}:empty-internal-group:${n.id}`)
        for (const child of n.children ?? []) inspect(child, fields, prefix, repeated)
      }
      for (const r of [n.gap, n.gapX, n.gapY]) if (r && !validRange(r)) issues.push(`${contract.type}:${layout.id}:invalid-internal-gap:${n.id}`)
    }
    inspect(layout.root, contract.fields, '', false)
    for (const [field, rule] of Object.entries(contract.fields)) {
      const paths = rule.kind === 'single' ? [field] : Object.keys(rule.itemFields).map(f => `${field}[].${f}`)
      for (const path of paths) if (bound.get(path) !== 1) issues.push(`${contract.type}:${layout.id}:field-coverage:${path}`)
    }
    for (const d of layout.decorations ?? []) {
      const owner = nodes.get(d.ownerNodeId)
      if (!owner) issues.push(`${contract.type}:${layout.id}:unknown-internal-decoration-owner:${d.id}`)
      else if (owner.repeated !== (d.repeatPolicy !== 'once')) issues.push(`${contract.type}:${layout.id}:invalid-decoration-repeat-policy:${d.id}`)
      if (!Number.isFinite(d.preferredThicknessPx) || d.preferredThicknessPx <= 0 || !Number.isFinite(d.reserveInsetPx) || d.reserveInsetPx < 0) issues.push(`${contract.type}:${layout.id}:invalid-decoration-inset:${d.id}`)
    }
  }
  for (const m of recipe.modes) {
    for (const stateId of m.states) if (!definitions.some(s => s.id === stateId && s.modeId === m.id)) issues.push(`mode-state-mismatch:${m.id}:${stateId}`)
  }
  return issues
}

export const RECIPE_DEFINITION_ISSUES = validateRecipeDefinition()
if (RECIPE_DEFINITION_ISSUES.length) throw new Error(`Invalid recipe definition:\n${RECIPE_DEFINITION_ISSUES.join('\n')}`)

export type FinalRecipe = typeof recipe
