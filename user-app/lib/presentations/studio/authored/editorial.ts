import { z } from 'zod'

// ============================================================================
// ADAPTIVE RECIPE CONTRACT v3 — FIGMA SECTION 6:185
// 15 authored frames, content-agnostic, design-system-driven.
// Figma provides composition/geometry only. Runtime content comes from immutable
// input fragments; components, typography and colors come from the active MSP DS.
// This standalone contract includes semantic validation and presence resolution.
// The MSP adapter must still implement flex layout, font/asset loading, component
// measurements and final rendered-geometry validation. It is not a renderer.
// ============================================================================

export const RECIPE_ID = 'section-6-185-editorial-v3' as const
export const SOURCE_SECTION = '6:185' as const

export type Rect = { x: number; y: number; w: number; h: number }
export type Range = { min: number; preferred: number; max: number }
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type Axis = 'x' | 'y'
export type Strength = 'hard' | 'soft'
export type Emphasis = 'primary' | 'secondary'

export type TypographyRole =
  | 'display'
  | 'title'
  | 'support'
  | 'body'
  | 'metadata'
  | 'caption'
  | 'footer'
  | 'metric-value'
  | 'metric-caption'
  | 'quote'
  | 'quote-author'

export type SemanticBlockType =
  | 'text'
  | 'label'
  | 'metric'
  | 'fact'
  | 'quote'
  | 'list'
  | 'visual'

export type VisualType = 'photo' | 'illustration' | 'diagram' | 'abstract-graphic'

export type SemanticRole =
  | 'title'
  | 'support'
  | 'context'
  | 'year'
  | 'metadata'
  | 'body'
  | 'footer'
  | 'visual'

export type EdgeRef = {
  region: '$canvas' | string
  edge: Edge
  // Signed offset from the referenced edge, in canvas coordinates.
  // E.g. canvas bottom -49 is the bottom edge of the content safe area.
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
  // Relative to the group region. Used only as authored geometry guidance.
  referenceItems?: Rect[]
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
  content: RegionContent
}

export type DecorationSpec = {
  id: string
  preferredRect: Rect
  componentQuery: {
    semanticRole: string
    designSystem: 'active'
  }
  // Declarative predicate; no expression evaluation or model-provided code.
  whenAllRegionsPresent?: string[]
}

export type StateSignature = {
  title: 1
  support?: 0 | 1
  body?: { min: number; max: number }
  visual?: { min: number; max: number }
  context?: { min: number; max: number }
  year?: { min: number; max: number }
  metadata?: { min: number; max: number }
  footer?: { min: number; max: number }
}

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
  '1:2',
  '5:3',
  '6:6',
  '6:9',
  '6:18',
  '6:26',
  '6:39',
  '6:98',
  '6:43',
  '6:65',
  '6:84',
  '6:114',
  '6:130',
  '6:150',
  '6:165',
] as const

export type SourceFrameId = (typeof SOURCE_FRAMES)[number]

export const MODE_IDS = [
  'title-only',
  'title-support',
  'semantic-graphic',
  'context-title',
  'dense-editorial',
  'text-heavy',
  'single-visual',
  'visual-mosaic',
] as const

export type ModeId = (typeof MODE_IDS)[number]

const CANVAS = { width: 1920, height: 1080 } as const
const SAFE = { left: 46, right: 46, top: 49, bottom: 49 } as const
const INITIAL_SCALE_SAMPLES = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3] as const

const snap4 = (n: number) => Math.round(n / 4) * 4
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export const scale30 = (value: number, minCap = 0, maxCap = Number.POSITIVE_INFINITY): Range => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(minCap) || minCap < 0 ||
      !(Number.isFinite(maxCap) || maxCap === Number.POSITIVE_INFINITY)) {
    throw new Error('Invalid base dimension or caps')
  }
  // Round inwards: rounding to nearest could exceed the promised +/-30%.
  const min = Math.ceil(Math.max(value * 0.7, minCap) / 4) * 4
  const max = Math.floor(Math.min(value * 1.3, maxCap) / 4) * 4
  if (min > max || value < min || value > max) throw new Error('Infeasible dimension range')
  return { min, preferred: value, max }
}

/** Fit an adapted dimension to the complete 4px grid, not just 10% samples. */
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
const top = (offset: number = SAFE.top): Anchor => ({ edge: 'top', to: '$canvas', offset, strength: 'hard' })
const bottom = (offset: number = SAFE.bottom): Anchor => ({ edge: 'bottom', to: '$canvas', offset, strength: 'hard' })

const gap = (
  id: string,
  axis: Axis,
  from: EdgeRef,
  to: EdgeRef,
  g: Range,
  strength: Strength = 'hard',
): LayoutRelation => ({ id, kind: 'gap', axis, from, to, gap: g, strength })

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
const canvasRef = (edge: Edge): EdgeRef => ({ region: '$canvas', edge })

const textPolicy = (typographyRole: TypographyRole): TextPolicy => ({
  typographyRole,
  fontStepPx: 4,
  minScale: 0.7,
  maxScale: 1.3,
  lineHeight: 'design-system-coupled',
  adaptationPhase: 'last-resort',
})

