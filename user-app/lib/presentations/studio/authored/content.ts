import { z } from 'zod'

// ============================================================================
// ADAPTIVE RECIPE CONTRACT v4 — FIGMA SECTION 19:209
// 12 authored frames, content-agnostic, design-system-driven.
// Figma provides composition/geometry only. Runtime content comes from immutable
// input fragments; components, typography and colors come from the active MSP DS.
// Includes semantic validation, internal flex plans, attached decoration and
// presence resolution. Reference rectangles are evidence, not CSS coordinates.
// The MSP adapter must still implement flex layout, font/asset loading, component
// measurements and final rendered-geometry validation. It is not a renderer.
// ============================================================================

export const RECIPE_ID = 'section-19-209-content-v4' as const
export const SOURCE_SECTION = '19:209' as const

export type Rect = { x: number; y: number; w: number; h: number }
export type Range = { min: number; preferred: number; max: number }
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type Axis = 'x' | 'y'
export type Strength = 'hard' | 'soft'
export type Emphasis = 'primary' | 'secondary'
export type Align = 'start' | 'center' | 'end' | 'stretch'

export type TypographyRole =
  | 'display'
  | 'title'
  | 'lead'
  | 'support'
  | 'body'
  | 'metadata'
  | 'caption'
  | 'footer'
  | 'page'
  | 'metric-value'
  | 'metric-unit'
  | 'metric-caption'
  | 'quote'
  | 'quote-author'
  | 'marker'
  | 'column-heading'

export type SemanticBlockType =
  | 'text'
  | 'label'
  | 'metric'
  | 'fact'
  | 'quote'
  | 'list'
  | 'column-item'
  | 'visual'

export type VisualType = 'photo' | 'illustration' | 'diagram' | 'abstract-graphic'

export type SemanticRole =
  | 'title'
  | 'lead'
  | 'comment'
  | 'context'
  | 'year'
  | 'format'
  | 'tag'
  | 'body'
  | 'fact'
  | 'metric'
  | 'quote'
  | 'footer'
  | 'page'
  | 'visual'

export type EdgeRef = {
  region: '$canvas' | string
  edge: Edge
  offset?: number
}

export type Anchor = {
  edge: Edge
  to: '$canvas'
  offset: number
  strength: Strength
}

export type LayoutRelation =
  | {
      id: string
      kind: 'gap'
      axis: Axis
      from: EdgeRef
      to: EdgeRef
      gap: Range
      strength: Strength
    }
  | {
      id: string
      kind: 'align'
      axis: Axis
      from: EdgeRef
      to: EdgeRef
      offset: number
      strength: Strength
    }

export type ElasticGap = {
  id: string
  axis: Axis
  from: EdgeRef
  to: EdgeRef
  range: Range
  shrinkPriority: number
  growPriority: number
}

export type RegionSize = {
  width: Range
  height: Range
}

export type RegionFlex = {
  width?: { growPriority: number; shrinkPriority: number }
  height?: { growPriority: number; shrinkPriority: number }
}

export type TextPolicy = {
  typographyRole: TypographyRole
  fontStepPx: 4
  minScale: 0.7
  maxScale: 1.3
  lineHeight: 'design-system-coupled'
  adaptationPhase: 'last-resort'
}

export type ComponentQuery = {
  semanticRole: SemanticBlockType | SemanticRole
  requiredFields: string[]
  allowedLayouts: string[]
  designSystem: 'active'
}

export type PrimitiveFallback = {
  kind: 'semantic-primitive'
  reasonRequired: true
  allowedReasons: readonly [
    'no-compatible-component',
    'component-does-not-fit',
    'component-field-contract-mismatch',
  ]
  /** Semantic defaults. A state's explicit primitive-layout slot takes precedence. */
  fieldTypography: Record<string, TypographyRole>
}

export type SemanticBlockContract = {
  type: SemanticBlockType
  fields: Record<string, { required: boolean }>
  componentQuery: ComponentQuery | null
  primitiveFallback: PrimitiveFallback | null
}

export type GroupLayout = {
  id: string
  direction: 'row' | 'column' | 'mosaic'
  columns: number
  minItems: number
  maxItems: number
  gapX: Range
  gapY: Range
  referenceItems?: Rect[]
  trailingSpace?: Range
}

/** A renderer measures fields using the active DS. Reference boxes describe the
 * authored hierarchy; they never fix a text height or permit absolute positioning.
 * Empty optional fields/stacks disappear before gaps are allocated. */
export type FlexNode =
  | {
      kind: 'field'
      id: string
      field: string
      typographyRole: TypographyRole
      sourceRefs?: readonly string[]
      flow: 'text' | 'list-items-in-source-order'
      referenceRect?: Rect
      /** Fraction of available inner width after outer decoration/insets. */
      widthFraction?: number
    }
  | {
      kind: 'stack'
      id: string
      direction: 'column'
      height: 'fill' | 'hug'
      justify: 'start' | 'space-between'
      align: 'start' | 'end' | 'stretch'
      gap: Range
      children: FlexNode[]
    }
  | { kind: 'component'; id: string; variantId: string }
  | { kind: 'asset'; id: string; assetRef: string; fit: 'cover' | 'contain' }
  | { kind: 'decoration'; id: string; decorationId: string; width: 'fill' | number; height: number }

export type PrimitiveLayout = {
  id: string
  root: FlexNode
  fieldSizing: 'measured-active-ds-text'
  overflow: 'reject-and-relayout'
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
  accepts: SemanticBlockType[]
  componentPriority: 'component-first' | 'primitive-first'
  textPolicy?: TextPolicy
  primitiveTypographyRole?: TypographyRole
  group?: {
    qwenMayChooseLayout: boolean
    allowedLayouts: GroupLayout[]
    preferredLayoutId: string
  }
  visualFit?: VisualFitPolicy
  primitiveLayouts?: Partial<Record<SemanticBlockType, PrimitiveLayout>>
  emphasis: {
    allowed: readonly Emphasis[]
    preferred: Emphasis
    maxPrimaryItems: number
  }
}

export type RegionSpec = {
  id: string
  preferredRect: Rect
  size: RegionSize
  anchors: Anchor[]
  flex?: RegionFlex
  alignX?: Align
  alignY?: Align
  content: RegionContent
}

export type DecorationSpec = {
  id: string
  /** Figma reference only. Render from attachment/flow, never these coordinates. */
  preferredRect: Rect
  attachment:
    | {
        kind: 'prefix'
        regionId: string
        slotId: string | null
        item: number | 'each' | null
        appliesTo: 'primitive' | 'any'
        distribution: 'start' | 'space-between'
        gapAfter: Range
        width: 'fill' | number
        height: number
      }
    | {
        kind: 'between-regions'
        fromRegionId: string
        toRegionId: string
        insetStart: number
        insetEnd: number
        height: number
      }
    | {
        kind: 'sidecar'
        regionId: string
        side: 'left'
        gap: number
        size: { w: number; h: number }
        reserveInParentFlow: true
      }
  componentQuery: {
    semanticRole: string
    designSystem: 'active'
  }
  whenAllRegionsPresent?: string[]
}

export type CountRule = number | { min: number; max: number }
export type StateSignature = Partial<Record<SemanticRole, CountRule>>

export type AuthoredState = {
  id: string
  modeId: ModeId
  sourceFrame: SourceFrameId
  densityRank: number
  signature: StateSignature
  regions: RegionSpec[]
  relations: LayoutRelation[]
  elasticGaps: ElasticGap[]
  decorations?: DecorationSpec[]
  notes?: string[]
}

export const SOURCE_FRAMES = [
  '6:187',
  '13:2',
  '13:24',
  '13:46',
  '13:68',
  '13:90',
  '21:364',
  '21:392',
  '21:412',
  '21:493',
  '21:465',
  '21:433',
] as const

export type SourceFrameId = (typeof SOURCE_FRAMES)[number]

export const MODE_IDS = [
  'intro',
  'intro-reverse',
  'split-intro',
  'three-intro',
  'fact-visual',
  'long-thesis',
  'quote',
  'photo-note',
  'metric-visual',
  'text-columns',
] as const

export type ModeId = (typeof MODE_IDS)[number]

const CANVAS = { width: 1920, height: 1080 } as const
const SAFE = { left: 46, right: 46, top: 44, bottom: 34 } as const
const CONTENT = { x: 46, y: 122, w: 1828, h: 866 } as const
const INITIAL_SCALE_SAMPLES = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3] as const

const snap4 = (n: number) => Math.round(n / 4) * 4
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

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

/** Fit an adapted dimension to the complete 4px grid, not just the initial 10% samples. */
export function fitDimension(requested: number, bounds: Range): number {
  if (![requested, bounds.min, bounds.max].every(Number.isFinite)) throw new Error('Non-finite dimension')
  const min = Math.ceil(bounds.min / 4) * 4
  const max = Math.floor(bounds.max / 4) * 4
  if (min > max) throw new Error('No feasible 4px dimension')
  return clamp(snap4(requested), min, max)
}

const size30 = (rect: Rect, caps?: { minW?: number; maxW?: number; minH?: number; maxH?: number }): RegionSize => ({
  width: scale30(rect.w, caps?.minW ?? 0, caps?.maxW ?? Number.POSITIVE_INFINITY),
  height: scale30(rect.h, caps?.minH ?? 0, caps?.maxH ?? Number.POSITIVE_INFINITY),
})

const fixed = (n: number): Range => ({ min: n, preferred: n, max: n })
const range = (min: number, preferred: number, max: number): Range => ({ min, preferred, max })