const visualFit: VisualFitPolicy = {
  photo: 'cover', illustration: 'contain', diagram: 'contain', 'abstract-graphic': 'contain',
}

const emphasisPolicy = (role: SemanticRole): RegionContent['emphasis'] =>
  role === 'title'
    ? { allowed: ['primary'], preferred: 'primary', maxPrimaryItems: 1 }
    : role === 'body' || role === 'support'
      ? { allowed: ['primary', 'secondary'], preferred: 'secondary', maxPrimaryItems: 1 }
      : { allowed: ['secondary'], preferred: 'secondary', maxPrimaryItems: 0 }

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
): RegionSpec => ({
  id,
  preferredRect: rect,
  size: size30(rect, caps),
  anchors,
  flex,
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

const contextRegion = (rect: Rect): RegionSpec =>
  plainTextRegion('context', 'context', rect, 'metadata', false, [left(rect.x), top(rect.y)], ['text', 'label'])

const yearRegion = (rect: Rect): RegionSpec =>
  plainTextRegion('year', 'year', rect, 'metadata', false, [left(rect.x), top(rect.y)], ['text', 'label'])

const metadata3 = (y: number): RegionSpec => {
  const rect: Rect = { x: 46, y, w: 1277, h: 94 }
  return componentGroupRegion(
    'metadata',
    'metadata',
    rect,
    false,
    0,
    3,
    ['text', 'label', 'fact', 'metric'],
    [
      {
        id: 'metadata-row-1-3',
        direction: 'row',
        columns: 3,
        minItems: 1,
        maxItems: 3,
        gapX: range(24, 32, 48),
        gapY: fixed(0),
        referenceItems: [
          { x: 0, y: 0, w: 321, h: 94 },
          { x: 354, y: 0, w: 532, h: 94 },
          { x: 916, y: 0, w: 361, h: 94 },
        ],
      },
    ],
    'metadata-row-1-3',
    'metadata',
    [left(46)],
    { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 4, shrinkPriority: 4 } },
    false,
  )
}

const metadataWide = (): RegionSpec =>
  componentGroupRegion(
    'metadata',
    'metadata',
    { x: 46, y: 209, w: 910, h: 94 },
    false,
    0,
    1,
    ['text', 'label', 'fact', 'metric'],
    [
      {
        id: 'metadata-wide-1',
        direction: 'row',
        columns: 1,
        minItems: 1,
        maxItems: 1,
        gapX: fixed(0),
        gapY: fixed(0),
        referenceItems: [{ x: 0, y: 0, w: 910, h: 94 }],
      },
    ],
    'metadata-wide-1',
    'metadata',
    [left(46)],
    { width: { growPriority: 3, shrinkPriority: 3 }, height: { growPriority: 4, shrinkPriority: 4 } },
    false,
  )

const contextSeparator = (): DecorationSpec => ({
  id: 'context-separator',
  preferredRect: { x: 444, y: 78, w: 118, h: 0 },
  componentQuery: { semanticRole: 'context-separator', designSystem: 'active' },
  whenAllRegionsPresent: ['context', 'year'],
})

const bodyGroupLayouts: GroupLayout[] = [
  {
    id: 'body-columns-2',
    direction: 'row',
    columns: 2,
    minItems: 2,
    maxItems: 2,
    gapX: range(24, 32, 48),
    gapY: fixed(0),
    referenceItems: [
      { x: 0, y: 0, w: 794, h: 342 },
      { x: 826, y: 0, w: 1002, h: 304 },
    ],
  },
  {
    id: 'body-column-1',
    direction: 'column',
    columns: 1,
    minItems: 1,
    maxItems: 2,
    gapX: fixed(0),
    gapY: range(24, 32, 48),
  },
]

const visualMosaic3Layout: GroupLayout = {
  id: 'visual-mosaic-3',
  direction: 'mosaic',
  columns: 2,
  minItems: 3,
  maxItems: 3,
  gapX: fixed(32),
  gapY: fixed(32),
  referenceItems: [
    { x: 0, y: 0, w: 380, h: 817 },
    { x: 412, y: 0, w: 384, h: 457 },
    { x: 412, y: 489, w: 384, h: 328 },
  ],
}

const titleBottomState = (
  id: string,
  sourceFrame: SourceFrameId,
  densityRank: number,
  rect: Rect,
): AuthoredState => ({
  id,
  modeId: 'title-only',
  sourceFrame,
  densityRank,
  signature: { title: 1, support: 0, body: { min: 0, max: 0 }, visual: { min: 0, max: 0 } },
  regions: [
    plainTextRegion(
      'title',
      'title',
      rect,
      'display',
      true,
      [left(rect.x), bottom(CANVAS.height - (rect.y + rect.h))],
      ['text'],
      { maxW: CANVAS.width - rect.x - SAFE.right },
      { width: { growPriority: 1, shrinkPriority: 2 }, height: { growPriority: 1, shrinkPriority: 2 } },
    ),
  ],
  relations: [],
  elasticGaps: [],
})

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
      caption: { required: true },
      note: { required: false },
    },
    componentQuery: {
      semanticRole: 'metric',
      requiredFields: ['value', 'caption'],
      allowedLayouts: ['vertical', 'horizontal', 'compact'],
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
      allowedLayouts: ['panel', 'inline', 'compact'],
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
      fieldTypography: { text: 'body', caption: 'caption' },
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
// COMPLETE 15-STATE RECIPE
// ============================================================================

export const states: AuthoredState[] = [
  // 1 — Frame 1 / 1:2
  titleBottomState('title-01', '1:2', 1, { x: 46, y: 805, w: 1709, h: 223 }),

  // 2 — Frame 2 / 5:3
  titleBottomState('title-02', '5:3', 2, { x: 46, y: 683, w: 1651, h: 348 }),

  // 3 — Frame 3 / 6:6
  titleBottomState('title-03', '6:6', 3, { x: 46, y: 509, w: 1828, h: 522 }),

  // 4 — Frame 4 / 6:9
  titleBottomState('title-04', '6:9', 4, { x: 46, y: 335, w: 1828, h: 696 }),

  // 5 — Frame 8 / 6:18
  titleBottomState('title-05', '6:18', 5, { x: 46, y: 287, w: 1828, h: 744 }),

  // 6 — Frame 9 / 6:26
  {
    id: 'title-support-01',
    modeId: 'title-support',
    sourceFrame: '6:26',
    densityRank: 1,
    signature: { title: 1, support: 1, body: { min: 0, max: 0 }, visual: { min: 0, max: 0 } },
    regions: [
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 420, w: 1826, h: 348 },
        'display',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 800, w: 1826, h: 231 },
        'support',
        true,
        [left(), right(), bottom(49)],
        ['text'],
        undefined,
        { height: { growPriority: 3, shrinkPriority: 3 } },
      ),
    ],
    relations: [gap('title-support-gap', 'y', ref('title', 'bottom'), ref('support', 'top'), range(16, 32, 48))],
    elasticGaps: [
      elastic('top-title-reserve', 'y', canvasRef('top'), ref('title', 'top'), range(49, 371, 520), 1, 1),
    ],
  },

  // 7 — Frame 10 / 6:39
  {
    id: 'title-support-02',
    modeId: 'title-support',
    sourceFrame: '6:39',
    densityRank: 2,
    signature: { title: 1, support: 1, body: { min: 0, max: 0 }, visual: { min: 0, max: 0 } },
    regions: [
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 246, w: 1828, h: 522 },
        'display',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 800, w: 1826, h: 231 },
        'support',
        true,
        [left(), right(), bottom(49)],
        ['text'],
        undefined,
        { height: { growPriority: 3, shrinkPriority: 3 } },
      ),
    ],
    relations: [gap('title-support-gap', 'y', ref('title', 'bottom'), ref('support', 'top'), range(16, 32, 48))],
    elasticGaps: [
      elastic('top-title-reserve', 'y', canvasRef('top'), ref('title', 'top'), range(49, 197, 320), 1, 1),
    ],
  },

  // 8 — Frame 14 / 6:98
  {
    id: 'semantic-graphic-01',
    modeId: 'semantic-graphic',
    sourceFrame: '6:98',
    densityRank: 1,
    signature: { title: 1, support: 1, body: { min: 0, max: 0 }, visual: { min: 1, max: 1 } },
    regions: [
      visualRegion(
        'visual',
        { x: 46, y: 49, w: 1828, h: 416 },
        true,
        [left(), right(), top()],
        { height: { growPriority: 3, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 497, w: 1826, h: 348 },
        'display',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 877, w: 1828, h: 77 },
        'support',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 2, shrinkPriority: 3 } },
      ),
    ],
    relations: [
      gap('visual-title-gap', 'y', ref('visual', 'bottom'), ref('title', 'top'), range(24, 32, 48)),
      gap('title-support-gap', 'y', ref('title', 'bottom'), ref('support', 'top'), range(24, 32, 48)),
    ],
    elasticGaps: [
      elastic('support-bottom-reserve', 'y', ref('support', 'bottom'), canvasRef('bottom'), range(49, 126, 168), 1, 1),
    ],
  },

  // 9 — Frame 11 / 6:43
  {
    id: 'context-title-01',
    modeId: 'context-title',
    sourceFrame: '6:43',
    densityRank: 1,
    signature: {
      title: 1,
      support: 0,
      body: { min: 0, max: 0 },
      visual: { min: 0, max: 0 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 3 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadata3(378),
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 509, w: 1828, h: 522 },
        'display',
        true,
        [left(), right(), bottom(49)],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 2 } },
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 37, 48)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(96, 271, 360), 1, 1),
    ],
    decorations: [contextSeparator()],
  },

  // 10 — Frame 12 / 6:65
  {
    id: 'context-title-support-01',
    modeId: 'context-title',
    sourceFrame: '6:65',
    densityRank: 2,
    signature: {
      title: 1,
      support: 1,
      body: { min: 0, max: 0 },
      visual: { min: 0, max: 0 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 3 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadata3(374),
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 505, w: 1828, h: 280 },
        'title',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 800, w: 1826, h: 231 },
        'support',
        true,
        [left(), right(), bottom(49)],
        ['text'],
        undefined,
        { height: { growPriority: 3, shrinkPriority: 3 } },
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 37, 48)),
      gap('title-support-gap', 'y', ref('title', 'bottom'), ref('support', 'top'), range(12, 15, 40)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(96, 267, 360), 1, 1),
    ],
    decorations: [contextSeparator()],
  },

  // 11 — Frame 13 / 6:84
  {
    id: 'context-title-support-02',
    modeId: 'context-title',
    sourceFrame: '6:84',
    densityRank: 3,
    signature: {
      title: 1,
      support: 1,
      body: { min: 0, max: 0 },
      visual: { min: 0, max: 0 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 3 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadata3(233),
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 368, w: 1828, h: 400 },
        'title',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 800, w: 1826, h: 231 },
        'support',
        true,
        [left(), right(), bottom(49)],
        ['text'],
        undefined,
        { height: { growPriority: 3, shrinkPriority: 3 } },
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 41, 52)),
      gap('title-support-gap', 'y', ref('title', 'bottom'), ref('support', 'top'), range(16, 32, 48)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(96, 126, 360), 1, 1),
    ],
    decorations: [contextSeparator()],
  },

  // 12 — Frame 15 / 6:114
  {
    id: 'dense-editorial-01',
    modeId: 'dense-editorial',
    sourceFrame: '6:114',
    densityRank: 1,
    signature: {
      title: 1,
      support: 0,
      body: { min: 1, max: 2 },
      visual: { min: 0, max: 0 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 3 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadata3(209),
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 340, w: 1828, h: 280 },
        'title',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 3 } },
      ),
      componentGroupRegion(
        'body-group',
        'body',
        { x: 46, y: 652, w: 1828, h: 342 },
        true,
        1,
        2,
        ['text', 'metric', 'fact', 'quote', 'list'],
        bodyGroupLayouts,
        'body-columns-2',
        'body',
        [left(), right(), bottom(86)],
        {
          width: { growPriority: 4, shrinkPriority: 4 },
          // Explicitly allowed: title can take vertical space from this region.
          height: { growPriority: 2, shrinkPriority: 1 },
        },
        true,
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 37, 48)),
      gap('title-body-gap', 'y', ref('title', 'bottom'), ref('body-group', 'top'), range(24, 32, 48)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(64, 102, 180), 2, 2),
    ],
    decorations: [contextSeparator()],
    notes: [
      'body-group may use 1 or 2 columns only through its declared allowedLayouts; Qwen never invents geometry.',
      'When title grows, body-group height is the first shrinkable vertical region; its content is reflowed and remeasured.',
    ],
  },

  // 13 — Frame 16 / 6:130
  {
    id: 'text-heavy-01',
    modeId: 'text-heavy',
    sourceFrame: '6:130',
    densityRank: 1,
    signature: {
      title: 1,
      support: 1,
      body: { min: 0, max: 0 },
      visual: { min: 0, max: 0 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 1 },
      footer: { min: 0, max: 1 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadataWide(),
      plainTextRegion(
        'title',
        'title',
        { x: 46, y: 340, w: 1828, h: 420 },
        'title',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 1, shrinkPriority: 3 } },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 792, w: 1828, h: 144 },
        'support',
        true,
        [left(), right()],
        ['text'],
        undefined,
        { height: { growPriority: 2, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'footer',
        'footer',
        { x: 46, y: 993, w: 794, h: 38 },
        'footer',
        false,
        [left(), bottom(49)],
        ['text', 'label'],
        undefined,
        { width: { growPriority: 4, shrinkPriority: 4 } },
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 37, 48)),
      gap('title-support-gap', 'y', ref('title', 'bottom'), ref('support', 'top'), range(24, 32, 48)),
      gap('support-footer-gap', 'y', ref('support', 'bottom'), ref('footer', 'top'), range(24, 57, 80)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(56, 102, 180), 2, 2),
      elastic('support-footer-reserve', 'y', ref('support', 'bottom'), ref('footer', 'top'), range(24, 57, 80), 1, 1),
    ],
    decorations: [contextSeparator()],
  },

  // 14 — Frame 17 / 6:150
  {
    id: 'single-visual-01',
    modeId: 'single-visual',
    sourceFrame: '6:150',
    densityRank: 1,
    signature: {
      title: 1,
      support: 1,
      body: { min: 0, max: 0 },
      visual: { min: 1, max: 1 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 1 },
      footer: { min: 0, max: 1 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadataWide(),
      plainTextRegion(
        'title',
        'title',
        // Authored reference preserved. Runtime no-overlap relation below makes
        // the actual title width shrink/reflow instead of overlapping visual.
        { x: 46, y: 340, w: 1049, h: 216 },
        'title',
        true,
        [left()],
        ['text'],
        undefined,
        {
          width: { growPriority: 3, shrinkPriority: 1 },
          height: { growPriority: 1, shrinkPriority: 3 },
        },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 745, w: 910, h: 216 },
        'support',
        true,
        [left()],
        ['text'],
        undefined,
        { width: { growPriority: 4, shrinkPriority: 4 }, height: { growPriority: 2, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'footer',
        'footer',
        { x: 46, y: 993, w: 794, h: 38 },
        'footer',
        false,
        [left(), bottom(49)],
        ['text', 'label'],
      ),
      visualRegion(
        'visual',
        { x: 1021, y: 16, w: 883, h: 1048 },
        true,
        [right(16), top(16), bottom(16)],
        { width: { growPriority: 4, shrinkPriority: 2 }, height: { growPriority: 4, shrinkPriority: 4 } },
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 37, 48)),
      gap('support-footer-gap', 'y', ref('support', 'bottom'), ref('footer', 'top'), range(24, 32, 48)),
      // Fixes the authored 74px overlap without discarding authored geometry.
      gap('title-visual-no-overlap', 'x', ref('title', 'right'), ref('visual', 'left'), range(24, 32, 48)),
      gap('support-visual-gap', 'x', ref('support', 'right'), ref('visual', 'left'), range(24, 65, 96)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(56, 102, 180), 3, 3),
      elastic('title-support-reserve', 'y', ref('title', 'bottom'), ref('support', 'top'), range(48, 189, 260), 1, 1),
    ],
    decorations: [contextSeparator()],
    notes: [
      'Authored title and visual overlap by 74px; runtime relation title-visual-no-overlap is hard and wins.',
      'The solver should prefer shrinking/reflowing title width before shrinking the visual because title width shrinkPriority is higher.',
    ],
  },

  // 15 — Frame 18 / 6:165
  {
    id: 'visual-mosaic-01',
    modeId: 'visual-mosaic',
    sourceFrame: '6:165',
    densityRank: 1,
    signature: {
      title: 1,
      support: 1,
      body: { min: 0, max: 0 },
      visual: { min: 3, max: 3 },
      context: { min: 0, max: 1 },
      year: { min: 0, max: 1 },
      metadata: { min: 0, max: 1 },
      footer: { min: 0, max: 1 },
    },
    regions: [
      contextRegion({ x: 46, y: 49, w: 380, h: 58 }),
      yearRegion({ x: 578, y: 49, w: 111, h: 58 }),
      metadataWide(),
      plainTextRegion(
        'title',
        'title',
        // Authored reference preserved; no-overlap relation below corrects
        // the actual runtime width.
        { x: 46, y: 340, w: 1049, h: 216 },
        'title',
        true,
        [left()],
        ['text'],
        undefined,
        {
          width: { growPriority: 3, shrinkPriority: 1 },
          height: { growPriority: 1, shrinkPriority: 3 },
        },
      ),
      plainTextRegion(
        'support',
        'support',
        { x: 46, y: 745, w: 910, h: 216 },
        'support',
        true,
        [left()],
        ['text'],
        undefined,
        { width: { growPriority: 4, shrinkPriority: 4 }, height: { growPriority: 2, shrinkPriority: 2 } },
      ),
      plainTextRegion(
        'footer',
        'footer',
        { x: 46, y: 993, w: 794, h: 38 },
        'footer',
        false,
        [left(), bottom(49)],
        ['text', 'label'],
      ),
      componentGroupRegion(
        'visual-group',
        'visual',
        { x: 1051, y: 213, w: 796, h: 817 },
        true,
        3,
        3,
        ['visual'],
        [visualMosaic3Layout],
        'visual-mosaic-3',
        'caption',
        [left(1051)],
        { width: { growPriority: 4, shrinkPriority: 2 }, height: { growPriority: 4, shrinkPriority: 4 } },
        false,
      ),
    ],
    relations: [
      gap('metadata-title-gap', 'y', ref('metadata', 'bottom'), ref('title', 'top'), range(24, 37, 48)),
      gap('support-footer-gap', 'y', ref('support', 'bottom'), ref('footer', 'top'), range(24, 32, 48)),
      // Fixes the authored 44px overlap.
      gap('title-visual-no-overlap', 'x', ref('title', 'right'), ref('visual-group', 'left'), range(24, 32, 48)),
      gap('support-visual-gap', 'x', ref('support', 'right'), ref('visual-group', 'left'), range(48, 95, 128)),
    ],
    elasticGaps: [
      elastic('context-metadata-reserve', 'y', ref('context', 'bottom'), ref('metadata', 'top'), range(56, 102, 180), 3, 3),
      elastic('title-support-reserve', 'y', ref('title', 'bottom'), ref('support', 'top'), range(48, 189, 260), 1, 1),
    ],
    decorations: [
      {
        id: 'background-surface',
        preferredRect: { x: 16, y: 16, w: 1888, h: 1048 },
        componentQuery: { semanticRole: 'slide-surface-inverse', designSystem: 'active' },
      },
      contextSeparator(),
    ],
    notes: [
      'visual-group supports exactly 3 visuals and exactly visual-mosaic-3; executor must not invent 1/2-image layouts.',
      'For every visual item, diagram/illustration/abstract-graphic use contain; photo may use cover.',
    ],
  },
]