const left = (offset: number = SAFE.left): Anchor => ({ edge: 'left', to: '$canvas', offset, strength: 'hard' })
const right = (offset: number = SAFE.right): Anchor => ({ edge: 'right', to: '$canvas', offset, strength: 'hard' })
const top = (offset: number = SAFE.top, strength: Strength = 'hard'): Anchor => ({ edge: 'top', to: '$canvas', offset, strength })
const bottom = (offset: number = SAFE.bottom): Anchor => ({ edge: 'bottom', to: '$canvas', offset, strength: 'hard' })

const gap = (
  id: string,
  axis: Axis,
  from: EdgeRef,
  to: EdgeRef,
  g: Range,
  strength: Strength = 'hard',
): LayoutRelation => ({ id, kind: 'gap', axis, from, to, gap: g, strength })

const align = (
  id: string,
  axis: Axis,
  from: EdgeRef,
  to: EdgeRef,
  offset = 0,
  strength: Strength = 'hard',
): LayoutRelation => ({ id, kind: 'align', axis, from, to, offset, strength })

const elastic = (
  id: string,
  axis: Axis,
  from: EdgeRef,
  to: EdgeRef,
  r: Range,
  shrinkPriority: number,
  growPriority: number,
): ElasticGap => ({ id, axis, from, to, range: r, shrinkPriority, growPriority })

const ref = (region: string, edge: Edge): EdgeRef => ({ region, edge })

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

const emphasisPolicy = (role: SemanticRole): RegionContent['emphasis'] => {
  if (role === 'title' || role === 'fact' || role === 'metric' || role === 'quote') {
    return { allowed: ['primary'], preferred: 'primary', maxPrimaryItems: 1 }
  }
  if (role === 'lead' || role === 'body' || role === 'comment') {
    return { allowed: ['primary', 'secondary'], preferred: role === 'lead' ? 'primary' : 'secondary', maxPrimaryItems: 1 }
  }
  return { allowed: ['secondary'], preferred: 'secondary', maxPrimaryItems: 0 }
}

const plainTextRegion = (
  id: string,
  role: SemanticRole,
  rect: Rect,
  typographyRole: TypographyRole,
  required: boolean,
  anchors: Anchor[],
  accepts: SemanticBlockType[] = ['text'],
  caps?: { minW?: number; maxW?: number; minH?: number; maxH?: number },
  flex?: RegionFlex,
  alignX: Align = 'start',
  alignY: Align = 'start',
): RegionSpec => ({
  id,
  preferredRect: rect,
  size: size30(rect, caps),
  anchors,
  flex,
  alignX,
  alignY,
  content: {
    role,
    required,
    minItems: required ? 1 : 0,
    maxItems: 1,
    accepts,
    componentPriority: 'primitive-first',
    primitiveTypographyRole: typographyRole,
    textPolicy: textPolicy(typographyRole),
    emphasis: emphasisPolicy(role),
  },
})

const componentRegion = (
  id: string,
  role: SemanticRole,
  rect: Rect,
  required: boolean,
  accepts: SemanticBlockType[],
  fallbackTypographyRole: TypographyRole,
  anchors: Anchor[],
  flex?: RegionFlex,
  alignX: Align = 'start',
  alignY: Align = 'start',
): RegionSpec => ({
  id,
  preferredRect: rect,
  size: size30(rect),
  anchors,
  flex,
  alignX,
  alignY,
  content: {
    role,
    required,
    minItems: required ? 1 : 0,
    maxItems: 1,
    accepts,
    componentPriority: 'component-first',
    primitiveTypographyRole: fallbackTypographyRole,
    textPolicy: textPolicy(fallbackTypographyRole),
    emphasis: emphasisPolicy(role),
  },
})

const componentGroupRegion = (
  id: string,
  role: SemanticRole,
  rect: Rect,
  required: boolean,
  minItems: number,
  maxItems: number,
  accepts: SemanticBlockType[],
  layouts: GroupLayout[],
  preferredLayoutId: string,
  fallbackTypographyRole: TypographyRole,
  anchors: Anchor[],
  flex?: RegionFlex,
  qwenMayChooseLayout = true,
): RegionSpec => ({
  id,
  preferredRect: rect,
  size: size30(rect),
  anchors,
  flex,
  content: {
    role,
    required,
    minItems,
    maxItems,
    accepts,
    componentPriority: role === 'visual' ? 'primitive-first' : 'component-first',
    primitiveTypographyRole: fallbackTypographyRole,
    textPolicy: textPolicy(fallbackTypographyRole),
    emphasis: emphasisPolicy(role),
    visualFit: role === 'visual' ? visualFit : undefined,
    group: {
      qwenMayChooseLayout,
      allowedLayouts: layouts,
      preferredLayoutId,
    },
  },
})

const visualRegion = (
  id: string,
  rect: Rect,
  required: boolean,
  anchors: Anchor[],
  flex?: RegionFlex,
): RegionSpec => ({
  id,
  preferredRect: rect,
  size: size30(rect),
  anchors,
  flex,
  content: {
    role: 'visual',
    required,
    minItems: required ? 1 : 0,
    maxItems: 1,
    accepts: ['visual'],
    componentPriority: 'primitive-first',
    emphasis: emphasisPolicy('visual'),
    visualFit,
  },
})

const headerContext = (): RegionSpec =>
  plainTextRegion('context', 'context', { x: 46, y: 56.5, w: 197, h: 29 }, 'metadata', false, [left(46), top(56.5)], ['text', 'label'])

const headerYear = (): RegionSpec =>
  plainTextRegion('year', 'year', { x: 393, y: 56.5, w: 59, h: 29 }, 'metadata', false, [left(393), top(56.5)], ['text', 'label'])

const headerFormat = (rect: Rect = { x: 1539, y: 56.5, w: 335, h: 29 }): RegionSpec =>
  plainTextRegion('format', 'format', rect, 'metadata', false, [right(CANVAS.width - (rect.x + rect.w)), top(rect.y)], ['text', 'label'], undefined, undefined, 'end')

const tagRegion = (rect: Rect): RegionSpec =>
  componentRegion('tag', 'tag', rect, false, ['label', 'text'], 'metadata', [left(rect.x), top(rect.y)], { width: { growPriority: 4, shrinkPriority: 4 } })

const footerRegion = (label = 'footer'): RegionSpec =>
  plainTextRegion(label, 'footer', { x: 46, y: 1019, w: 530, h: 27 }, 'footer', false, [left(46), bottom(34)], ['text', 'label'])

const pageRegion = (rect: Rect = { x: 1809, y: 1019, w: 65, h: 27 }): RegionSpec =>
  plainTextRegion('page', 'page', rect, 'page', false, [right(CANVAS.width - (rect.x + rect.w)), bottom(34)], ['text', 'label'], undefined, undefined, 'end')

const headerLink = (): DecorationSpec => ({
  id: 'header-context-year-link',
  preferredRect: { x: 259, y: 70, w: 118, h: 2 },
  attachment: { kind: 'between-regions', fromRegionId: 'context', toRegionId: 'year', insetStart: 16, insetEnd: 16, height: 2 },
  componentQuery: { semanticRole: 'context-separator', designSystem: 'active' },
  whenAllRegionsPresent: ['context', 'year'],
})

const lineDecoration = (id: string, rect: Rect, whenAllRegionsPresent?: string[]): DecorationSpec => ({
  id,
  preferredRect: rect,
  attachment: {
    kind: 'prefix',
    regionId: whenAllRegionsPresent?.[0] ?? 'comment',
    slotId: id === 'fact-separator' ? 'caption-group' : null,
    item: id.startsWith('body-column-') ? Number(id.split('-')[2]) - 1 : null,
    appliesTo: id === 'fact-separator' ? 'primitive' : 'any',
    distribution: 'start',
    gapAfter: fixed(16),
    width: 'fill',
    height: 2,
  },
  componentQuery: { semanticRole: 'editorial-separator', designSystem: 'active' },
  whenAllRegionsPresent,
})

const quoteMarkDecoration = (): DecorationSpec => ({
  id: 'quote-mark',
  preferredRect: { x: 46, y: 199, w: 230, h: 217 },
  attachment: { kind: 'sidecar', regionId: 'quote', side: 'left', gap: 56, size: { w: 230, h: 217 }, reserveInParentFlow: true },
  componentQuery: { semanticRole: 'quote-mark', designSystem: 'active' },
  whenAllRegionsPresent: ['quote'],
})

const verticalAccentDecoration = (): DecorationSpec => ({
  id: 'quote-context-accent',
  preferredRect: { x: 1458, y: 199, w: 4, h: 210 },
  attachment: { kind: 'prefix', regionId: 'comment', slotId: null, item: null, appliesTo: 'any', distribution: 'space-between', gapAfter: fixed(16), width: 4, height: 210 },
  componentQuery: { semanticRole: 'editorial-vertical-accent', designSystem: 'active' },
  whenAllRegionsPresent: ['comment'],
})

const commonChrome = (formatRect?: Rect, pageRect?: Rect, tagRect?: Rect): RegionSpec[] => [
  headerContext(),
  headerYear(),
  headerFormat(formatRect),
  ...(tagRect ? [tagRegion(tagRect)] : []),
  footerRegion(),
  pageRegion(pageRect),
]

const commonDecorations = (): DecorationSpec[] => [headerLink()]

// ============================================================================
// SEMANTIC BLOCK CONTRACTS — no concrete content is stored here.
// ============================================================================