export const recipe = {
  id: RECIPE_ID,
  version: 3,
  sourceSection: SOURCE_SECTION,

  canvas: CANVAS,
  safeArea: SAFE,

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
    // A gap and an elasticGap with the same endpoints are one distance, never
    // two spacers. Their valid ranges must be intersected by the executor.
  },

  optionalRegions: {
    policy: 'remove-empty-regions-before-solving',
    resolver: 'resolvePresentState',
    missingContext: 'reference-year-if-present-otherwise-safe-area-top',
    missingMetadata: 'bridge-neighbours-with-maximum-of-adjacent-gap-ranges',
    missingFooter: 'allow-preceding-content-to-expand-toward-safe-area-bottom',
    decorations: 'keep-only-if-all-required-regions-are-present',
  },

  emphasis: {
    choices: ['primary', 'secondary'],
    styleSource: 'active-design-system-role-and-emphasis-profile',
    missingProfile: 'reject-before-model-call',
    // The adapter supplies measured profiles; the model never supplies sizes.
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
    { id: 'title-only', states: ['title-01', 'title-02', 'title-03', 'title-04', 'title-05'] },
    { id: 'title-support', states: ['title-support-01', 'title-support-02'] },
    { id: 'semantic-graphic', states: ['semantic-graphic-01'] },
    { id: 'context-title', states: ['context-title-01', 'context-title-support-01', 'context-title-support-02'] },
    { id: 'dense-editorial', states: ['dense-editorial-01'] },
    { id: 'text-heavy', states: ['text-heavy-01'] },
    { id: 'single-visual', states: ['single-visual-01'] },
    { id: 'visual-mosaic', states: ['visual-mosaic-01'] },
  ] as const,

  states,
} as const