export const semanticBlockContracts: Record<SemanticBlockType, SemanticBlockContract> = {
  text: {
    type: 'text',
    fields: { text: { required: true } },
    componentQuery: null,
    primitiveFallback: null,
  },
  label: {
    type: 'label',
    fields: { text: { required: true } },
    componentQuery: {
      semanticRole: 'label',
      requiredFields: ['text'],
      allowedLayouts: ['inline', 'pill', 'chip'],
      designSystem: 'active',
    },
    primitiveFallback: {
      kind: 'semantic-primitive',
      reasonRequired: true,
      allowedReasons: [
        'no-compatible-component',
        'component-does-not-fit',
        'component-field-contract-mismatch',
      ],
      fieldTypography: { text: 'metadata' },
    },
  },
  metric: {
    type: 'metric',
    fields: {
      value: { required: true },
      unit: { required: false },
      caption: { required: true },
      note: { required: false },
    },
    componentQuery: {
      semanticRole: 'metric',
      requiredFields: ['value', 'caption'],
      allowedLayouts: ['vertical', 'horizontal', 'compact', 'editorial'],
      designSystem: 'active',
    },
    primitiveFallback: {
      kind: 'semantic-primitive',
      reasonRequired: true,
      allowedReasons: [
        'no-compatible-component',
        'component-does-not-fit',
        'component-field-contract-mismatch',
      ],
      fieldTypography: {
        value: 'metric-value',
        unit: 'metric-unit',
        caption: 'metric-caption',
        note: 'body',
      },
    },
  },
  fact: {
    type: 'fact',
    fields: {
      text: { required: true },
      caption: { required: false },
    },
    componentQuery: {
      semanticRole: 'fact',
      requiredFields: ['text'],
      allowedLayouts: ['panel', 'inline', 'compact', 'editorial'],
      designSystem: 'active',
    },
    primitiveFallback: {
      kind: 'semantic-primitive',
      reasonRequired: true,
      allowedReasons: [
        'no-compatible-component',
        'component-does-not-fit',
        'component-field-contract-mismatch',
      ],
      fieldTypography: { text: 'lead', caption: 'caption' },
    },
  },
  quote: {
    type: 'quote',
    fields: {
      quote: { required: true },
      author: { required: false },
      source: { required: false },
    },
    componentQuery: {
      semanticRole: 'quote',
      requiredFields: ['quote'],
      allowedLayouts: ['panel', 'editorial'],
      designSystem: 'active',
    },
    primitiveFallback: {
      kind: 'semantic-primitive',
      reasonRequired: true,
      allowedReasons: [
        'no-compatible-component',
        'component-does-not-fit',
        'component-field-contract-mismatch',
      ],
      fieldTypography: {
        quote: 'quote',
        author: 'quote-author',
        source: 'caption',
      },
    },
  },
  list: {
    type: 'list',
    fields: { items: { required: true } },
    componentQuery: {
      semanticRole: 'list',
      requiredFields: ['items'],
      allowedLayouts: ['vertical-list', 'compact-list'],
      designSystem: 'active',
    },
    primitiveFallback: {
      kind: 'semantic-primitive',
      reasonRequired: true,
      allowedReasons: [
        'no-compatible-component',
        'component-does-not-fit',
        'component-field-contract-mismatch',
      ],
      fieldTypography: { items: 'body' },
    },
  },
  'column-item': {
    type: 'column-item',
    fields: {
      marker: { required: true },
      heading: { required: true },
      body: { required: true },
    },
    componentQuery: {
      semanticRole: 'column-item',
      requiredFields: ['marker', 'heading', 'body'],
      allowedLayouts: ['editorial-column', 'stacked-column'],
      designSystem: 'active',
    },
    primitiveFallback: {
      kind: 'semantic-primitive',
      reasonRequired: true,
      allowedReasons: [
        'no-compatible-component',
        'component-does-not-fit',
        'component-field-contract-mismatch',
      ],
      fieldTypography: {
        marker: 'marker',
        heading: 'column-heading',
        body: 'body',
      },
    },
  },
  visual: {
    type: 'visual',
    fields: {
      assetRef: { required: true },
      visualType: { required: true },
    },
    componentQuery: null,
    primitiveFallback: null,
  },
}

// ============================================================================
// DECLARED GROUP LAYOUTS
// ============================================================================

const threeIntroLayout: GroupLayout = {
  id: 'three-intro-row-3',
  direction: 'row',
  columns: 3,
  minItems: 3,
  maxItems: 3,
  gapX: fixed(24),
  gapY: fixed(0),
  trailingSpace: range(28, 40, 52),
  referenceItems: [
    { x: 0, y: 0, w: 580, h: 298 },
    { x: 604, y: 0, w: 580, h: 154 },
    { x: 1208, y: 0, w: 580, h: 154 },
  ],
}

const textColumnLayouts: GroupLayout[] = [
  {
    id: 'text-columns-3',
    direction: 'row',
    columns: 3,
    minItems: 3,
    maxItems: 3,
    gapX: fixed(28),
    gapY: fixed(0),
    referenceItems: [
      { x: 0, y: 0, w: 590.6666870117188, h: 789 },
      { x: 618.6666870117188, y: 0, w: 590.6666259765625, h: 789 },
      { x: 1237.333251953125, y: 0, w: 590.6666259765625, h: 789 },
    ],
  },
  {
    id: 'text-columns-2',
    direction: 'row',
    columns: 2,
    minItems: 2,
    maxItems: 2,
    gapX: range(24, 28, 40),
    gapY: fixed(0),
    referenceItems: [
      { x: 0, y: 0, w: 900, h: 789 },
      { x: 928, y: 0, w: 900, h: 789 },
    ],
  },
  {
    id: 'text-columns-1',
    direction: 'column',
    columns: 1,
    minItems: 1,
    maxItems: 3,
    gapX: fixed(0),
    gapY: range(24, 32, 48),
  },
]

// ============================================================================
// COMPLETE 12-STATE RECIPE
// ============================================================================

const authoredStates: AuthoredState[] = [
  // 1 — 6:187 / intro, balanced title + lead + comment
  {
    id: 'intro-01',
    modeId: 'intro',
    sourceFrame: '6:187',
    densityRank: 1,
    signature: {
      title: 1, lead: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome(undefined, undefined, { x: 46, y: 122, w: 516, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 207, w: 1828, h: 232 }, 'title', true, [left(), right()], ['text'], undefined,
        { height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('lead', 'lead', { x: 46, y: 820, w: 1056, h: 168 }, true, ['text', 'fact', 'metric'], 'lead', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
      componentRegion('comment', 'comment', { x: 1126, y: 834, w: 593, h: 154 }, true, ['text', 'fact', 'list'], 'body', [bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } }),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(32)),
      gap('lead-comment-gap', 'x', ref('lead', 'right'), ref('comment', 'left'), fixed(24)),
      align('lead-comment-bottom', 'y', ref('lead', 'bottom'), ref('comment', 'bottom'), 0),
    ],
    elasticGaps: [
      elastic('title-bottom-content-reserve', 'y', ref('title', 'bottom'), ref('lead', 'top'), range(120, 381, 460), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 1126, y: 834, w: 593, h: 2 }, ['comment']),
    ],
  },

  // 2 — 13:2 / intro reverse: comment left, lead right
  {
    id: 'intro-reverse-01',
    modeId: 'intro-reverse',
    sourceFrame: '13:2',
    densityRank: 1,
    signature: {
      title: 1, lead: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome(undefined, undefined, { x: 46, y: 122, w: 516, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 207, w: 1828, h: 302 }, 'title', true, [left(), right()], ['text'], undefined,
        { height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('comment', 'comment', { x: 46, y: 868, w: 760, h: 120 }, true, ['text', 'fact', 'list'], 'body', [left(), bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } }),
      componentRegion('lead', 'lead', { x: 830, y: 820, w: 1044, h: 168 }, true, ['text', 'fact', 'metric'], 'lead', [right(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(32)),
      gap('comment-lead-gap', 'x', ref('comment', 'right'), ref('lead', 'left'), fixed(24)),
      align('comment-lead-bottom', 'y', ref('comment', 'bottom'), ref('lead', 'bottom'), 0),
    ],
    elasticGaps: [
      elastic('title-lower-reserve', 'y', ref('title', 'bottom'), ref('lead', 'top'), range(96, 311, 400), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 46, y: 868, w: 760, h: 2 }, ['comment']),
    ],
  },

  // 3 — 13:24 / intro dense title
  {
    id: 'intro-02',
    modeId: 'intro',
    sourceFrame: '13:24',
    densityRank: 2,
    signature: {
      title: 1, lead: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome(undefined, undefined, { x: 46, y: 122, w: 516, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 207, w: 1519, h: 576 }, 'title', true, [left()], ['text'], undefined,
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('lead', 'lead', { x: 46, y: 820, w: 1056, h: 168 }, true, ['text', 'fact', 'metric'], 'lead', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
      componentRegion('comment', 'comment', { x: 1126, y: 834, w: 593, h: 154 }, true, ['text', 'fact', 'list'], 'body', [bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } }),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(32)),
      gap('lead-comment-gap', 'x', ref('lead', 'right'), ref('comment', 'left'), fixed(24)),
      align('lead-comment-bottom', 'y', ref('lead', 'bottom'), ref('comment', 'bottom'), 0),
    ],
    elasticGaps: [
      elastic('title-lead-reserve', 'y', ref('title', 'bottom'), ref('lead', 'top'), range(24, 37, 120), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 1126, y: 834, w: 593, h: 2 }, ['comment']),
    ],
  },

  // 4 — 13:46 / split intro: left title/comment, right lead
  {
    id: 'split-intro-01',
    modeId: 'split-intro',
    sourceFrame: '13:46',
    densityRank: 1,
    signature: {
      title: 1, lead: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome(undefined, undefined, { x: 46, y: 122, w: 516, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 207, w: 760, h: 264 }, 'title', true, [left()], ['text'], undefined,
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('comment', 'comment', { x: 46, y: 868, w: 760, h: 120 }, true, ['text', 'fact', 'list'], 'body', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 3, shrinkPriority: 3 } }),
      componentRegion('lead', 'lead', { x: 830, y: 122, w: 1044, h: 242 }, true, ['text', 'fact', 'metric'], 'lead', [right(), top(122)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(32)),
      gap('left-right-column-gap', 'x', ref('title', 'right'), ref('lead', 'left'), fixed(24)),
      align('left-comment-width', 'x', ref('title', 'right'), ref('comment', 'right'), 0),
    ],
    elasticGaps: [
      elastic('title-comment-reserve', 'y', ref('title', 'bottom'), ref('comment', 'top'), range(96, 397, 480), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 46, y: 868, w: 760, h: 2 }, ['comment']),
      lineDecoration('lead-separator', { x: 830, y: 122, w: 1044, h: 2 }, ['lead']),
    ],
  },

  // 5 — 13:68 / three lower editorial blocks
  {
    id: 'three-intro-01',
    modeId: 'three-intro',
    sourceFrame: '13:68',
    densityRank: 1,
    signature: {
      title: 1, body: 3,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome(undefined, undefined, { x: 46, y: 122, w: 516, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 207, w: 1828, h: 232 }, 'title', true, [left(), right()], ['text'], undefined,
        { height: { growPriority: 1, shrinkPriority: 3 } }),
      componentGroupRegion('body-group', 'body', { x: 46, y: 690, w: 1828, h: 298 }, true, 3, 3,
        ['text', 'fact', 'metric', 'list'], [threeIntroLayout], 'three-intro-row-3', 'body', [left(), bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 2, shrinkPriority: 2 } }, false),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(32)),
    ],
    elasticGaps: [
      elastic('title-body-reserve', 'y', ref('title', 'bottom'), ref('body-group', 'top'), range(80, 251, 340), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('body-column-1-separator', { x: 46, y: 690, w: 580, h: 2 }, ['body-group']),
      lineDecoration('body-column-2-separator', { x: 650, y: 690, w: 580, h: 2 }, ['body-group']),
      lineDecoration('body-column-3-separator', { x: 1254, y: 690, w: 580, h: 2 }, ['body-group']),
    ],
  },

  // 6 — 13:90 / intro with deep lead region and lower-right comment
  {
    id: 'intro-03',
    modeId: 'intro',
    sourceFrame: '13:90',
    densityRank: 3,
    signature: {
      title: 1, lead: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome(undefined, undefined, { x: 46, y: 122, w: 516, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 207, w: 1519, h: 232 }, 'title', true, [left()], ['text'], undefined,
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('lead', 'lead', { x: 46, y: 520, w: 1056, h: 468 }, true, ['text', 'fact', 'metric'], 'lead', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 1 } }),
      componentRegion('comment', 'comment', { x: 1126, y: 766, w: 593, h: 222 }, true, ['text', 'fact', 'list'], 'body', [bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 2 } }),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(32)),
      gap('lead-comment-gap', 'x', ref('lead', 'right'), ref('comment', 'left'), fixed(24)),
      align('lead-comment-bottom', 'y', ref('lead', 'bottom'), ref('comment', 'bottom'), 0),
    ],
    elasticGaps: [
      elastic('title-lead-reserve', 'y', ref('title', 'bottom'), ref('lead', 'top'), range(40, 81, 180), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 1126, y: 766, w: 593, h: 2 }, ['comment']),
    ],
  },

  // 7 — 21:364 / fact + visual
  {
    id: 'fact-visual-01',
    modeId: 'fact-visual',
    sourceFrame: '21:364',
    densityRank: 1,
    signature: {
      fact: 1, visual: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome({ x: 1573, y: 56.5, w: 301, h: 29 }, { x: 1809, y: 1019, w: 65, h: 27 }, { x: 46, y: 122, w: 368, h: 53 }),
      componentRegion('fact', 'fact', { x: 46, y: 199, w: 710, h: 789 }, true, ['fact', 'metric'], 'lead', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
      visualRegion('visual', { x: 784, y: 199, w: 1090, h: 740 }, true, [right(), top(199, 'soft')],
        { width: { growPriority: 3, shrinkPriority: 2 }, height: { growPriority: 3, shrinkPriority: 3 } }),
    ],
    relations: [
      gap('tag-body-gap', 'y', ref('tag', 'bottom'), ref('fact', 'top'), fixed(24)),
      gap('fact-visual-gap', 'x', ref('fact', 'right'), ref('visual', 'left'), fixed(28)),
      align('fact-visual-top', 'y', ref('fact', 'top'), ref('visual', 'top'), 0),
    ],
    elasticGaps: [],
    decorations: [
      ...commonDecorations(),
      lineDecoration('fact-separator', { x: 46, y: 834, w: 710, h: 2 }, ['fact']),
    ],
  },

  // 8 — 21:392 / long thesis + lower conclusion/comment
  {
    id: 'long-thesis-01',
    modeId: 'long-thesis',
    sourceFrame: '21:392',
    densityRank: 1,
    signature: {
      title: 1, lead: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome({ x: 1601, y: 56.5, w: 273, h: 29 }, { x: 1806, y: 1019, w: 68, h: 27 }, { x: 46, y: 122, w: 339, h: 53 }),
      plainTextRegion('title', 'title', { x: 46, y: 199, w: 1660, h: 255 }, 'title', true, [left()], ['text'], undefined,
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('lead', 'lead', { x: 46, y: 890, w: 1030, h: 98 }, true, ['text', 'fact', 'metric'], 'lead', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
      componentRegion('comment', 'comment', { x: 1148, y: 868, w: 726, h: 120 }, true, ['text', 'fact', 'list'], 'body', [right(), bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } }),
    ],
    relations: [
      gap('tag-title-gap', 'y', ref('tag', 'bottom'), ref('title', 'top'), fixed(24)),
      gap('lead-comment-gap', 'x', ref('lead', 'right'), ref('comment', 'left'), range(48, 72, 96)),
      align('lead-comment-bottom', 'y', ref('lead', 'bottom'), ref('comment', 'bottom'), 0),
    ],
    elasticGaps: [
      elastic('title-lower-reserve', 'y', ref('title', 'bottom'), ref('comment', 'top'), range(160, 414, 500), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 1148, y: 868, w: 726, h: 2 }, ['comment']),
    ],
  },

  // 9 — 21:412 / quote + context
  {
    id: 'quote-01',
    modeId: 'quote',
    sourceFrame: '21:412',
    densityRank: 1,
    signature: {
      quote: 1, comment: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome({ x: 1629, y: 56.5, w: 245, h: 29 }, { x: 1805, y: 1019, w: 69, h: 27 }, { x: 46, y: 122, w: 388, h: 53 }),
      componentRegion('quote', 'quote', { x: 332, y: 199, w: 1070, h: 789 }, true, ['quote'], 'quote', [bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
      componentRegion('comment', 'comment', { x: 1458, y: 199, w: 416, h: 789 }, true, ['text', 'fact'], 'body', [right(), bottom(92)],
        { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 3, shrinkPriority: 3 } }, 'start', 'end'),
    ],
    relations: [
      gap('tag-quote-gap', 'y', ref('tag', 'bottom'), ref('quote', 'top'), fixed(24)),
      gap('quote-comment-gap', 'x', ref('quote', 'right'), ref('comment', 'left'), fixed(56)),
      align('quote-comment-top', 'y', ref('quote', 'top'), ref('comment', 'top'), 0),
      align('quote-comment-bottom', 'y', ref('quote', 'bottom'), ref('comment', 'bottom'), 0),
    ],
    elasticGaps: [],
    decorations: [
      ...commonDecorations(),
      quoteMarkDecoration(),
      verticalAccentDecoration(),
    ],
    notes: [
      'Quote mark and vertical accent are decorations resolved from the active design system; their concrete glyph/color is not stored in the recipe.',
    ],
  },

  // 10 — 21:493 / photo + annotation
  {
    id: 'photo-note-01',
    modeId: 'photo-note',
    sourceFrame: '21:493',
    densityRank: 1,
    signature: {
      title: 1, comment: 1, visual: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome({ x: 1630, y: 56.5, w: 244, h: 29 }, { x: 1805, y: 1019, w: 69, h: 27 }, { x: 46, y: 122, w: 418, h: 53 }),
      visualRegion('visual', { x: 46, y: 199, w: 1120, h: 740 }, true, [left(), top(199, 'soft')],
        { width: { growPriority: 3, shrinkPriority: 2 }, height: { growPriority: 3, shrinkPriority: 3 } }),
      plainTextRegion('title', 'title', { x: 1194, y: 199, w: 680, h: 74 }, 'title', true, [right(), top(199, 'soft')], ['text'], undefined,
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 3 } }),
      componentRegion('comment', 'comment', { x: 1194, y: 868, w: 680, h: 120 }, true, ['text', 'fact', 'list'], 'body', [right(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
    ],
    relations: [
      gap('tag-visual-gap', 'y', ref('tag', 'bottom'), ref('visual', 'top'), fixed(24)),
      gap('visual-annotation-gap', 'x', ref('visual', 'right'), ref('title', 'left'), fixed(28)),
      align('visual-annotation-top', 'y', ref('visual', 'top'), ref('title', 'top')),
      align('annotation-right', 'x', ref('title', 'right'), ref('comment', 'right'), 0),
    ],
    elasticGaps: [
      elastic('title-comment-reserve', 'y', ref('title', 'bottom'), ref('comment', 'top'), range(160, 595, 680), 1, 1),
    ],
    decorations: [
      ...commonDecorations(),
      lineDecoration('comment-separator', { x: 1194, y: 868, w: 680, h: 2 }, ['comment']),
    ],
  },

  // 11 — 21:465 / metric + visual
  {
    id: 'metric-visual-01',
    modeId: 'metric-visual',
    sourceFrame: '21:465',
    densityRank: 1,
    signature: {
      metric: 1, visual: 1,
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome({ x: 1664, y: 56.5, w: 210, h: 29 }, { x: 1805, y: 1019, w: 69, h: 27 }, { x: 46, y: 122, w: 387, h: 53 }),
      componentRegion('metric', 'metric', { x: 46, y: 199, w: 820, h: 789 }, true, ['metric'], 'metric-caption', [left(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }),
      visualRegion('visual', { x: 898, y: 199, w: 976, h: 740 }, true, [right(), top(199, 'soft')],
        { width: { growPriority: 3, shrinkPriority: 2 }, height: { growPriority: 3, shrinkPriority: 3 } }),
    ],
    relations: [
      gap('tag-metric-gap', 'y', ref('tag', 'bottom'), ref('metric', 'top'), fixed(24)),
      gap('metric-visual-gap', 'x', ref('metric', 'right'), ref('visual', 'left'), fixed(32)),
      align('metric-visual-top', 'y', ref('metric', 'top'), ref('visual', 'top'), 0),
    ],
    elasticGaps: [],
    decorations: [
      ...commonDecorations(),
    ],
  },

  // 12 — 21:433 / adaptive text columns
  {
    id: 'text-columns-01',
    modeId: 'text-columns',
    sourceFrame: '21:433',
    densityRank: 1,
    signature: {
      body: { min: 1, max: 3 },
      context: { min: 0, max: 1 }, year: { min: 0, max: 1 }, format: { min: 0, max: 1 },
      tag: { min: 0, max: 1 }, footer: { min: 0, max: 1 }, page: { min: 0, max: 1 },
    },
    regions: [
      ...commonChrome({ x: 1611, y: 56.5, w: 263, h: 29 }, { x: 1805, y: 1019, w: 69, h: 27 }, { x: 46, y: 122, w: 189, h: 53 }),
      componentGroupRegion('column-group', 'body', { x: 46, y: 199, w: 1828, h: 789 }, true, 1, 3,
        ['column-item'], textColumnLayouts, 'text-columns-3', 'body', [left(), right(), bottom(92)],
        { width: { growPriority: 2, shrinkPriority: 2 }, height: { growPriority: 2, shrinkPriority: 2 } }, true),
    ],
    relations: [
      gap('tag-columns-gap', 'y', ref('tag', 'bottom'), ref('column-group', 'top'), fixed(24)),
    ],
    elasticGaps: [],
    decorations: [
      ...commonDecorations(),
    ],
    notes: [
      'This mode explicitly allows 1, 2 or 3 columns through declared layouts. Qwen may choose only one of those layout IDs; it never invents column geometry.',
      'The authored state is 3 columns; 1/2-column layouts are formal recipe adaptations, not free-form model composition.',
    ],
  },
]

// ============================================================================
// RECIPE
// ============================================================================

// INTERNAL COMPOSITION — independent of a concrete design system.
// Native components retain their own internal layout. These trees govern the
// measured primitive fallback; outer prefixes also wrap native components.
const fieldSlot = (field: string, typographyRole: TypographyRole, referenceRect?: Rect): FlexNode => ({
  kind: 'field', id: field, field, typographyRole, referenceRect,
  flow: field === 'items' ? 'list-items-in-source-order' : 'text',
})

const columnStack = (
  id: string, children: FlexNode[], gapPx = 16,
  justify: 'start' | 'space-between' = 'start', height: 'fill' | 'hug' = 'hug',
): FlexNode => ({ kind: 'stack', id, direction: 'column', height, justify, align: 'stretch', gap: fixed(gapPx), children })

function primitiveLayoutFor(state: AuthoredState, region: RegionSpec, type: SemanticBlockType): PrimitiveLayout | undefined {
  if (type === 'visual') return undefined
  const role = region.content.primitiveTypographyRole ?? 'body'
  const w = region.preferredRect.w, h = region.preferredRect.h
  const editorial = state.modeId === 'fact-visual' || state.modeId === 'metric-visual'
  let root: FlexNode

  switch (type) {
    case 'text':
    case 'label': {
      let box: Rect = { x: 0, y: 0, w, h }
      if (region.id === 'comment') box = state.modeId === 'quote'
        ? { x: 0, y: 585, w, h: 204 }
        : { x: 0, y: 18, w, h: h - 18 }
      if (state.id === 'split-intro-01' && region.id === 'lead') box = { x: 0, y: 18, w: 634, h: 224 }
      root = fieldSlot('text', role, box)
      if (root.kind === 'field' && box.w !== w) root.widthFraction = box.w / w
      break
    }
    case 'fact':
      root = columnStack('fact', [
        fieldSlot('text', editorial ? 'display' : role,
          editorial ? { x: 0, y: 0, w, h: 151 } : undefined),
        columnStack('caption-group', [fieldSlot('caption', 'caption',
          editorial ? { x: 0, y: 653, w, h: 136 } : undefined)]),
      ], 24, editorial ? 'space-between' : 'start', editorial ? 'fill' : 'hug')
      break
    case 'metric':
      root = columnStack('metric', [
        columnStack('metric-head', [
          fieldSlot('value', 'metric-value', state.modeId === 'metric-visual' ? { x: 0, y: 0, w: 576, h: 154 } : undefined),
          fieldSlot('unit', 'metric-unit', state.modeId === 'metric-visual' ? { x: 0, y: 162, w: 712, h: 34 } : undefined),
        ], 8),
        columnStack('caption-group', [
          fieldSlot('caption', 'metric-caption', state.modeId === 'metric-visual' ? { x: 0, y: 660, w, h: 129 } : undefined),
          fieldSlot('note', 'body'),
        ]),
      ], 24, editorial ? 'space-between' : 'start', editorial ? 'fill' : 'hug')
      break
    case 'quote':
      root = columnStack('quote', [
        fieldSlot('quote', 'quote', { x: 0, y: 0, w, h: 225 }),
        columnStack('quote-credit', [
          fieldSlot('author', 'quote-author', { x: 0, y: 759, w, h: 30 }),
          fieldSlot('source', 'caption'),
        ], 8),
      ], 24, 'space-between', 'fill')
      break
    case 'list':
      root = fieldSlot('items', 'body')
      break
    case 'column-item':
      root = columnStack('column', [
        fieldSlot('marker', 'marker', { x: 0, y: 0, w: 105, h: 116 }),
        columnStack('column-details', [
          fieldSlot('heading', 'column-heading', { x: 0, y: 624, w: 590.6666870117188, h: 43 }),
          fieldSlot('body', 'body', { x: 0, y: 687, w: 590.6666870117188, h: 102 }),
        ], 20),
      ], 24, 'space-between', 'fill')
      break
  }
  return { id: `${state.id}/${region.id}/${type}/v4`, root, fieldSizing: 'measured-active-ds-text', overflow: 'reject-and-relayout' }
}

export const states: AuthoredState[] = authoredStates.map(source => {
  const state = structuredClone(source)
  for (const region of state.regions) {
    region.content.primitiveLayouts = {}
    for (const type of region.content.accepts) {
      const layout = primitiveLayoutFor(state, region, type)
      if (layout) region.content.primitiveLayouts[type] = layout
    }
  }
  if (state.modeId === 'text-columns') state.decorations?.push({
    id: 'column-details-separator',
    preferredRect: { x: 46, y: 801, w: 590.6666870117188, h: 2 },
    attachment: { kind: 'prefix', regionId: 'column-group', slotId: 'column-details', item: 'each', appliesTo: 'primitive', distribution: 'start', gapAfter: fixed(20), width: 'fill', height: 2 },
    componentQuery: { semanticRole: 'editorial-separator', designSystem: 'active' },
    whenAllRegionsPresent: ['column-group'],
  })
  return state
})

export const recipe = {
  id: RECIPE_ID,
  version: 4,
  sourceSection: SOURCE_SECTION,

  canvas: CANVAS,
  safeArea: SAFE,
  contentArea: CONTENT,

  runtimeSourcePolicy: {
    figmaProvides: [
      'composition',
      'authored-reference-geometry',
      'hierarchy',
      'density-states',
      'region-relations',
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
      'component-id',
    ],
    typographySource: 'active-design-system',
    colorSource: 'active-design-system',
    componentSource: 'active-design-system-registry',
  },

  adaptation: {
    initialScaleSamples: INITIAL_SCALE_SAMPLES,
    initialSamplesAreExhaustive: false,
    dimensionSearch: 'all-feasible-4px-values-within-region-size-range',
    blockScaleAppliesTo: ['region-width', 'region-height'],
    scalingMethod: 'relayout-not-transform',
    adaptedDimensionStepPx: 4,
    positionPolicy: 'derive-from-flex-flow-and-anchors-preserve-authored-insets',
    unchangedAuthoredDimensionsMayBeOffGrid: true,
    fontStepPx: 4,
    lineHeightPolicy: 'resolve-with-font-size-from-active-design-system',
    nativeArtworkStretch: 'forbidden',
    layoutOutput: 'flex-tree-only',
    priorities: 'lower-number-is-served-first',
    elasticGapsDescribeExistingDistances: true,
    gapAndElasticSameEndpoints: 'intersect-ranges-never-double-space',
    internalComposition: 'region-primitive-layouts-with-measured-fields-and-explicit-flex-groups',
    primitiveTypographyPrecedence: 'slot-role-then-semantic-default-then-active-ds-profile',
    nativeComponents: 'preserve-internals-and-measure-inside-attached-decoration-wrapper',
    decorationCoordinates: 'reference-only-render-in-attached-flow',
  },

  optionalRegions: {
    policy: 'remove-empty-regions-before-solving',
    resolver: 'resolvePresentState',
    missingTag: 'release-tag-space-to-its-dependent-top-aligned-row',
    missingFooter: 'release-lower-reserve-only-when-footer-and-page-are-both-absent',
    missingHeaderMeta: 'remove-only-missing-header-regions-and-dependent-decorations',
    decorations: 'attached-flex-items-or-reserved-sidecars-never-fixed-overlay',
  },

  emphasis: {
    choices: ['primary', 'secondary'],
    styleSource: 'active-design-system-role-and-emphasis-profile',
    missingProfile: 'reject-before-model-call',
    requireMeasuredHierarchy: true,
  },

  hardValidation: {
    overflow: 'reject',
    collision: 'reject',
    outOfBounds: 'reject',
    preserveAllSuppliedContent: true,
    optionalSlotMeansDroppableContent: false,
    validDesignSystemComponentsOnly: true,
    validateComponentFieldBindings: true,
    validateAllowedGroupLayouts: true,
    preserveVisualAspectRatio: true,
    diagramCropping: 'forbidden',
    adaptedDimensionStepPx: 4,
    sourceRefsMustRespectUseCounts: true,
    semanticFieldsMustMatchBlockContract: true,
  },

  stateSelection: {
    qwenMayChooseMode: true,
    qwenMayChooseState: false,
    order: [
      'filter-states-by-content-signature',
      'try-all-compatible-states-with-native-design-system-typography',
      'prefer-largest-preserved-typography-hierarchy',
      'adapt-region-geometry-through-relations-and-elastic-gaps',
      'adapt-declared-group-layouts',
      'try-real-design-system-components',
      'fallback-to-semantic-primitives-with-reason',
      'reduce-font-size-in-4px-steps-as-last-resort',
      'hard-validate',
      'reject-state-if-invalid',
      'reject-mode-if-no-state-valid',
    ],
    tieBreakers: [
      'least-font-reduction',
      'least-geometry-deviation-from-authored-reference',
      'preferred-group-layout',
      'retain-real-components',
      'lower-density-rank',
    ],
  },

  semanticBlocks: semanticBlockContracts,

  modes: [
    { id: 'intro', states: ['intro-01', 'intro-02', 'intro-03'] },
    { id: 'intro-reverse', states: ['intro-reverse-01'] },
    { id: 'split-intro', states: ['split-intro-01'] },
    { id: 'three-intro', states: ['three-intro-01'] },
    { id: 'fact-visual', states: ['fact-visual-01'] },
    { id: 'long-thesis', states: ['long-thesis-01'] },
    { id: 'quote', states: ['quote-01'] },
    { id: 'photo-note', states: ['photo-note-01'] },
    { id: 'metric-visual', states: ['metric-visual-01'] },
    { id: 'text-columns', states: ['text-columns-01'] },
  ] as const,

  states,
} as const

// ============================================================================
// QWEN STRUCTURAL ASSIGNMENT CONTRACT
// ============================================================================

export const FALLBACK_REASONS = [
  'no-compatible-component',
  'component-does-not-fit',
  'component-field-contract-mismatch',
] as const
export type FallbackReason = (typeof FALLBACK_REASONS)[number]
export type FieldBinding = { sourceRefs: readonly string[] }

export type BlockBinding = {
  regionId: string
  type: SemanticBlockType
  sourceRefs: readonly string[]
  fields: Readonly<Record<string, FieldBinding | VisualType>>
  emphasis: Emphasis
}

export type MeasuredComponentVariant = BlockBinding & {
  id: string
  componentId: string
  designSystemId: string
  stateIds: readonly string[]
  layoutId: string | null
}

export type FallbackEvidence = BlockBinding & {
  designSystemId: string
  stateIds: readonly string[]
  layoutId: string | null
  reason: FallbackReason
  /** Executor-owned proof: inspect the source bundle against ALL semantic types
   * accepted by the region and both allowed emphases, not just Qwen's chosen type. */
  componentSearch: 'all-accepted-types-and-emphases'
}

export type QwenSchemaContext = {
  designSystemId: string
  sourceRefs: readonly [string, ...string[]]
  sourceUseCounts?: Readonly<Record<string, number>>
  componentVariants: readonly MeasuredComponentVariant[]
  fallbackEvidence: readonly FallbackEvidence[]
  visualAssets: readonly { sourceRef: string; assetId: string; visualType: VisualType }[]
}

const allRegionIds = [
  'context',
  'year',
  'format',
  'tag',
  'title',
  'lead',
  'comment',
  'body-group',
  'fact',
  'metric',
  'quote',
  'visual',
  'column-group',
  'footer',
  'page',
] as const

const allGroupLayoutIds = [
  'three-intro-row-3',
  'text-columns-3',
  'text-columns-2',
  'text-columns-1',
] as const

export function createQwenAssignmentSchema(ctx: QwenSchemaContext) {
  assertContext(ctx)
  const sourceRef = z.enum(ctx.sourceRefs)
  const fieldBinding = z.object({ sourceRefs: z.array(sourceRef).min(1) }).strict()
  const primitive = z.object({ kind: z.literal('primitive'), reason: z.enum(FALLBACK_REASONS).nullable() }).strict()
  const asset = z.object({ kind: z.literal('asset') }).strict()
  const variantIds = ctx.componentVariants.map(v => v.id)
  const render = variantIds.length
    ? z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('component'), variantId: z.enum(variantIds as [string, ...string[]]) }).strict(),
        primitive,
        asset,
      ])
    : z.discriminatedUnion('kind', [primitive, asset])

  const common = {
    regionId: z.enum(allRegionIds),
    sourceRefs: z.array(sourceRef).min(1),
    emphasis: z.enum(['primary', 'secondary']),
    render,
  }

  const assignment = z.discriminatedUnion('type', [
    z.object({ ...common, type: z.literal('text'), fields: z.object({ text: fieldBinding }).strict() }).strict(),
    z.object({ ...common, type: z.literal('label'), fields: z.object({ text: fieldBinding }).strict() }).strict(),
    z.object({ ...common, type: z.literal('metric'), fields: z.object({
      value: fieldBinding,
      unit: fieldBinding.optional(),
      caption: fieldBinding,
      note: fieldBinding.optional(),
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('fact'), fields: z.object({
      text: fieldBinding,
      caption: fieldBinding.optional(),
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('quote'), fields: z.object({
      quote: fieldBinding,
      author: fieldBinding.optional(),
      source: fieldBinding.optional(),
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('list'), fields: z.object({ items: fieldBinding }).strict() }).strict(),
    z.object({ ...common, type: z.literal('column-item'), fields: z.object({
      marker: fieldBinding,
      heading: fieldBinding,
      body: fieldBinding,
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('visual'), fields: z.object({
      assetRef: z.object({ sourceRefs: z.array(sourceRef).length(1) }).strict(),
      visualType: z.enum(['photo', 'illustration', 'diagram', 'abstract-graphic']),
    }).strict() }).strict(),
  ])

  return z.object({
    modeId: z.enum(MODE_IDS),
    assignments: z.array(assignment).min(1),
    groupChoices: z.array(z.object({
      regionId: z.enum(['body-group', 'column-group']),
      layoutId: z.enum(allGroupLayoutIds),
    }).strict()).default([]),
  }).strict()
}

export type QwenAssignment = z.infer<ReturnType<typeof createQwenAssignmentSchema>>
export type AssignedBlock = QwenAssignment['assignments'][number]

export class RecipeAssignmentError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(issues.join('\n'))
    this.name = 'RecipeAssignmentError'
  }
}

function assertContext(ctx: QwenSchemaContext): void {
  const issues: string[] = []
  if (!ctx.designSystemId) issues.push('missing-active-design-system')
  if (!ctx.sourceRefs.length || ctx.sourceRefs.some(id => !id) || new Set(ctx.sourceRefs).size !== ctx.sourceRefs.length) {
    issues.push('source-refs-must-be-nonempty-and-unique')
  }
  for (const [id, count] of Object.entries(ctx.sourceUseCounts ?? {})) {
    if (!ctx.sourceRefs.includes(id) || !Number.isInteger(count) || count < 1) issues.push(`invalid-source-use-count:${id}`)
  }
  if (new Set(ctx.componentVariants.map(v => v.id)).size !== ctx.componentVariants.length) issues.push('duplicate-variant-id')
  if (new Set(ctx.visualAssets.map(v => v.sourceRef)).size !== ctx.visualAssets.length) issues.push('duplicate-visual-source')
  for (const v of [...ctx.componentVariants, ...ctx.fallbackEvidence]) {
    if (v.designSystemId !== ctx.designSystemId) issues.push('candidate-from-another-design-system')
    if (!v.stateIds.length || v.stateIds.some(id => !states.some(s => s.id === id))) issues.push('unknown-candidate-state')
    if (v.sourceRefs.some(id => !ctx.sourceRefs.includes(id))) issues.push('candidate-with-unknown-source')
    if (!sameRefs(fieldRefs(v.fields), v.sourceRefs)) issues.push('candidate-fields-do-not-match-source-refs')
  }
  for (const e of ctx.fallbackEvidence) {
    if (e.componentSearch !== 'all-accepted-types-and-emphases') issues.push('incomplete-component-search')
  }
  for (const a of ctx.visualAssets) {
    if (!a.assetId || !ctx.sourceRefs.includes(a.sourceRef)) issues.push('invalid-visual-source')
  }
  if (issues.length) throw new RecipeAssignmentError(issues)
}

function fieldRefs(fields: BlockBinding['fields']): string[] {
  return Object.values(fields).flatMap(value => value === undefined || typeof value === 'string' ? [] : [...value.sourceRefs])
}

function sameRefs(a: readonly string[], b: readonly string[]): boolean {
  const sortedB = [...b].sort()
  return a.length === b.length && [...a].sort().every((id, i) => id === sortedB[i])
}

function bindingKey(b: BlockBinding): string {
  return JSON.stringify([
    b.regionId,
    b.type,
    b.emphasis,
    [...b.sourceRefs].sort(),
    Object.entries(b.fields).filter(([, value]) => value !== undefined).sort(([a], [c]) => a.localeCompare(c)),
  ])
}

function countRuleBounds(rule: CountRule | undefined): { min: number; max: number } {
  if (typeof rule === 'number') return { min: rule, max: rule }
  return rule ?? { min: 0, max: 0 }
}

/** Validate meaning and candidate scope after parsing the JSON shape.
 * Success proves recipe-contract compatibility, not rendered fit or visual quality.
 */
export function validateQwenAssignment(raw: unknown, ctx: QwenSchemaContext): {
  assignment: QwenAssignment
  compatibleStateIds: string[]
  requiresRenderedValidation: true
} {
  const assignment = createQwenAssignmentSchema(ctx).parse(raw)
  const issues: string[] = []
  const uses = new Map<string, number>()

  for (const b of assignment.assignments) {
    if (new Set(b.sourceRefs).size !== b.sourceRefs.length) issues.push(`duplicate-ref-within-block:${b.regionId}`)
    if (!sameRefs(fieldRefs(b.fields), b.sourceRefs)) issues.push(`fields-do-not-match-source-refs:${b.regionId}`)
    for (const id of fieldRefs(b.fields)) uses.set(id, (uses.get(id) ?? 0) + 1)
    if (b.type === 'visual') {
      const a = ctx.visualAssets.find(v => v.sourceRef === b.fields.assetRef.sourceRefs[0])
      if (!a || a.visualType !== b.fields.visualType) issues.push(`unknown-or-mistyped-visual:${b.regionId}`)
    } else if (b.sourceRefs.some(id => ctx.visualAssets.some(a => a.sourceRef === id))) {
      issues.push(`asset-used-as-text:${b.regionId}`)
    }
  }

  for (const id of ctx.sourceRefs) {
    const expected = ctx.sourceUseCounts?.[id] ?? 1
    if ((uses.get(id) ?? 0) !== expected) issues.push(`source-coverage:${id}:expected=${expected}:actual=${uses.get(id) ?? 0}`)
  }

  if (new Set(assignment.groupChoices.map(c => c.regionId)).size !== assignment.groupChoices.length) issues.push('duplicate-group-choice')
  if (issues.length) throw new RecipeAssignmentError(issues)

  const compatibleStateIds: string[] = []
  const rejected: string[] = []

  for (const state of states.filter(s => s.modeId === assignment.modeId)) {
    const problems: string[] = []
    const choiceByRegion = new Map<string, string>(assignment.groupChoices.map(c => [c.regionId, c.layoutId]))

    for (const c of assignment.groupChoices) {
      const region = state.regions.find(r => r.id === c.regionId)
      if (!region?.content.group || !assignment.assignments.some(a => a.regionId === c.regionId)) {
        problems.push(`orphan-group-choice:${c.regionId}`)
      }
    }

    for (const region of state.regions) {
      const items = assignment.assignments.filter(a => a.regionId === region.id)
      const policy = region.content
      if (items.length < policy.minItems || items.length > policy.maxItems || (policy.required && !items.length)) {
        problems.push(`region-count:${region.id}`)
      }
      if (items.filter(i => i.emphasis === 'primary').length > policy.emphasis.maxPrimaryItems) {
        problems.push(`too-many-primary-items:${region.id}`)
      }
      if (policy.group && items.length) {
        const layoutId = choiceByRegion.get(region.id)
        const layout = policy.group.allowedLayouts.find(l => l.id === layoutId)
        if (!layout || items.length < layout.minItems || items.length > layout.maxItems) problems.push(`invalid-group-layout:${region.id}`)
        if (!policy.group.qwenMayChooseLayout && layoutId !== policy.group.preferredLayoutId) problems.push(`fixed-group-layout:${region.id}`)
      }
    }

    for (const role of [
      'title', 'lead', 'comment', 'context', 'year', 'format', 'tag', 'body', 'fact', 'metric', 'quote', 'footer', 'page', 'visual',
    ] as const) {
      const count = assignment.assignments.filter(a => state.regions.find(r => r.id === a.regionId)?.content.role === role).length
      const { min, max } = countRuleBounds(state.signature[role])
      if (count < min || count > max) problems.push(`signature:${role}:${count}`)
    }

    for (const b of assignment.assignments) {
      const region = state.regions.find(r => r.id === b.regionId)
      if (!region) { problems.push(`unknown-region:${b.regionId}`); continue }
      if (!region.content.accepts.includes(b.type)) problems.push(`block-type-not-allowed:${b.regionId}:${b.type}`)
      if (!region.content.emphasis.allowed.includes(b.emphasis)) problems.push(`emphasis-not-allowed:${b.regionId}`)

      const contract = semanticBlockContracts[b.type]
      const layoutId = choiceByRegion.get(b.regionId) ?? null
      const matches = (candidate: MeasuredComponentVariant | FallbackEvidence) =>
        candidate.stateIds.includes(state.id) && candidate.layoutId === layoutId && bindingKey(candidate) === bindingKey(b)
      const fits = ctx.componentVariants.filter(matches)
      // Classification, field partitioning or emphasis must not hide a usable
      // library component for the same immutable source bundle in this slot.
      const fitsSameContent = ctx.componentVariants.filter(v =>
        v.stateIds.includes(state.id) && v.layoutId === layoutId && v.regionId === b.regionId &&
        sameRefs(v.sourceRefs, b.sourceRefs) && region.content.accepts.includes(v.type) &&
        region.content.emphasis.allowed.includes(v.emphasis))
      const render = b.render

      if (render.kind === 'component') {
        if (!contract.componentQuery || !fits.some(v => v.id === render.variantId)) problems.push(`component-not-measured-for-block:${b.regionId}`)
      } else if (render.kind === 'asset') {
        if (b.type !== 'visual' || !region.content.visualFit) problems.push(`asset-not-allowed:${b.regionId}`)
      } else {
        if (b.type === 'visual') problems.push(`visual-must-use-asset:${b.regionId}`)
        const needsEvidence = region.content.componentPriority === 'component-first'
        if (needsEvidence) {
          if (!render.reason) problems.push(`fallback-reason-required:${b.regionId}`)
          if (fitsSameContent.length) problems.push(`compatible-component-must-be-used:${b.regionId}`)
          if (!ctx.fallbackEvidence.some(e => matches(e) && e.reason === render.reason)) {
            problems.push(`fallback-not-supported-by-executor:${b.regionId}`)
          }
        } else if (render.reason !== null) problems.push(`direct-primitive-must-have-null-reason:${b.regionId}`)
      }
    }

    if (problems.length) rejected.push(...problems.map(p => `${state.id}:${p}`))
    else compatibleStateIds.push(state.id)
  }

  if (!compatibleStateIds.length) throw new RecipeAssignmentError(['no-compatible-state', ...rejected])
  return { assignment, compatibleStateIds, requiresRenderedValidation: true }
}

// ============================================================================
// EXECUTABLE FLEX PLANS — call after validateQwenAssignment.
// ============================================================================

const prefixApplies = (d: DecorationSpec, regionId: string, itemIndex?: number) => {
  const a = d.attachment
  return a.kind === 'prefix' && a.regionId === regionId &&
    (a.item === null || a.item === 'each' || a.item === itemIndex)
}

function bindFields(node: FlexNode, fields: BlockBinding['fields']): FlexNode | null {
  if (node.kind === 'field') {
    const value = fields[node.field]
    return value && typeof value !== 'string' ? { ...node, sourceRefs: [...value.sourceRefs] } : null
  }
  if (node.kind !== 'stack') return structuredClone(node)
  const children = node.children.map(c => bindFields(c, fields)).filter((c): c is FlexNode => c !== null)
  if (!children.length) return null
  return { ...node, children, justify: children.length === 1 ? 'start' : node.justify }
}

function attachPrefix(root: FlexNode, decoration: DecorationSpec): FlexNode {
  const a = decoration.attachment
  if (a.kind !== 'prefix') return root
  const wrap = (node: FlexNode): FlexNode => ({
    kind: 'stack', id: `with-${decoration.id}:${node.id}`, direction: 'column',
    height: a.distribution === 'space-between' || (node.kind === 'stack' && node.height === 'fill') ? 'fill' : 'hug',
    justify: a.distribution, align: 'stretch', gap: { ...a.gapAfter },
    children: [
      { kind: 'decoration', id: decoration.id, decorationId: decoration.id, width: a.width, height: a.height },
      node,
    ],
  })
  if (a.slotId === null) return wrap(root)
  const visit = (node: FlexNode): FlexNode => node.id === a.slotId ? wrap(node)
    : node.kind === 'stack' ? { ...node, children: node.children.map(visit) } : node
  // A removed optional slot has no separator and consumes no space.
  return visit(root)
}

/** Returned nodes must be rendered as nested flex boxes. Measure all text with
 * the active DS, and check the complete tree, including prefixes and sidecars.
 * itemIndex is the stable order among assignments to this region. */
export function createRegionRenderPlan(state: AuthoredState, block: AssignedBlock, itemIndex?: number): FlexNode {
  const region = state.regions.find(r => r.id === block.regionId)
  if (!region || !region.content.accepts.includes(block.type)) throw new Error('Block is incompatible with region')
  if (region.content.group && (itemIndex === undefined || !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= region.content.maxItems)) {
    throw new Error('A group item requires its validated item index')
  }
  let root: FlexNode
  if (block.render.kind === 'component') root = { kind: 'component', id: 'native-component', variantId: block.render.variantId }
  else if (block.render.kind === 'asset') {
    if (block.type !== 'visual' || !region.content.visualFit) throw new Error('Asset is incompatible with region')
    root = { kind: 'asset', id: 'visual-asset', assetRef: block.fields.assetRef.sourceRefs[0], fit: region.content.visualFit[block.fields.visualType] }
  } else {
    const spec = region.content.primitiveLayouts?.[block.type]
    if (!spec) throw new Error('Missing primitive layout')
    const bound = bindFields(spec.root, block.fields)
    if (!bound) throw new Error('Primitive layout has no content')
    root = bound
  }
  for (const d of state.decorations ?? []) {
    if (!prefixApplies(d, region.id, itemIndex) || d.attachment.kind !== 'prefix') continue
    if (d.attachment.appliesTo === 'primitive' && block.render.kind !== 'primitive') continue
    root = attachPrefix(root, d)
  }
  return root
}

/** Upper bound for measuring a native component BEFORE offering its variant to
 * Qwen. Internal primitive-only separators do not alter a native DS component.
 * The measured result is still revalidated after final region layout. */
export function nativeContentCapacity(state: AuthoredState, regionId: string, box: Rect, itemIndex?: number): { w: number; h: number } {
  const reserve = (state.decorations ?? []).reduce((sum, d) => {
    const a = d.attachment
    return prefixApplies(d, regionId, itemIndex) && a.kind === 'prefix' && a.appliesTo === 'any' && a.slotId === null
      ? sum + a.height + a.gapAfter.min : sum
  }, 0)
  if (!Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= reserve) throw new Error('No capacity after decoration')
  return { w: box.w, h: box.h - reserve }
}

/** Non-prefix decorations occupy reserved space in the parent flex flow. This
 * helper verifies their final boxes from measured regions; it is not an overlay
 * placement instruction. A failure requires relayout, never clipping. */
export function resolveExternalDecorationRects(state: AuthoredState, measured: Readonly<Record<string, Rect>>): { id: string; rect: Rect }[] {
  const result: { id: string; rect: Rect }[] = []
  const get = (id: string) => {
    const box = measured[id]
    if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) throw new Error(`Missing measured region: ${id}`)
    return box
  }
  for (const d of state.decorations ?? []) {
    const a = d.attachment
    if (a.kind === 'prefix') continue
    let rect: Rect
    if (a.kind === 'between-regions') {
      const from = get(a.fromRegionId), to = get(a.toRegionId)
      rect = { x: from.x + from.w + a.insetStart, y: from.y + (from.h - a.height) / 2,
        w: to.x - a.insetEnd - (from.x + from.w + a.insetStart), h: a.height }
    } else {
      const owner = get(a.regionId)
      rect = { x: owner.x - a.gap - a.size.w, y: owner.y, ...a.size }
    }
    if (rect.w <= 0 || rect.h <= 0 || rect.x < SAFE.left || rect.y < SAFE.top ||
      rect.x + rect.w > CANVAS.width - SAFE.right || rect.y + rect.h > CANVAS.height - SAFE.bottom) {
      throw new Error(`Decoration requires relayout: ${d.id}`)
    }
    result.push({ id: d.id, rect })
  }
  return result
}

// ============================================================================
// OPTIONAL REGION PRESENCE RESOLUTION
// ============================================================================

const rangeOfRelation = (r: LayoutRelation | ElasticGap): Range | null =>
  'kind' in r ? (r.kind === 'gap' ? r.gap : null) : r.range

/**
 * Remove unfilled optional regions before layout solving.
 * Required regions are never removable.
 *
 * Rules:
 * - relations/decorations targeting removed regions are deleted;
 * - a missing tag releases space to its dependent row, including top-aligned peers;
 * - lower reserve is released only when both footer and page number are absent;
 * - when one removed region sits between two gap edges on the same axis, those
 *   edges are bridged with a single range using max(min/preferred/max), never summed;
 * - source content is never dropped here; call only after assignment validation.
 */
export function resolvePresentState(state: AuthoredState, presentRegionIds: readonly string[]): AuthoredState {
  const present = new Set(presentRegionIds)
  if ([...present].some(id => !state.regions.some(r => r.id === id))) throw new Error('Unknown present region')
  if (state.regions.some(r => r.content.required && !present.has(r.id))) throw new Error('Required region is absent')

  const result = structuredClone(state)
  const removed = new Set(result.regions.filter(r => !present.has(r.id)).map(r => r.id))
  const exists = (edge: EdgeRef) => edge.region === '$canvas' || present.has(edge.region)

  // Bridge removed regions only when there is a clear incoming/outgoing gap path.
  for (const removedId of removed) {
    const allGapEdges = [
      ...result.relations.filter((r): r is Extract<LayoutRelation, { kind: 'gap' }> => r.kind === 'gap'),
      ...result.elasticGaps,
    ]
    const incoming = allGapEdges.filter(e => e.to.region === removedId)
    const outgoing = allGapEdges.filter(e => e.from.region === removedId)

    for (const a of incoming) for (const b of outgoing) {
      if (a.axis !== b.axis) continue
      const ra = rangeOfRelation(a)
      const rb = rangeOfRelation(b)
      if (!ra || !rb) continue
      const merged = range(
        Math.max(ra.min, rb.min),
        Math.max(ra.preferred, rb.preferred),
        Math.max(ra.max, rb.max),
      )
      const id = `without-${removedId}:${a.id}:${b.id}`
      const aElastic = !('kind' in a)
      const bElastic = !('kind' in b)
      if (aElastic || bElastic) {
        result.elasticGaps.push(elastic(
          id,
          a.axis,
          a.from,
          b.to,
          merged,
          Math.min(aElastic ? a.shrinkPriority : Infinity, bElastic ? b.shrinkPriority : Infinity),
          Math.min(aElastic ? a.growPriority : Infinity, bElastic ? b.growPriority : Infinity),
        ))
      } else {
        result.relations.push(gap(id, a.axis, a.from, b.to, merged))
      }
    }
  }

  if (removed.has('tag')) {
    const row = new Set([...result.relations, ...result.elasticGaps]
      .filter(r => r.axis === 'y' && r.from.region === 'tag' && r.to.edge === 'top' && present.has(r.to.region))
      .map(r => r.to.region))
    let changed = true
    while (changed) {
      changed = false
      for (const r of result.relations) {
        if (r.kind !== 'align' || r.axis !== 'y' || r.from.edge !== 'top' || r.to.edge !== 'top' ||
          r.offset !== 0 || !present.has(r.from.region) || !present.has(r.to.region)) continue
        if (row.has(r.from.region) || row.has(r.to.region)) {
          const before = row.size
          row.add(r.from.region); row.add(r.to.region)
          if (row.size !== before) changed = true
        }
      }
    }
    for (const r of result.regions) if (row.has(r.id)) {
      r.anchors = r.anchors.filter(a => a.edge !== 'top')
      r.anchors.push({ edge: 'top', to: '$canvas', offset: CONTENT.y, strength: 'soft' })
    }
  }

  if (!present.has('footer') && !present.has('page')) {
    const predecessors = new Set([...result.relations, ...result.elasticGaps]
      .filter(r => r.axis === 'y' && r.to.region === 'footer')
      .map(r => r.from.region))

    // Most authored states leave the footer outside the main content frame and do
    // not need a literal relation to it. In that case the bottom-most present
    // content region is the predecessor whose reserve becomes available.
    if (!predecessors.size) {
      const main = result.regions.filter(r =>
        present.has(r.id) && !['context', 'year', 'format', 'tag', 'footer', 'page'].includes(r.id))
      const maxBottom = Math.max(...main.map(r => r.preferredRect.y + r.preferredRect.h), Number.NEGATIVE_INFINITY)
      for (const r of main) {
        if (Math.abs(r.preferredRect.y + r.preferredRect.h - maxBottom) <= 4) predecessors.add(r.id)
      }
    }

    for (const id of predecessors) {
      const r = result.regions.find(n => n.id === id)
      if (r && present.has(id)) {
        r.anchors = r.anchors.filter(a => a.edge !== 'bottom')
        r.anchors.push({ ...bottom(SAFE.bottom), strength: 'soft' })
      }
    }
  }

  result.regions = result.regions.filter(r => present.has(r.id))
  result.relations = result.relations.filter(r => exists(r.from) && exists(r.to))
  result.elasticGaps = result.elasticGaps.filter(r => exists(r.from) && exists(r.to))
  result.decorations = result.decorations?.filter(d => !d.whenAllRegionsPresent || d.whenAllRegionsPresent.every(id => present.has(id)))
  return result
}

export type FinalRecipe = typeof recipe