// ============================================================================
// QWEN STRUCTURAL ASSIGNMENT CONTRACT
// Qwen may choose semantic structure, mode, region assignment, declared group
// layout and one of executor-provided measured component variants.
// It never returns coordinates, dimensions, font sizes or arbitrary IDs.
// ============================================================================

export const FALLBACK_REASONS = [
  'no-compatible-component',
  'component-does-not-fit',
  'component-field-contract-mismatch',
] as const
export type FallbackReason = (typeof FALLBACK_REASONS)[number]
export type FieldBinding = { sourceRefs: readonly string[] }

/** Immutable source fragment IDs; the executor resolves their exact content.
 * `visualType` is metadata, not a fragment to render or count as content.
 * For a list, each reference in `items` is an ordered source list item.
 */
export type BlockBinding = {
  regionId: string
  type: SemanticBlockType
  sourceRefs: readonly string[]
  fields: Readonly<Record<string, FieldBinding | VisualType>>
  emphasis: Emphasis
}

/** Trusted executor output, scoped to an exact binding, state and group layout.
 * These are measured candidates, not the unfiltered library catalogue.
 * If the final flex bounds change, the adapter MUST remeasure the component.
 */
export type MeasuredComponentVariant = BlockBinding & {
  id: string
  componentId: string
  designSystemId: string
  stateIds: readonly string[]
  layoutId: string | null
}

/** A fallback is backed by the executor's completed search/measurement.
 * A missing evidence entry never means "there are no compatible components".
 */
export type FallbackEvidence = BlockBinding & {
  designSystemId: string
  stateIds: readonly string[]
  layoutId: string | null
  reason: FallbackReason
}

export type QwenSchemaContext = {
  designSystemId: string
  sourceRefs: readonly [string, ...string[]]
  // Default: each supplied fragment must be used exactly once. An explicit
  // content-graph requirement may permit repetitions; the model cannot do so.
  sourceUseCounts?: Readonly<Record<string, number>>
  componentVariants: readonly MeasuredComponentVariant[]
  fallbackEvidence: readonly FallbackEvidence[]
  visualAssets: readonly { sourceRef: string; assetId: string; visualType: VisualType }[]
}

const allRegionIds = [
  'title',
  'support',
  'context',
  'year',
  'metadata',
  'body-group',
  'footer',
  'visual',
  'visual-group',
] as const

const allGroupLayoutIds = [
  'metadata-row-1-3',
  'metadata-wide-1',
  'body-columns-2',
  'body-column-1',
  'visual-mosaic-3',
] as const

export function createQwenAssignmentSchema(ctx: QwenSchemaContext) {
  assertContext(ctx)
  const sourceRef = z.enum(ctx.sourceRefs)
  const fieldBinding = z.object({ sourceRefs: z.array(sourceRef).min(1) }).strict()
  const primitive = z.object({ kind: z.literal('primitive'), reason: z.enum(FALLBACK_REASONS).nullable() }).strict()
  const asset = z.object({ kind: z.literal('asset') }).strict()
  const variantIds = ctx.componentVariants.map(v => v.id)
  // With an empty catalogue the component branch does not exist at all;
  // primitive and asset responses remain valid, without a fake placeholder ID.
  const render = variantIds.length
    ? z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('component'), variantId: z.enum(variantIds as [string, ...string[]]) }).strict(),
        primitive, asset,
      ])
    : z.discriminatedUnion('kind', [primitive, asset])
  const common = {
    regionId: z.enum(allRegionIds),
    sourceRefs: z.array(sourceRef).min(1),
    emphasis: z.enum(['primary', 'secondary']),
    render,
  }
  // Required fields and allowed field names are enforced by the schema itself.
  // This also exposes the real field contract to Qwen's JSON grammar.
  const assignment = z.discriminatedUnion('type', [
    z.object({ ...common, type: z.literal('text'), fields: z.object({ text: fieldBinding }).strict() }).strict(),
    z.object({ ...common, type: z.literal('label'), fields: z.object({ text: fieldBinding }).strict() }).strict(),
    z.object({ ...common, type: z.literal('metric'), fields: z.object({
      value: fieldBinding, caption: fieldBinding, note: fieldBinding.optional(),
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('fact'), fields: z.object({
      text: fieldBinding, caption: fieldBinding.optional(),
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('quote'), fields: z.object({
      quote: fieldBinding, author: fieldBinding.optional(), source: fieldBinding.optional(),
    }).strict() }).strict(),
    z.object({ ...common, type: z.literal('list'), fields: z.object({ items: fieldBinding }).strict() }).strict(),
    z.object({ ...common, type: z.literal('visual'), fields: z.object({
      assetRef: z.object({ sourceRefs: z.array(sourceRef).length(1) }).strict(),
      visualType: z.enum(['photo', 'illustration', 'diagram', 'abstract-graphic']),
    }).strict() }).strict(),
  ])

  return z
    .object({
      modeId: z.enum(MODE_IDS),
      assignments: z.array(assignment).min(1),
      groupChoices: z
        .array(
          z
            .object({
              regionId: z.enum(['metadata', 'body-group', 'visual-group']),
              layoutId: z.enum(allGroupLayoutIds),
            })
            .strict(),
        )
        .default([]),
    })
    .strict()
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
  }
  for (const a of ctx.visualAssets) {
    if (!a.assetId || !ctx.sourceRefs.includes(a.sourceRef)) issues.push('invalid-visual-source')
  }
  if (issues.length) throw new RecipeAssignmentError(issues)
}

function fieldRefs(fields: BlockBinding['fields']): string[] {
  return Object.values(fields).flatMap(value => typeof value === 'string' ? [] : [...value.sourceRefs])
}

function sameRefs(a: readonly string[], b: readonly string[]): boolean {
  const sortedB = [...b].sort()
  return a.length === b.length && [...a].sort().every((id, i) => id === sortedB[i])
}

// Ignore object-key order, but preserve ordering within each field/list.
function bindingKey(b: BlockBinding): string {
  return JSON.stringify([b.regionId, b.type, b.emphasis, [...b.sourceRefs].sort(),
    Object.entries(b.fields).filter(([, value]) => value !== undefined).sort(([a], [c]) => a.localeCompare(c))])
}

/** Validate meaning and candidate scope after parsing the JSON shape.
 * Success proves contract compatibility, not rendered fit or visual quality.
 * The executor selects a state from `compatibleStateIds`, resolves presence,
 * solves flex geometry, remeasures with loaded DS fonts and validates the PNG/DOM.
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
    } else if (b.sourceRefs.some(id => ctx.visualAssets.some(a => a.sourceRef === id))) issues.push(`asset-used-as-text:${b.regionId}`)
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
      if (!region?.content.group || !assignment.assignments.some(a => a.regionId === c.regionId)) problems.push(`orphan-group-choice:${c.regionId}`)
    }
    for (const region of state.regions) {
      const items = assignment.assignments.filter(a => a.regionId === region.id)
      const policy = region.content
      if (items.length < policy.minItems || items.length > policy.maxItems || (policy.required && !items.length)) problems.push(`region-count:${region.id}`)
      if (items.filter(i => i.emphasis === 'primary').length > policy.emphasis.maxPrimaryItems) problems.push(`too-many-primary-items:${region.id}`)
      if (policy.group && items.length) {
        const layoutId = choiceByRegion.get(region.id)
        const layout = policy.group.allowedLayouts.find(l => l.id === layoutId)
        if (!layout || items.length < layout.minItems || items.length > layout.maxItems) problems.push(`invalid-group-layout:${region.id}`)
        if (!policy.group.qwenMayChooseLayout && layoutId !== policy.group.preferredLayoutId) problems.push(`fixed-group-layout:${region.id}`)
      }
    }
    for (const role of ['title', 'support', 'context', 'year', 'metadata', 'body', 'footer', 'visual'] as const) {
      const count = assignment.assignments.filter(a => state.regions.find(r => r.id === a.regionId)?.content.role === role).length
      const rule = state.signature[role]
      const min = typeof rule === 'number' ? rule : rule?.min ?? 0
      const max = typeof rule === 'number' ? rule : rule?.max ?? 0
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
      const render = b.render
      if (render.kind === 'component') {
        if (!contract.componentQuery || !fits.some(v => v.id === render.variantId)) problems.push(`component-not-measured-for-block:${b.regionId}`)
      } else if (render.kind === 'asset') {
        if (b.type !== 'visual' || !region.content.visualFit) problems.push(`asset-not-allowed:${b.regionId}`)
      } else {
        if (b.type === 'visual') problems.push(`visual-must-use-asset:${b.regionId}`)
        const needsEvidence = region.content.componentPriority === 'component-first' && contract.componentQuery !== null
        if (needsEvidence) {
          if (!render.reason) problems.push(`fallback-reason-required:${b.regionId}`)
          if (fits.length) problems.push(`compatible-component-must-be-used:${b.regionId}`)
          if (!ctx.fallbackEvidence.some(e => matches(e) && e.reason === render.reason)) problems.push(`fallback-not-supported-by-executor:${b.regionId}`)
        } else if (render.reason !== null) problems.push(`direct-primitive-must-have-null-reason:${b.regionId}`)
      }
    }
    if (problems.length) rejected.push(...problems.map(p => `${state.id}:${p}`))
    else compatibleStateIds.push(state.id)
  }
  if (!compatibleStateIds.length) throw new RecipeAssignmentError(['no-compatible-state', ...rejected])
  return { assignment, compatibleStateIds, requiresRenderedValidation: true }
}

/** Remove unfilled optional regions and reconnect the known editorial flow.
 * No supplied content is removed: call ONLY after validateQwenAssignment, with
 * the chosen compatible state and the assignment's actual region IDs.
 * Returns a copy; the 15 authored states are never mutated.
 */
export function resolvePresentState(state: AuthoredState, presentRegionIds: readonly string[]): AuthoredState {
  const present = new Set(presentRegionIds)
  if ([...present].some(id => !state.regions.some(r => r.id === id))) throw new Error('Unknown present region')
  if (state.regions.some(r => r.content.required && !present.has(r.id))) throw new Error('Required region is absent')
  const result = structuredClone(state)
  const exists = (edge: EdgeRef) => edge.region === '$canvas' || present.has(edge.region)

  // The context row can contain year alone. If both are absent, the next
  // region is related to the safe-area top, not to a deleted node.
  if (!present.has('context')) {
    const substitute = (edge: EdgeRef): EdgeRef => edge.region !== 'context' ? edge
      : present.has('year') ? ref('year', 'bottom') : { region: '$canvas', edge: 'top', offset: SAFE.top }
    result.relations = result.relations.map(r => ({ ...r, from: substitute(r.from), to: substitute(r.to) }))
    result.elasticGaps = result.elasticGaps.map(r => ({ ...r, from: substitute(r.from), to: substitute(r.to) }))
  }

  if (!present.has('metadata')) {
    const edges = [
      ...result.relations.filter((r): r is Extract<LayoutRelation, { kind: 'gap' }> => r.kind === 'gap')
        .map(r => ({ ...r, range: r.gap, shrinkPriority: undefined as number | undefined, growPriority: undefined as number | undefined })),
      ...result.elasticGaps,
    ]
    const incoming = edges.filter(e => e.to.region === 'metadata')
    const outgoing = edges.filter(e => e.from.region === 'metadata')
    result.relations = result.relations.filter(r => r.from.region !== 'metadata' && r.to.region !== 'metadata')
    result.elasticGaps = result.elasticGaps.filter(r => r.from.region !== 'metadata' && r.to.region !== 'metadata')
    for (const a of incoming) for (const b of outgoing) {
      if (a.axis !== b.axis) throw new Error('Cannot collapse metadata across axes')
      // One gap remains; the metadata height and a redundant adjacent gap are
      // released. Existing whitespace remains available as an elastic reserve.
      const merged = range(Math.max(a.range.min, b.range.min), Math.max(a.range.preferred, b.range.preferred), Math.max(a.range.max, b.range.max))
      const id = `without-metadata:${a.id}:${b.id}`
      if (a.shrinkPriority !== undefined || b.shrinkPriority !== undefined) {
        result.elasticGaps.push(elastic(id, a.axis, a.from, b.to, merged,
          Math.min(a.shrinkPriority ?? Infinity, b.shrinkPriority ?? Infinity),
          Math.min(a.growPriority ?? Infinity, b.growPriority ?? Infinity)))
      } else result.relations.push(gap(id, a.axis, a.from, b.to, merged))
    }
  }

  if (!present.has('footer')) {
    const predecessors = new Set([...result.relations, ...result.elasticGaps]
      .filter(r => r.axis === 'y' && r.to.region === 'footer').map(r => r.from.region))
    for (const id of predecessors) {
      const r = result.regions.find(n => n.id === id)
      if (r && present.has(id)) {
        r.anchors = r.anchors.filter(a => a.edge !== 'bottom')
        // Reclaim footer space without forcing short content to stretch all
        // the way down. A hard bottom anchor can make the +/-30% limits
        // infeasible when both the header and footer are absent.
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
