/** Single-file edition of section-39-514 v6.0.0.
 * Four recipe families; all 19 source frames. Source and tests in the companion ZIP.
 * No fonts, example content, icons or assets from Figma are embedded.
 * This is a recipe/validation/render-plan contract, NOT an integrated MSP renderer.
 */
// ===== core.ts =====
/**
 * MSP adaptive recipe contract. Derived from the reviewed section-33-223 v5.
 * This module compiles and validates contracts, NOT pixels. No model-written
 * geometry/content, Figma fonts, colors, icons or example strings are executed.
 * Runtime parsing is dependency-free. zod-adapter.ts binds the SAME validation
 * to the host's Zod instance; jsonSchema is the model's constrained grammar.
 */
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type Range = {
    min: number;
    preferred: number;
    max: number;
};
export type Insets = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};
export type Direction = 'row' | 'column';
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Emphasis = 'primary' | 'secondary';
export type VisualType = 'photo' | 'illustration' | 'diagram' | 'abstract-graphic' | 'logo';
export type FieldBinding = {
    sourceRefs: readonly string[];
};
export type StructuredItemBinding = {
    sourceRefs: readonly string[];
    fields: Readonly<Record<string, FieldBinding>>;
};
export type NormalizedValue = FieldBinding | readonly StructuredItemBinding[] | VisualType;
export type NormalizedBlock = {
    id: string;
    type: string;
    allowedRoles: readonly string[];
    sequenceIndex: number;
    sourceRefs: readonly string[];
    fields: Readonly<Record<string, NormalizedValue>>;
};
export type FieldContract = {
    kind: 'single';
    required: boolean;
} | {
    kind: 'visual-type';
    required: boolean;
} | {
    kind: 'list';
    required: boolean;
    minItems: number;
    maxItems: number;
    itemFields: Readonly<Record<string, {
        required: boolean;
    }>>;
};
export type Flex = {
    grow?: number;
    shrink?: number;
    basis?: number | 'auto';
    growPriority?: number;
    shrinkPriority?: number;
};
export type EdgeDecoration = {
    id: string;
    edge: 'top' | 'bottom' | 'left' | 'right';
    role: string;
    preferredThicknessPx: number;
    clearancePx: number;
    /** Inset is part of the owner's box, not an overlapping absolute layer. */
    placement: 'inside-edge';
    when?: 'always' | 'not-first' | 'not-last';
};
export type InternalNode = {
    id: string;
    kind: 'field' | 'group' | 'repeat' | 'ornament';
    fieldPath?: string;
    typographyRole?: string;
    textAlign?: 'left' | 'center' | 'right';
    direction?: Direction;
    align?: Align;
    justify?: 'start' | 'center' | 'end' | 'space-between';
    gap?: Range;
    padding?: Insets;
    surfaceRole?: string;
    flex?: Flex;
    pushToEnd?: boolean;
    /** Default is fill only at the block root; descendants hug unless they grow. */
    heightMode?: 'fill' | 'hug';
    preferredWidth?: number;
    maxLines?: number;
    children?: readonly InternalNode[];
    item?: InternalNode;
    tail?: InternalNode;
    minItems?: number;
    maxItems?: number;
    columns?: number;
    readingOrder?: 'row-major' | 'column-major';
    /** Geometry-only shape from the active DS; never a literal glyph/icon. */
    ornamentRole?: string;
    ornamentSize?: {
        w: number;
        h: number;
    };
    decorations?: readonly EdgeDecoration[];
};
export type PrimitiveLayout = {
    id: string;
    root: InternalNode;
    listCounts?: Readonly<Record<string, {
        min: number;
        max: number;
    }>>;
};
export type BlockContract = {
    type: string;
    fields: Readonly<Record<string, FieldContract>>;
    queryRole: string | null;
    componentLayouts: readonly string[];
    primitiveLayouts: readonly PrimitiveLayout[];
};
export type ItemLayout = {
    id: string;
    columns: number;
    minItems: number;
    maxItems: number;
    gapX: Range;
    gapY: Range;
    align: Align;
    readingOrder: 'row-major' | 'column-major';
    /** New topology determines track width; it is NOT a 3x stretch of an old cell. */
    trackBasis: 'resolved-topology';
    preferredWeights?: readonly number[];
    /** Slot treatment belongs to this topology, never to a particular source ID. */
    itemPadding?: {
        first: Insets;
        middle: Insets;
        last: Insets;
    };
    betweenItemsRole?: string;
    borderEdges?: readonly ('top' | 'bottom')[];
    cellHeight?: {
        mode: 'hug' | 'fill' | 'reference';
        preferred?: number;
    };
};
export type Region = {
    id: string;
    sourceNode?: string;
    preferredRect: Rect;
    size: {
        width: Range;
        height: Range;
    };
    role: string;
    accepts: readonly string[];
    minItems: number;
    maxItems: number;
    priority: 'component-first' | 'primitive-first' | 'asset-only' | 'mixed-partners';
    typographyRole?: string;
    emphasis: readonly Emphasis[];
    maxPrimaryItems: number;
    layouts: readonly ItemLayout[];
    preferredLayoutId: string;
    /** Per-region internal topology variants, picked by executor, not model. */
    primitiveLayoutIds?: readonly string[];
    allowedVisualTypes?: readonly VisualType[];
};
export type ChildRef = {
    kind: 'group' | 'region';
    id: string;
    flex?: Flex;
    pushToEnd?: boolean;
    alignSelf?: Align;
    gapBefore?: Range;
    /** Insets are local to this child; a reference y-offset is not global position. */
    marginBeforeCrossPx?: number;
};
export type FlowSeparator = {
    id: string;
    afterId: string;
    beforeId: string;
    role: string;
    width: number;
    height: number;
    gap: number;
};
export type Group = {
    id: string;
    sourceNode?: string;
    preferredRect: Rect;
    size: {
        width: Range;
        height: Range;
    };
    direction: Direction;
    align: Align;
    justify: 'start' | 'center' | 'end' | 'space-between';
    gap: Range;
    padding: Insets;
    surfaceRole: string;
    children: readonly ChildRef[];
    decorations: readonly EdgeDecoration[];
    collapseEmpty: boolean;
    flex?: Flex;
    trailingSpace?: Range;
    flowSeparators?: readonly FlowSeparator[];
};
export type State = {
    id: string;
    familyId: string;
    modeId: string;
    sourceFrame: string;
    aliasOf?: string;
    canvas: {
        width: number;
        height: number;
    };
    rootGroupId: string;
    regions: readonly Region[];
    groups: readonly Group[];
    surfaceRole: string;
    /** Inferences/authorised extensions are explicit, not claimed to be Figma data. */
    adaptationNotes: readonly string[];
};
export type RecipeFamily = {
    id: string;
    name: string;
    modes: readonly {
        id: string;
        stateIds: readonly string[];
    }[];
};
export type Bundle = {
    id: string;
    revision: string;
    sourceSection: string;
    sourceFrames: readonly string[];
    contracts: Readonly<Record<string, BlockContract>>;
    families: readonly RecipeFamily[];
    states: readonly State[];
};
export const FALLBACK_REASONS = ['no-compatible-component', 'component-does-not-fit', 'component-field-contract-mismatch'] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];
export type RenderChoice = {
    kind: 'component';
    variantId: string;
} | {
    kind: 'primitive';
    reason: FallbackReason | null;
} | {
    kind: 'asset';
};
export type Assignment = {
    familyId: string;
    modeId: string;
    assignments: {
        blockId: string;
        regionId: string;
        emphasis: Emphasis;
        render: RenderChoice;
    }[];
};
export type StructuralAssignment = Omit<Assignment, 'assignments'> & {
    assignments: Omit<Assignment['assignments'][number], 'render'>[];
};
/** One exact state/region/slot/layout, NOT the Cartesian product of ID arrays. */
export type MeasurementScope = {
    blockId: string;
    blockKey: string;
    stateId: string;
    regionId: string;
    slotIndex: number;
    contentRevision: string;
    designSystemId: string;
    designSystemRevision: string;
    recipeRevision: string;
    structureKey: string;
    layoutKey: string;
    emphasis: Emphasis;
    measuredBox: Rect;
};
export type ComponentFieldBinding = {
    path: string;
    sourceRefs: readonly string[];
};
export type MeasuredComponentVariant = MeasurementScope & {
    id: string;
    componentId: string;
    fieldBindings: readonly ComponentFieldBinding[];
};
export type FallbackEvidence = MeasurementScope & {
    reason: FallbackReason;
    searchComplete: true;
};
export type QwenContext = {
    contentRevision: string;
    designSystemId: string;
    designSystemRevision: string;
    sourceRefs: readonly string[];
    sourceUseCounts?: Readonly<Record<string, number>>;
    blocks: readonly NormalizedBlock[];
    /** Trusted active-DS registry snapshot. The model never supplies this. */
    componentIds: readonly string[];
    componentFieldPaths: Readonly<Record<string, readonly string[]>>;
    componentVariants: readonly MeasuredComponentVariant[];
    fallbackEvidence: readonly FallbackEvidence[];
    visualAssets: readonly {
        blockId: string;
        sourceRef: string;
        assetId: string;
        visualType: VisualType;
    }[];
};
export type ExecutorChoices = {
    regionLayouts?: Readonly<Record<string, string>>;
    primitiveLayouts?: Readonly<Record<string, string>>;
    /** Measurement epoch changes whenever bounds, DS profiles or fitting change. */
    layoutRevision: string;
    /** Measured final per-block INNER boxes, after slot padding/decor reservations. */
    blockBoxes: Readonly<Record<string, Rect>>;
};
export class RecipeError extends Error {
    constructor(public readonly issues: readonly string[]) { super(issues.join('\n')); this.name = 'RecipeError'; }
}
export const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
export const fixed = (n: number): Range => ({ min: n, preferred: n, max: n });
export const range = (min: number, preferred: number, max: number): Range => ({ min, preferred, max });
export function scale30(v: number, minCap = 0, maxCap = Infinity): Range {
    if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(minCap) || minCap < 0 || !(Number.isFinite(maxCap) || maxCap === Infinity))
        throw new RecipeError(['invalid-dimension']);
    const min = Math.ceil(Math.max(.7 * v, minCap) / 4) * 4, max = Math.floor(Math.min(1.3 * v, maxCap) / 4) * 4;
    if (min > max || v < min || v > max)
        throw new RecipeError(['infeasible-dimension-range']);
    return { min, preferred: v, max };
}
export function fitDimension(requested: number, bounds: Range): number {
    if (![requested, bounds.min, bounds.max].every(Number.isFinite))
        throw new RecipeError(['nonfinite-dimension']);
    const min = Math.ceil(bounds.min / 4) * 4, max = Math.floor(bounds.max / 4) * 4;
    if (min > max)
        throw new RecipeError(['empty-4px-range']);
    return Math.max(min, Math.min(max, Math.round(requested / 4) * 4));
}
/** Includes the exact authored value even when off-grid; samples are not exhaustive. */
export function dimensionCandidates(bounds: Range): number[] {
    const values = [bounds.preferred];
    for (let n = Math.ceil(bounds.min / 4) * 4; n <= bounds.max; n += 4)
        if (n !== bounds.preferred)
            values.push(n);
    return values.sort((a, b) => Math.abs(a - bounds.preferred) - Math.abs(b - bounds.preferred) || a - b);
}
export function canonicalKey(value: unknown): string {
    const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk)
        : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, walk(x)])) : v;
    return JSON.stringify(walk(value));
}
export const normalizedBlockKey = (b: NormalizedBlock) => canonicalKey(b);
const visualTypes: readonly string[] = ['photo', 'illustration', 'diagram', 'abstract-graphic', 'logo'];
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strs = (v: unknown, nonempty = false): v is string[] => Array.isArray(v) && (!nonempty || v.length > 0) && v.every(str);
const unique = (v: readonly unknown[]) => new Set(v).size === v.length;
const validRect = (v: unknown): v is Rect => record(v) && ['x', 'y', 'w', 'h'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k])) && (v.w as number) > 0 && (v.h as number) > 0;
const sameRefs = (a: readonly string[], b: readonly string[]) => canonicalKey([...a].sort()) === canonicalKey([...b].sort());
const refsOf = (v: NormalizedValue): string[] => typeof v === 'string' ? [] : Array.isArray(v) ? v.flatMap(i => [...i.sourceRefs]) : [...(v as FieldBinding).sourceRefs];
function ownKeys(v: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
    for (const k of Object.keys(v))
        if (!allowed.includes(k))
            issues.push(`${path}:unknown-property:${k}`);
}
function parseBinding(v: unknown, path: string, issues: string[]): v is FieldBinding {
    if (!record(v) || !strs(v.sourceRefs, true)) {
        issues.push(`${path}:invalid-field-binding`);
        return false;
    }
    ownKeys(v, ['sourceRefs'], path, issues);
    if (!unique(v.sourceRefs))
        issues.push(`${path}:duplicate-field-ref`);
    return true;
}
/** Validate the trusted normalizer too: TypeScript readonly is not runtime safety. */
export function validateContext(bundle: Bundle, value: unknown): asserts value is QwenContext {
    const issues: string[] = [];
    if (!record(value))
        throw new RecipeError(['context:not-object']);
    ownKeys(value, ['contentRevision', 'designSystemId', 'designSystemRevision', 'sourceRefs', 'sourceUseCounts', 'blocks', 'componentIds', 'componentFieldPaths', 'componentVariants', 'fallbackEvidence', 'visualAssets'], 'context', issues);
    for (const k of ['contentRevision', 'designSystemId', 'designSystemRevision'])
        if (!str(value[k]))
            issues.push(`context:missing-${k}`);
    if (!strs(value.sourceRefs, true) || !unique(value.sourceRefs))
        issues.push('context:invalid-source-refs');
    if (!strs(value.componentIds) || !unique(value.componentIds))
        issues.push('context:invalid-component-registry');
    if (!record(value.componentFieldPaths))
        issues.push('context:missing-component-field-registry');
    else if (strs(value.componentIds)) {
        for (const id of value.componentIds)
            if (!strs(value.componentFieldPaths[id], true) || !unique(value.componentFieldPaths[id] as string[]))
                issues.push(`context:invalid-component-field-paths:${id}`);
        for (const id of Object.keys(value.componentFieldPaths))
            if (!value.componentIds.includes(id))
                issues.push(`context:fields-for-unregistered-component:${id}`);
    }
    for (const k of ['blocks', 'componentVariants', 'fallbackEvidence', 'visualAssets'])
        if (!Array.isArray(value[k]))
            issues.push(`context:${k}:not-array`);
    if (issues.length)
        throw new RecipeError(issues);
    const ctx = value as unknown as QwenContext;
    if (!ctx.blocks.length)
        issues.push('empty-normalized-blocks');
    if (!unique(ctx.blocks.map(b => b?.id)))
        issues.push('duplicate-block-id');
    if (!unique(ctx.blocks.map(b => b?.sequenceIndex)))
        issues.push('duplicate-sequence-index');
    const uses = new Map<string, number>();
    for (const unknownBlock of ctx.blocks) {
        if (!record(unknownBlock)) {
            issues.push('block:not-object');
            continue;
        }
        const b = unknownBlock as unknown as NormalizedBlock;
        ownKeys(unknownBlock, ['id', 'type', 'allowedRoles', 'sequenceIndex', 'sourceRefs', 'fields'], `block:${b.id}`, issues);
        if (!str(b.id) || !str(b.type) || !strs(b.allowedRoles, true) || !unique(b.allowedRoles) || !Number.isInteger(b.sequenceIndex) || b.sequenceIndex < 0 || !strs(b.sourceRefs, true) || !unique(b.sourceRefs) || !record(b.fields)) {
            issues.push(`block:${b.id}:invalid-shape`);
            continue;
        }
        const contract = Object.hasOwn(bundle.contracts, b.type) ? bundle.contracts[b.type] : undefined;
        if (!contract) {
            issues.push(`block:${b.id}:unknown-type`);
            continue;
        }
        const allRoles = new Set(bundle.states.flatMap(s => s.regions.map(r => r.role)));
        if (b.allowedRoles.some(r => !allRoles.has(r)))
            issues.push(`block:${b.id}:unknown-role`);
        if (!b.allowedRoles.some(role => bundle.states.some(s => s.regions.some(r => r.role === role && r.accepts.includes(b.type)))))
            issues.push(`block:${b.id}:no-compatible-role`);
        for (const name of Object.keys(b.fields))
            if (!Object.hasOwn(contract.fields, name))
                issues.push(`block:${b.id}:unknown-field:${name}`);
        const allRefs: string[] = [];
        for (const [name, spec] of Object.entries(contract.fields)) {
            const v = b.fields[name], p = `block:${b.id}:${name}`;
            if (v === undefined) {
                if (spec.required)
                    issues.push(`${p}:missing`);
                continue;
            }
            if (spec.kind === 'visual-type') {
                if (!visualTypes.includes(String(v)) || typeof v !== 'string')
                    issues.push(`${p}:invalid-visual-type`);
                continue;
            }
            if (spec.kind === 'single') {
                if (parseBinding(v, p, issues))
                    allRefs.push(...v.sourceRefs);
                continue;
            }
            if (!Array.isArray(v) || v.length < spec.minItems || v.length > spec.maxItems) {
                issues.push(`${p}:invalid-list-count`);
                continue;
            }
            for (const [i, item] of v.entries()) {
                if (!record(item) || !strs(item.sourceRefs, true) || !unique(item.sourceRefs) || !record(item.fields)) {
                    issues.push(`${p}:${i}:invalid-item`);
                    continue;
                }
                ownKeys(item, ['sourceRefs', 'fields'], `${p}:${i}`, issues);
                const ir: string[] = [];
                for (const f of Object.keys(item.fields))
                    if (!Object.hasOwn(spec.itemFields, f))
                        issues.push(`${p}:${i}:unknown-item-field:${f}`);
                for (const [f, rule] of Object.entries(spec.itemFields)) {
                    const iv = item.fields[f];
                    if (iv === undefined) {
                        if (rule.required)
                            issues.push(`${p}:${i}:${f}:missing`);
                        continue;
                    }
                    if (parseBinding(iv, `${p}:${i}:${f}`, issues))
                        ir.push(...iv.sourceRefs);
                }
                if (!sameRefs(ir, item.sourceRefs))
                    issues.push(`${p}:${i}:item-coverage`);
                allRefs.push(...item.sourceRefs);
            }
        }
        if (!sameRefs(allRefs, b.sourceRefs))
            issues.push(`block:${b.id}:field-coverage`);
        for (const id of b.sourceRefs) {
            if (!ctx.sourceRefs.includes(id))
                issues.push(`unknown-source-ref:${id}`);
            uses.set(id, (uses.get(id) ?? 0) + 1);
        }
        if (b.type === 'visual' && (!record(b.fields.assetRef) || !strs(b.fields.assetRef.sourceRefs) || b.fields.assetRef.sourceRefs.length !== 1))
            issues.push(`visual:${b.id}:requires-one-asset`);
    }
    if (ctx.sourceUseCounts !== undefined) {
        if (!record(ctx.sourceUseCounts))
            issues.push('invalid-source-use-counts');
        else
            for (const [ref, count] of Object.entries(ctx.sourceUseCounts))
                if (!ctx.sourceRefs.includes(ref) || !Number.isInteger(count) || count < 1)
                    issues.push(`invalid-source-use-count:${ref}`);
    }
    for (const id of ctx.sourceRefs)
        if ((uses.get(id) ?? 0) !== (ctx.sourceUseCounts?.[id] ?? 1))
            issues.push(`source-coverage:${id}`);
    if (issues.length)
        throw new RecipeError(issues);
    const assetRefs = new Set(ctx.blocks.filter(b => b.type === 'visual').flatMap(b => refsOf(b.fields.assetRef)));
    for (const b of ctx.blocks)
        if (b.type !== 'visual' && b.sourceRefs.some(id => assetRefs.has(id)))
            issues.push(`asset-used-as-text:${b.id}`);
    if (!unique(ctx.visualAssets.map(a => a?.blockId)))
        issues.push('duplicate-visual-block');
    for (const a of ctx.visualAssets) {
        if (!record(a)) {
            issues.push('invalid-visual-asset');
            continue;
        }
        ownKeys(a, ['blockId', 'sourceRef', 'assetId', 'visualType'], 'visual-asset', issues);
        const b = ctx.blocks.find(b => b.id === a.blockId);
        if (!b || b.type !== 'visual' || !str(a.assetId) || b.fields.visualType !== a.visualType || refsOf(b.fields.assetRef)[0] !== a.sourceRef)
            issues.push(`invalid-visual-asset:${a.blockId}`);
    }
    for (const b of ctx.blocks.filter(b => b.type === 'visual'))
        if (!ctx.visualAssets.some(a => a.blockId === b.id))
            issues.push(`missing-visual-asset:${b.id}`);
    if (!unique(ctx.componentVariants.map(v => v?.id)))
        issues.push('duplicate-variant-id');
    const scopes: {
        scope: MeasurementScope;
        component: boolean;
    }[] = [
        ...ctx.componentVariants.map(scope => ({ scope, component: true })), ...ctx.fallbackEvidence.map(scope => ({ scope, component: false })),
    ];
    for (const { scope: q, component } of scopes) {
        if (!record(q)) {
            issues.push('invalid-measurement');
            continue;
        }
        const p = `measurement:${q.blockId}`;
        const keys = ['blockId', 'blockKey', 'stateId', 'regionId', 'slotIndex', 'contentRevision', 'designSystemId', 'designSystemRevision', 'recipeRevision', 'structureKey', 'layoutKey', 'emphasis', 'measuredBox'];
        ownKeys(q, [...keys, ...(component ? ['id', 'componentId', 'fieldBindings'] : ['reason', 'searchComplete'])], p, issues);
        for (const k of keys.filter(k => !['slotIndex', 'measuredBox'].includes(k)))
            if (!str((q as unknown as Record<string, unknown>)[k]))
                issues.push(`${p}:invalid-${k}`);
        const b = ctx.blocks.find(b => b.id === q.blockId), s = bundle.states.find(s => s.id === q.stateId), r = s?.regions.find(r => r.id === q.regionId);
        if (!b || !r) {
            issues.push(`${p}:unknown-scope`);
            continue;
        }
        if (!r.accepts.includes(b.type) || !b.allowedRoles.includes(r.role) || !r.emphasis.includes(q.emphasis))
            issues.push(`${p}:incompatible-region`);
        if (!Number.isInteger(q.slotIndex) || q.slotIndex < 0 || q.slotIndex >= r.maxItems || !validRect(q.measuredBox))
            issues.push(`${p}:invalid-slot-or-bounds`);
        if (q.recipeRevision !== bundle.revision || q.contentRevision !== ctx.contentRevision || q.designSystemId !== ctx.designSystemId || q.designSystemRevision !== ctx.designSystemRevision || q.blockKey !== normalizedBlockKey(b))
            issues.push(`${p}:stale-snapshot`);
        if (component) {
            const v = q as unknown as MeasuredComponentVariant;
            if (!str(v.id) || !str(v.componentId) || !ctx.componentIds.includes(v.componentId))
                issues.push(`${p}:unregistered-component`);
            if (!bundle.contracts[b.type].queryRole || r.priority === 'asset-only')
                issues.push(`${p}:component-not-supported`);
            if (!Array.isArray(v.fieldBindings) || !v.fieldBindings.length || v.fieldBindings.some(f => !record(f) || !str(f.path) || !strs(f.sourceRefs, true)) || !unique(v.fieldBindings.map(f => f.path)))
                issues.push(`${p}:invalid-component-field-bindings`);
            else {
                if (!sameRefs(v.fieldBindings.flatMap(f => [...f.sourceRefs]), b.sourceRefs))
                    issues.push(`${p}:component-field-coverage`);
                for (const f of v.fieldBindings)
                    if (!ctx.componentFieldPaths[v.componentId]?.includes(f.path))
                        issues.push(`${p}:unknown-component-field-path:${f.path}`);
            }
        }
        else {
            const e = q as unknown as FallbackEvidence;
            if (!FALLBACK_REASONS.includes(e.reason) || e.searchComplete !== true)
                issues.push(`${p}:incomplete-fallback-evidence`);
        }
    }
    if (issues.length)
        throw new RecipeError(issues);
}
function parseStructure(bundle: Bundle, raw: unknown, ctx: QwenContext, rendered: boolean): Assignment | StructuralAssignment {
    const issues: string[] = [];
    if (!record(raw))
        throw new RecipeError(['assignment:not-object']);
    ownKeys(raw, ['familyId', 'modeId', 'assignments'], 'assignment', issues);
    const family = bundle.families.find(f => f.id === raw.familyId);
    if (!family || !family.modes.some(m => m.id === raw.modeId))
        issues.push('unknown-family-or-mode');
    if (!Array.isArray(raw.assignments) || !raw.assignments.length)
        throw new RecipeError([...issues, 'empty-assignments']);
    const counts = new Map<string, number>();
    for (const a of raw.assignments) {
        if (!record(a)) {
            issues.push('invalid-assignment');
            continue;
        }
        ownKeys(a, ['blockId', 'regionId', 'emphasis', ...(rendered ? ['render'] : [])], 'assignment-item', issues);
        if (!str(a.blockId) || !ctx.blocks.some(b => b.id === a.blockId) || !str(a.regionId) || !['primary', 'secondary'].includes(String(a.emphasis)))
            issues.push('invalid-assignment-identity');
        counts.set(String(a.blockId), (counts.get(String(a.blockId)) ?? 0) + 1);
        if (rendered) {
            const r = a.render;
            if (!record(r)) {
                issues.push(`missing-render-choice:${a.blockId}`);
                continue;
            }
            if (r.kind === 'component') {
                ownKeys(r, ['kind', 'variantId'], 'render', issues);
                if (!str(r.variantId) || !ctx.componentVariants.some(v => v.id === r.variantId))
                    issues.push('unknown-component-variant');
            }
            else if (r.kind === 'primitive') {
                ownKeys(r, ['kind', 'reason'], 'render', issues);
                if (r.reason !== null && !FALLBACK_REASONS.includes(r.reason as FallbackReason))
                    issues.push('invalid-fallback-reason');
            }
            else if (r.kind === 'asset')
                ownKeys(r, ['kind'], 'render', issues);
            else
                issues.push('unknown-render-kind');
        }
    }
    for (const b of ctx.blocks)
        if (counts.get(b.id) !== 1)
            issues.push(`block-assignment-count:${b.id}:${counts.get(b.id) ?? 0}`);
    if (raw.assignments.length !== ctx.blocks.length)
        issues.push('all-blocks-must-be-assigned-once');
    if (issues.length)
        throw new RecipeError(issues);
    return structuredClone(raw) as unknown as Assignment | StructuralAssignment;
}
export function validateStructuralAssignment(bundle: Bundle, raw: unknown, ctx: QwenContext, rendered = false): {
    assignment: StructuralAssignment | Assignment;
    compatibleStateIds: string[];
} {
    validateContext(bundle, ctx);
    const assignment = parseStructure(bundle, raw, ctx, rendered);
    const rejected: string[] = [], compatibleStateIds: string[] = [];
    for (const s of bundle.states.filter(s => s.familyId === assignment.familyId && s.modeId === assignment.modeId)) {
        const problems: string[] = [];
        for (const r of s.regions) {
            const items = assignment.assignments.filter(a => a.regionId === r.id);
            if (items.length < r.minItems || items.length > r.maxItems)
                problems.push(`count:${r.id}:${items.length}`);
            if (items.filter(a => a.emphasis === 'primary').length > r.maxPrimaryItems)
                problems.push(`primary-count:${r.id}`);
            if (items.length && !r.layouts.some(l => items.length >= l.minItems && items.length <= l.maxItems))
                problems.push(`no-layout-for-count:${r.id}`);
        }
        for (const a of assignment.assignments) {
            const r = s.regions.find(r => r.id === a.regionId), b = ctx.blocks.find(b => b.id === a.blockId)!;
            if (!r) {
                problems.push(`unknown-region:${a.regionId}`);
                continue;
            }
            if (!r.accepts.includes(b.type) || !b.allowedRoles.includes(r.role))
                problems.push(`semantic-role-or-type:${b.id}:${r.id}`);
            if (!r.emphasis.includes(a.emphasis))
                problems.push(`emphasis:${b.id}:${r.id}`);
            if (b.type === 'visual' && r.allowedVisualTypes && !r.allowedVisualTypes.includes(b.fields.visualType as VisualType))
                problems.push(`visual-type-not-allowed:${b.id}:${r.id}`);
        }
        if (!problems.length)
            compatibleStateIds.push(s.id);
        else
            rejected.push(...problems.map(p => `${s.id}:${p}`));
    }
    if (!compatibleStateIds.length)
        throw new RecipeError(['no-compatible-state', ...rejected]);
    return { assignment, compatibleStateIds };
}
export function structureKey(assignment: StructuralAssignment | Assignment): string {
    return canonicalKey({ familyId: assignment.familyId, modeId: assignment.modeId,
        assignments: assignment.assignments.map(a => ({ blockId: a.blockId, regionId: a.regionId, emphasis: a.emphasis })).sort((a, b) => a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0) });
}
export function eligiblePrimitiveLayouts(bundle: Bundle, block: NormalizedBlock, region?: Region): readonly PrimitiveLayout[] {
    return bundle.contracts[block.type].primitiveLayouts.filter(l => (!region?.primitiveLayoutIds || region.primitiveLayoutIds.includes(l.id)) &&
        Object.entries(l.listCounts ?? {}).every(([f, c]) => Array.isArray(block.fields[f]) && (block.fields[f] as readonly unknown[]).length >= c.min && (block.fields[f] as readonly unknown[]).length <= c.max));
}
export type ResolvedChoices = {
    regionLayouts: Record<string, string>;
    primitiveLayouts: Record<string, string>;
    layoutRevision: string;
    blockBoxes: Readonly<Record<string, Rect>>;
};
function resolveChoices(bundle: Bundle, state: State, assignment: StructuralAssignment | Assignment, ctx: QwenContext, choices: ExecutorChoices): ResolvedChoices {
    const issues: string[] = [];
    if (!str(choices.layoutRevision) || !record(choices.blockBoxes))
        throw new RecipeError(['missing-measured-layout-context']);
    for (const k of Object.keys(choices.blockBoxes))
        if (!ctx.blocks.some(b => b.id === k))
            issues.push(`unknown-box:${k}`);
    for (const b of ctx.blocks)
        if (!validRect(choices.blockBoxes[b.id]))
            issues.push(`missing-or-invalid-box:${b.id}`);
    const regionLayouts: Record<string, string> = {}, primitiveLayouts: Record<string, string> = {};
    for (const key of Object.keys(choices.regionLayouts ?? {}))
        if (!assignment.assignments.some(a => a.regionId === key))
            issues.push(`orphan-layout-choice:${key}`);
    for (const r of state.regions) {
        const items = assignment.assignments.filter(a => a.regionId === r.id);
        if (!items.length)
            continue;
        const valid = r.layouts.filter(l => items.length >= l.minItems && items.length <= l.maxItems);
        const requested = choices.regionLayouts?.[r.id];
        const l = requested ? valid.find(l => l.id === requested) : valid.find(l => l.id === r.preferredLayoutId) ?? valid[0];
        if (!l)
            issues.push(`invalid-region-layout:${r.id}`);
        else
            regionLayouts[r.id] = l.id;
    }
    for (const key of Object.keys(choices.primitiveLayouts ?? {}))
        if (!ctx.blocks.some(b => b.id === key))
            issues.push(`unknown-primitive-choice:${key}`);
    for (const a of assignment.assignments) {
        const b = ctx.blocks.find(b => b.id === a.blockId)!, r = state.regions.find(r => r.id === a.regionId)!;
        const valid = eligiblePrimitiveLayouts(bundle, b, r), requested = choices.primitiveLayouts?.[b.id];
        if (requested && !valid.some(l => l.id === requested))
            issues.push(`invalid-primitive-layout:${b.id}:${requested}`);
        if (valid.length)
            primitiveLayouts[b.id] = requested ?? valid[0].id;
    }
    if (issues.length)
        throw new RecipeError(issues);
    return { regionLayouts, primitiveLayouts, layoutRevision: choices.layoutRevision, blockBoxes: structuredClone(choices.blockBoxes) };
}
export function layoutKey(bundle: Bundle, stateId: string, choices: ResolvedChoices): string {
    return canonicalKey({ recipeRevision: bundle.revision, stateId, ...choices });
}
export function makeMeasurementScope(bundle: Bundle, stateId: string, rawStructure: unknown, ctx: QwenContext, choices: ExecutorChoices, blockId: string): MeasurementScope {
    const v = validateStructuralAssignment(bundle, rawStructure, ctx);
    if (!v.compatibleStateIds.includes(stateId))
        throw new RecipeError(['incompatible-state']);
    const s = bundle.states.find(s => s.id === stateId)!, c = resolveChoices(bundle, s, v.assignment, ctx, choices);
    return measurementScope(bundle, s, v.assignment, ctx, c, blockId);
}
function measurementScope(bundle: Bundle, state: State, assignment: StructuralAssignment | Assignment, ctx: QwenContext, choices: ResolvedChoices, blockId: string): MeasurementScope {
    const a = assignment.assignments.find(a => a.blockId === blockId), b = ctx.blocks.find(b => b.id === blockId);
    if (!a || !b)
        throw new RecipeError(['unknown-measured-block']);
    const ordered = assignment.assignments.filter(i => i.regionId === a.regionId).sort((x, y) => ctx.blocks.find(b => b.id === x.blockId)!.sequenceIndex - ctx.blocks.find(b => b.id === y.blockId)!.sequenceIndex);
    return { blockId, blockKey: normalizedBlockKey(b), stateId: state.id, regionId: a.regionId, slotIndex: ordered.findIndex(i => i.blockId === blockId),
        contentRevision: ctx.contentRevision, designSystemId: ctx.designSystemId, designSystemRevision: ctx.designSystemRevision,
        recipeRevision: bundle.revision, structureKey: structureKey(assignment), layoutKey: layoutKey(bundle, state.id, choices), emphasis: a.emphasis,
        measuredBox: { ...choices.blockBoxes[blockId] } };
}
const scopeOnly = (v: MeasurementScope): MeasurementScope => ({ blockId: v.blockId, blockKey: v.blockKey, stateId: v.stateId, regionId: v.regionId, slotIndex: v.slotIndex,
    contentRevision: v.contentRevision, designSystemId: v.designSystemId, designSystemRevision: v.designSystemRevision, recipeRevision: v.recipeRevision,
    structureKey: v.structureKey, layoutKey: v.layoutKey, emphasis: v.emphasis, measuredBox: v.measuredBox });
export function validateQwenAssignment(bundle: Bundle, stateId: string, raw: unknown, ctx: QwenContext, choices: ExecutorChoices): {
    assignment: Assignment;
    state: State;
    choices: ResolvedChoices;
    requiresRenderedValidation: true;
} {
    const v = validateStructuralAssignment(bundle, raw, ctx, true);
    if (!v.compatibleStateIds.includes(stateId))
        throw new RecipeError(['state-not-compatible-with-assignment']);
    const state = bundle.states.find(s => s.id === stateId)!, assignment = v.assignment as Assignment;
    const c = resolveChoices(bundle, state, assignment, ctx, choices), issues: string[] = [];
    for (const a of assignment.assignments) {
        const b = ctx.blocks.find(b => b.id === a.blockId)!, r = state.regions.find(r => r.id === a.regionId)!;
        const scope = canonicalKey(measurementScope(bundle, state, assignment, ctx, c, b.id));
        const variants = ctx.componentVariants.filter(v => canonicalKey(scopeOnly(v)) === scope);
        const evidence = ctx.fallbackEvidence.filter(v => canonicalKey(scopeOnly(v)) === scope);
        if (a.render.kind === 'component') {
            const selected = a.render.variantId;
            if (!variants.some(v => v.id === selected) || r.priority === 'asset-only' || b.type === 'visual')
                issues.push(`component-not-measured-for-exact-layout:${b.id}`);
        }
        else if (a.render.kind === 'asset') {
            if (b.type !== 'visual' || !['asset-only', 'mixed-partners'].includes(r.priority) || !ctx.visualAssets.some(v => v.blockId === b.id))
                issues.push(`asset-not-allowed:${b.id}`);
        }
        else {
            if (b.type === 'visual' || r.priority === 'asset-only')
                issues.push(`visual-must-use-asset:${b.id}`);
            const componentFirst = r.priority === 'component-first' || r.priority === 'mixed-partners';
            if (componentFirst) {
                if (a.render.reason === null)
                    issues.push(`fallback-reason-required:${b.id}`);
                if (variants.length)
                    issues.push(`compatible-component-must-be-used:${b.id}`);
                const reason = a.render.reason;
                if (!evidence.some(e => e.reason === reason && e.searchComplete))
                    issues.push(`fallback-not-supported-by-executor:${b.id}`);
            }
            else if (a.render.reason !== null)
                issues.push(`direct-primitive-must-have-null-reason:${b.id}`);
            if (!c.primitiveLayouts[b.id])
                issues.push(`no-eligible-primitive:${b.id}`);
        }
    }
    if (issues.length)
        throw new RecipeError(issues);
    return { assignment, state, choices: c, requiresRenderedValidation: true };
}
/** Same full-height chrome occupancy rule as reviewed v5; empty gaps are NOT nodes. */
export function resolvePresentState(state: State, presentRegionIds: readonly string[]): State {
    const present = new Set(presentRegionIds), result = structuredClone(state);
    if ([...present].some(id => !state.regions.some(r => r.id === id)))
        throw new RecipeError(['unknown-present-region']);
    if (state.regions.some(r => r.minItems > 0 && !present.has(r.id)))
        throw new RecipeError(['required-region-absent']);
    const keep = new Set<string>(), visiting = new Set<string>(), map = new Map(result.groups.map(g => [g.id, g]));
    const prune = (id: string): boolean => {
        if (visiting.has(id))
            throw new RecipeError([`group-cycle:${id}`]);
        const g = map.get(id);
        if (!g)
            throw new RecipeError([`unknown-group:${id}`]);
        if (keep.has(id))
            return true;
        visiting.add(id);
        g.children = g.children.filter(c => c.kind === 'region' ? present.has(c.id) : prune(c.id));
        g.flowSeparators = g.flowSeparators?.filter(d => g.children.some(c => c.id === d.afterId) && g.children.some(c => c.id === d.beforeId));
        visiting.delete(id);
        if (id === state.rootGroupId || g.children.length || !g.collapseEmpty) {
            keep.add(id);
            return true;
        }
        return false;
    };
    prune(result.rootGroupId);
    result.groups = result.groups.filter(g => keep.has(g.id));
    result.regions = result.regions.filter(r => present.has(r.id));
    return result;
}
export type BoundNode = {
    id: string;
    templateId: string;
    kind: 'field' | 'group' | 'ornament';
    sourceRefs?: readonly string[];
    typographyRole?: string;
    textAlign?: 'left' | 'center' | 'right';
    direction?: Direction;
    align?: Align;
    justify?: 'start' | 'center' | 'end' | 'space-between';
    gap?: Range;
    padding?: Insets;
    surfaceRole?: string;
    flex?: Flex;
    pushToEnd?: boolean;
    minWidth: 0;
    heightMode: 'fill' | 'hug';
    measureWidth?: 'available' | 'intrinsic';
    preferredWidth?: number;
    maxLines?: number;
    children?: BoundNode[];
    decorations?: (EdgeDecoration & {
        ownerNodeId: string;
    })[];
    ornamentRole?: string;
    ornamentSize?: {
        w: number;
        h: number;
    };
};
export const walkBound = (n: BoundNode): BoundNode[] => [n, ...(n.children?.flatMap(walkBound) ?? [])];
function boundDecoration(d: EdgeDecoration, id: string, index: number, count: number): (EdgeDecoration & {
    ownerNodeId: string;
}) | null {
    if (d.when === 'not-first' && index === 0 || d.when === 'not-last' && index === count - 1)
        return null;
    return { ...structuredClone(d), id: `${id}/${d.id}`, ownerNodeId: id };
}
function bindPrimitive(b: NormalizedBlock, r: Region, layout: PrimitiveLayout): BoundNode {
    const bind = (spec: InternalNode, fields: NormalizedBlock['fields'], prefix: string, parentDirection: Direction = 'column', index = 0, count = 1): BoundNode | null => {
        const id = `${prefix}/${spec.id}`;
        const base: BoundNode = { id, templateId: spec.id, kind: spec.kind === 'repeat' ? 'group' : spec.kind,
            minWidth: 0, heightMode: spec.heightMode ?? (spec.flex?.grow ? 'fill' : 'hug'), typographyRole: spec.typographyRole,
            direction: spec.direction, align: spec.align, justify: spec.justify, gap: spec.gap ? { ...spec.gap } : undefined,
            padding: { ...ZERO, ...spec.padding }, surfaceRole: spec.surfaceRole ?? 'plain', flex: spec.flex ? { ...spec.flex } : undefined,
            pushToEnd: spec.pushToEnd, preferredWidth: spec.preferredWidth, maxLines: spec.maxLines, textAlign: spec.textAlign };
        if (spec.kind === 'field') {
            const value = fields[spec.fieldPath ?? ''];
            if (value === undefined)
                return null;
            if (!record(value) || !strs(value.sourceRefs, true))
                throw new RecipeError([`field-binding-expected:${id}`]);
            base.sourceRefs = [...value.sourceRefs];
            base.measureWidth = parentDirection === 'row' && !spec.flex?.grow && spec.preferredWidth === undefined ? 'intrinsic' : 'available';
            if ((b.type === 'text' || b.type === 'label') && r.typographyRole)
                base.typographyRole = r.typographyRole;
        }
        else if (spec.kind === 'ornament') {
            base.ornamentRole = spec.ornamentRole;
            base.ornamentSize = spec.ornamentSize ? { ...spec.ornamentSize } : undefined;
        }
        else if (spec.kind === 'repeat') {
            const value = fields[spec.fieldPath ?? ''];
            if (value === undefined)
                return null;
            if (!Array.isArray(value) || !spec.item || value.length < (spec.minItems ?? 0) || value.length > (spec.maxItems ?? Infinity))
                throw new RecipeError([`invalid-repeat:${id}`]);
            const items = value.map((it, i) => bind(spec.item!, it.fields, `${id}/${i}`, spec.direction ?? 'column', i, value.length)!);
            const tail = spec.tail ? bind(spec.tail, fields, `${id}/tail`, 'column') : null;
            const columns = Math.min(spec.columns ?? 1, Math.max(1, items.length));
            if (columns > 1) {
                base.direction = 'row';
                base.align = 'start';
                base.children = Array.from({ length: columns }, (_, c) => {
                    const q = Math.floor(items.length / columns), remainder = items.length % columns;
                    const from = q * c + Math.min(c, remainder), to = from + q + (c < remainder ? 1 : 0);
                    const children = spec.readingOrder === 'column-major' ? items.slice(from, to) : items.filter((_, i) => i % columns === c);
                    if (c === columns - 1 && tail)
                        children.push(tail);
                    return { id: `${id}/lane-${c}`, templateId: `${spec.id}-lane`, kind: 'group' as const, direction: 'column' as const,
                        minWidth: 0 as const, heightMode: 'hug' as const, align: 'stretch' as const, gap: spec.gap ? { ...spec.gap } : fixed(0),
                        flex: { grow: 1, shrink: 1, basis: 0 }, children };
                }).filter(lane => lane.children.length);
            }
            else {
                base.direction = spec.direction ?? 'column';
                base.children = tail ? [...items, tail] : items;
            }
            if (!base.children.length)
                return null;
            if (base.direction === 'row')
                for (const child of base.children)
                    if (!child.flex)
                        child.flex = { grow: 1, shrink: 1, basis: 0 };
        }
        else {
            base.children = (spec.children ?? []).map(c => bind(c, fields, id, spec.direction ?? 'column', index, count)).filter((x): x is BoundNode => x !== null);
            if (!base.children.length)
                return null;
            // A single child must not inherit an accidental equal-space-between policy.
            if (base.children.length === 1 && base.justify === 'space-between')
                base.justify = 'start';
        }
        base.decorations = (spec.decorations ?? []).map(d => boundDecoration(d, id, index, count)).filter((d): d is EdgeDecoration & {
            ownerNodeId: string;
        } => d !== null);
        for (const d of base.decorations)
            base.padding![d.edge] = Math.max(base.padding![d.edge], d.preferredThicknessPx + d.clearancePx);
        return base;
    };
    const root = bind(layout.root, b.fields, `${b.id}/${layout.id}`);
    if (!root)
        throw new RecipeError([`empty-primitive:${b.id}`]);
    root.heightMode = layout.root.heightMode ?? 'fill';
    const refs = walkBound(root).flatMap(n => n.sourceRefs ?? []);
    if (!sameRefs(refs, b.sourceRefs))
        throw new RecipeError([`primitive-loses-or-repeats-content:${b.id}`]);
    return root;
}
export type BoundBlockPlan = {
    blockId: string;
    blockKey: string;
    regionId: string;
    slotIndex: number;
    sequenceIndex: number;
    emphasis: Emphasis;
    sourceRefs: readonly string[];
    scope: MeasurementScope;
    content: {
        kind: 'primitive';
        layoutId: string;
        reason: FallbackReason | null;
        root: BoundNode;
    } | {
        kind: 'component';
        variantId: string;
        componentId: string;
        fields: NormalizedBlock['fields'];
        fieldBindings: readonly ComponentFieldBinding[];
    } | {
        kind: 'asset';
        assetId: string;
        visualType: VisualType;
        fit: 'contain' | 'cover';
    };
};
export type RenderPlan = {
    bundleId: string;
    recipeRevision: string;
    state: State;
    choices: ResolvedChoices;
    regions: {
        regionId: string;
        layout: ItemLayout;
        blocks: BoundBlockPlan[];
    }[];
    structureKey: string;
    layoutKey: string;
    requiresRenderedValidation: true;
};
export function createStateRenderPlan(bundle: Bundle, stateId: string, raw: unknown, input: QwenContext, choices: ExecutorChoices): RenderPlan {
    // Work on one snapshot to prevent later caller mutations from changing a plan.
    const ctx = structuredClone(input), v = validateQwenAssignment(bundle, stateId, raw, ctx, choices);
    const state = resolvePresentState(v.state, v.assignment.assignments.map(a => a.regionId));
    const regions = state.regions.map(r => {
        const layout = r.layouts.find(l => l.id === v.choices.regionLayouts[r.id])!;
        const assignments = v.assignment.assignments.filter(a => a.regionId === r.id).sort((a, b) => ctx.blocks.find(x => x.id === a.blockId)!.sequenceIndex - ctx.blocks.find(x => x.id === b.blockId)!.sequenceIndex);
        const blocks = assignments.map((a, slotIndex): BoundBlockPlan => {
            const b = ctx.blocks.find(b => b.id === a.blockId)!;
            let content: BoundBlockPlan['content'];
            if (a.render.kind === 'component') {
                const choice = a.render.variantId, component = ctx.componentVariants.find(v => v.id === choice)!;
                content = { kind: 'component', variantId: choice, componentId: component.componentId, fields: structuredClone(b.fields), fieldBindings: structuredClone(component.fieldBindings) };
            }
            else if (a.render.kind === 'asset') {
                const asset = ctx.visualAssets.find(v => v.blockId === b.id)!;
                content = { kind: 'asset', assetId: asset.assetId, visualType: asset.visualType, fit: asset.visualType === 'photo' ? 'cover' : 'contain' };
            }
            else {
                const l = eligiblePrimitiveLayouts(bundle, b, r).find(l => l.id === v.choices.primitiveLayouts[b.id])!;
                content = { kind: 'primitive', layoutId: l.id, reason: a.render.reason, root: bindPrimitive(b, r, l) };
            }
            return { blockId: b.id, blockKey: normalizedBlockKey(b), regionId: r.id, slotIndex, sequenceIndex: b.sequenceIndex, emphasis: a.emphasis,
                sourceRefs: [...b.sourceRefs], scope: measurementScope(bundle, v.state, v.assignment, ctx, v.choices, b.id), content };
        });
        return { regionId: r.id, layout: structuredClone(layout), blocks };
    });
    return { bundleId: bundle.id, recipeRevision: bundle.revision, state, choices: v.choices, regions,
        structureKey: structureKey(v.assignment), layoutKey: layoutKey(bundle, stateId, v.choices), requiresRenderedValidation: true };
}
/** The parser is strict at runtime; the JSON Schema is the provider grammar.
 * Semantic validation remains mandatory after shape parsing. */
export function createQwenAssignmentSchema(bundle: Bundle, ctx: QwenContext) {
    validateContext(bundle, ctx);
    const renders: unknown[] = [
        { type: 'object', additionalProperties: false, required: ['kind', 'reason'], properties: { kind: { const: 'primitive' }, reason: { enum: [null, ...FALLBACK_REASONS] } } },
        { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'asset' } } },
    ];
    if (ctx.componentVariants.length)
        renders.unshift({ type: 'object', additionalProperties: false, required: ['kind', 'variantId'], properties: { kind: { const: 'component' }, variantId: { enum: ctx.componentVariants.map(v => v.id) } } });
    const jsonSchema = { type: 'object', additionalProperties: false, required: ['familyId', 'modeId', 'assignments'], properties: {
            familyId: { enum: bundle.families.map(f => f.id) }, modeId: { enum: [...new Set(bundle.states.map(s => s.modeId))] },
            assignments: { type: 'array', minItems: ctx.blocks.length, maxItems: ctx.blocks.length, items: {
                    type: 'object', additionalProperties: false, required: ['blockId', 'regionId', 'emphasis', 'render'], properties: {
                        blockId: { enum: ctx.blocks.map(b => b.id) }, regionId: { enum: [...new Set(bundle.states.flatMap(s => s.regions.map(r => r.id)))] },
                        emphasis: { enum: ['primary', 'secondary'] }, render: { oneOf: renders },
                    },
                } },
        } };
    const parse = (raw: unknown): Assignment => parseStructure(bundle, raw, ctx, true) as Assignment;
    const safeParse = (raw: unknown): {
        success: true;
        data: Assignment;
    } | {
        success: false;
        error: RecipeError;
    } => {
        try {
            return { success: true, data: parse(raw) };
        }
        catch (e) {
            return { success: false, error: e instanceof RecipeError ? e : new RecipeError([String(e)]) };
        }
    };
    return { jsonSchema, parse, safeParse };
}
const validRange = (r: Range) => [r.min, r.preferred, r.max].every(Number.isFinite) && r.min >= 0 && r.min <= r.preferred && r.preferred <= r.max;
function checkDeco(d: EdgeDecoration, at: string, issues: string[]): void {
    if (!str(d.id) || !str(d.role) || !['top', 'bottom', 'left', 'right'].includes(d.edge) || d.placement !== 'inside-edge' || !Number.isFinite(d.preferredThicknessPx) || d.preferredThicknessPx <= 0 || !Number.isFinite(d.clearancePx) || d.clearancePx < 0)
        issues.push(`${at}:invalid-decoration:${d.id}`);
}
/** Fail at import time for invalid recipes, not several generations later. */
export function validateRecipeDefinition(bundle: Bundle): string[] {
    const issues: string[] = [];
    if (!unique(bundle.sourceFrames) || bundle.states.length !== bundle.sourceFrames.length || !unique(bundle.states.map(s => s.sourceFrame)))
        issues.push('source-frame-coverage');
    if (!unique(bundle.states.map(s => s.id)))
        issues.push('duplicate-state-id');
    if (!unique(bundle.families.map(f => f.id)))
        issues.push('duplicate-family-id');
    for (const s of bundle.states) {
        if (!bundle.sourceFrames.includes(s.sourceFrame))
            issues.push(`${s.id}:unknown-source-frame`);
        const f = bundle.families.find(f => f.id === s.familyId), m = f?.modes.find(m => m.id === s.modeId);
        if (!m?.stateIds.includes(s.id))
            issues.push(`${s.id}:family-mode-mismatch`);
        if (s.aliasOf) {
            const a = bundle.states.find(a => a.id === s.aliasOf);
            if (!a || a.aliasOf || a.id === s.id || a.familyId !== s.familyId || a.modeId !== s.modeId)
                issues.push(`${s.id}:invalid-alias`);
            const shape = (v: State) => canonicalKey({ canvas: v.canvas, root: v.rootGroupId, surface: v.surfaceRole, regions: v.regions.map(({ sourceNode, ...rest }) => rest), groups: v.groups.map(({ sourceNode, ...rest }) => rest) });
            if (a && shape(a) !== shape(s))
                issues.push(`${s.id}:alias-has-different-runtime-layout`);
        }
        const rids = new Set(s.regions.map(r => r.id)), gids = new Set(s.groups.map(g => g.id));
        if (rids.size !== s.regions.length || gids.size !== s.groups.length)
            issues.push(`${s.id}:duplicate-node-id`);
        if ([...rids].some(id => gids.has(id)))
            issues.push(`${s.id}:cross-kind-id-collision`);
        if (!gids.has(s.rootGroupId))
            issues.push(`${s.id}:root-missing`);
        const parent = new Map<string, number>();
        for (const r of s.regions) {
            if (!validRect(r.preferredRect) || !validRange(r.size.width) || !validRange(r.size.height))
                issues.push(`${s.id}:${r.id}:invalid-region-geometry`);
            if (!Number.isInteger(r.minItems) || !Number.isInteger(r.maxItems) || r.minItems < 0 || r.minItems > r.maxItems)
                issues.push(`${s.id}:${r.id}:invalid-counts`);
            if (r.accepts.some(t => !bundle.contracts[t]))
                issues.push(`${s.id}:${r.id}:unknown-block-type`);
            if (r.priority === 'component-first' && r.accepts.includes('text'))
                issues.push(`${s.id}:${r.id}:component-first-allows-generic-text`);
            if (r.priority === 'asset-only' && r.accepts.some(t => t !== 'visual'))
                issues.push(`${s.id}:${r.id}:asset-region-type`);
            if (r.accepts.some(t => bundle.contracts[t]?.type === 'text') && !r.typographyRole)
                issues.push(`${s.id}:${r.id}:missing-primitive-typography`);
            if (!unique(r.layouts.map(l => l.id)) || !r.layouts.some(l => l.id === r.preferredLayoutId))
                issues.push(`${s.id}:${r.id}:invalid-layout-ids`);
            for (const l of r.layouts)
                if (!Number.isInteger(l.columns) || l.columns < 1 || !validRange(l.gapX) || !validRange(l.gapY) || l.minItems < 1 || l.maxItems < l.minItems)
                    issues.push(`${s.id}:${r.id}:invalid-layout:${l.id}`);
            for (let n = Math.max(1, r.minItems); n <= r.maxItems; n++)
                if (!r.layouts.some(l => n >= l.minItems && n <= l.maxItems))
                    issues.push(`${s.id}:${r.id}:unhandled-item-count:${n}`);
            for (const id of r.primitiveLayoutIds ?? [])
                if (!r.accepts.some(t => bundle.contracts[t]?.primitiveLayouts.some(l => l.id === id)))
                    issues.push(`${s.id}:${r.id}:unknown-primitive-layout:${id}`);
        }
        for (const g of s.groups) {
            if (!validRect(g.preferredRect) || ![g.size.width, g.size.height, g.gap].every(validRange) || g.trailingSpace && !validRange(g.trailingSpace))
                issues.push(`${s.id}:${g.id}:invalid-group-geometry`);
            if (Object.values(g.padding).some(v => !Number.isFinite(v) || v < 0))
                issues.push(`${s.id}:${g.id}:invalid-padding`);
            for (const d of g.flowSeparators ?? []) {
                const i = g.children.findIndex(c => c.id === d.afterId);
                if (i < 0 || g.children[i + 1]?.id !== d.beforeId || !str(d.role) || ![d.width, d.height, d.gap].every(Number.isFinite) || d.width <= 0 || d.height <= 0 || d.gap < 0)
                    issues.push(`${s.id}:${g.id}:invalid-flow-separator`);
            }
            for (const d of g.decorations)
                checkDeco(d, `${s.id}:${g.id}`, issues);
            if (!unique(g.decorations.map(d => d.id)))
                issues.push(`${s.id}:${g.id}:duplicate-decoration`);
            for (const c of g.children) {
                const key = `${c.kind}:${c.id}`;
                parent.set(key, (parent.get(key) ?? 0) + 1);
                if (!(c.kind === 'region' ? rids : gids).has(c.id))
                    issues.push(`${s.id}:${g.id}:unknown-child:${key}`);
                if (c.gapBefore && !validRange(c.gapBefore) || c.marginBeforeCrossPx !== undefined && (!Number.isFinite(c.marginBeforeCrossPx) || c.marginBeforeCrossPx < 0))
                    issues.push(`${s.id}:${g.id}:invalid-child-gap`);
            }
        }
        for (const [kind, ids] of [['region', rids], ['group', gids]] as const)
            for (const id of ids)
                if ((parent.get(`${kind}:${id}`) ?? 0) !== (id === s.rootGroupId && kind === 'group' ? 0 : 1))
                    issues.push(`${s.id}:${kind}:${id}:parent-count`);
        const seen = new Set<string>(), active = new Set<string>();
        const visit = (id: string) => {
            if (active.has(id)) {
                issues.push(`${s.id}:cycle:${id}`);
                return;
            }
            if (seen.has(id))
                return;
            seen.add(id);
            active.add(id);
            for (const c of s.groups.find(g => g.id === id)?.children ?? [])
                if (c.kind === 'group')
                    visit(c.id);
            active.delete(id);
        };
        visit(s.rootGroupId);
        for (const id of gids)
            if (!seen.has(id))
                issues.push(`${s.id}:unreachable:${id}`);
    }
    for (const f of bundle.families)
        for (const m of f.modes)
            for (const id of m.stateIds)
                if (!bundle.states.some(s => s.id === id && s.familyId === f.id && s.modeId === m.id))
                    issues.push(`orphan-mode-state:${id}`);
    for (const contract of Object.values(bundle.contracts)) {
        if (contract.type !== 'visual' && !contract.primitiveLayouts.length)
            issues.push(`${contract.type}:missing-primitive`);
        if (!unique(contract.primitiveLayouts.map(l => l.id)))
            issues.push(`${contract.type}:duplicate-layout-id`);
        for (const l of contract.primitiveLayouts) {
            const ids = new Set<string>(), coverage = new Map<string, number>();
            const scan = (n: InternalNode, fields: Readonly<Record<string, FieldContract>>, prefix: string) => {
                if (!str(n.id) || ids.has(n.id))
                    issues.push(`${contract.type}:${l.id}:duplicate-node:${n.id}`);
                ids.add(n.id);
                if (n.gap && !validRange(n.gap))
                    issues.push(`${contract.type}:${l.id}:invalid-gap`);
                if (n.padding && Object.values(n.padding).some(v => !Number.isFinite(v) || v < 0))
                    issues.push(`${contract.type}:${l.id}:invalid-padding`);
                if (n.preferredWidth !== undefined && (!Number.isFinite(n.preferredWidth) || n.preferredWidth <= 0))
                    issues.push(`${contract.type}:${l.id}:invalid-width`);
                for (const d of n.decorations ?? [])
                    checkDeco(d, `${contract.type}:${l.id}:${n.id}`, issues);
                if (!unique((n.decorations ?? []).map(d => d.id)))
                    issues.push(`${contract.type}:${l.id}:${n.id}:duplicate-decoration`);
                if (n.kind === 'field') {
                    const spec = fields[n.fieldPath ?? ''], p = `${prefix}${n.fieldPath}`;
                    if (!spec || spec.kind !== 'single')
                        issues.push(`${contract.type}:${l.id}:invalid-field:${p}`);
                    if (!n.typographyRole)
                        issues.push(`${contract.type}:${l.id}:missing-typography:${p}`);
                    coverage.set(p, (coverage.get(p) ?? 0) + 1);
                }
                else if (n.kind === 'repeat') {
                    const spec = fields[n.fieldPath ?? ''];
                    if (!spec || spec.kind !== 'list' || !n.item) {
                        issues.push(`${contract.type}:${l.id}:invalid-repeat`);
                        return;
                    }
                    if (n.minItems === undefined || n.maxItems === undefined || n.minItems < spec.minItems || n.maxItems > spec.maxItems || n.minItems > n.maxItems)
                        issues.push(`${contract.type}:${l.id}:repeat-counts`);
                    const inner = Object.fromEntries(Object.entries(spec.itemFields).map(([k, v]) => [k, { kind: 'single' as const, required: v.required }]));
                    scan(n.item, inner, `${prefix}${n.fieldPath}[].`);
                    if (n.tail)
                        scan(n.tail, fields, prefix);
                }
                else if (n.kind === 'group') {
                    if (!n.direction || !n.children?.length)
                        issues.push(`${contract.type}:${l.id}:empty-group`);
                    for (const c of n.children ?? [])
                        scan(c, fields, prefix);
                }
                else if (n.kind === 'ornament' && (!str(n.ornamentRole) || !n.ornamentSize || !Number.isFinite(n.ornamentSize.w) || n.ornamentSize.w <= 0 || !Number.isFinite(n.ornamentSize.h) || n.ornamentSize.h <= 0))
                    issues.push(`${contract.type}:${l.id}:invalid-ornament`);
            };
            scan(l.root, contract.fields, '');
            for (const [f, spec] of Object.entries(contract.fields)) {
                const paths = spec.kind === 'list' ? Object.keys(spec.itemFields).map(k => `${f}[].${k}`) : spec.kind === 'single' ? [f] : [];
                for (const p of paths)
                    if (coverage.get(p) !== 1)
                        issues.push(`${contract.type}:${l.id}:field-coverage:${p}`);
            }
        }
    }
    return issues;
}
/** Translate presence-resolved relationships into spacer/child flex instructions.
 * Original x/y are references only. Every spacer belongs to its two live neighbours.
 * Resizing a title consumes these gaps and sibling flex ranges; no absolute shift. */
export type Flow = {
    id: string;
    kind: 'group' | 'region' | 'gap' | 'ornament';
    ornament?: FlowSeparator;
    group?: Group;
    region?: Region;
    childPolicy?: ChildRef;
    range?: Range;
    children?: Flow[];
};
export function compileFlowTree(state: State): Flow {
    const build = (id: string): Flow => {
        const g = state.groups.find(g => g.id === id);
        if (!g)
            throw new RecipeError([`flow:unknown-group:${id}`]);
        const children: Flow[] = [];
        g.children.forEach((c, i) => {
            if (i > 0) {
                const separator = g.flowSeparators?.find(d => d.afterId === g.children[i - 1].id && d.beforeId === c.id);
                if (separator) {
                    children.push({ id: `${id}:${separator.id}:before`, kind: 'gap', range: fixed(separator.gap) }, { id: `${id}:${separator.id}`, kind: 'ornament', ornament: structuredClone(separator) }, { id: `${id}:${separator.id}:after`, kind: 'gap', range: fixed(separator.gap) });
                }
                else
                    children.push({ id: `${id}:gap:${g.children[i - 1].id}:${c.id}`, kind: 'gap', range: { ...(c.gapBefore ?? g.gap) } });
            }
            if (c.kind === 'group')
                children.push({ ...build(c.id), childPolicy: structuredClone(c) });
            else
                children.push({ id: c.id, kind: 'region', region: structuredClone(state.regions.find(r => r.id === c.id)!), childPolicy: structuredClone(c) });
        });
        if (g.trailingSpace && g.children.length)
            children.push({ id: `${id}:trailing-space`, kind: 'gap', range: { ...g.trailingSpace } });
        return { id, kind: 'group', group: structuredClone(g), children };
    };
    return build(state.rootGroupId);
}
/** Deterministic bounded allocator for one already-measured flex axis.
 * Sizes may stay at their authored off-grid preferred values; adapted dimensions
 * are grid values. Space not allocated to boxes is returned for elastic gaps.
 * Does not guess text measurements or claim a two-dimensional rendered fit. */
export function allocateAxis(available: number, items: readonly {
    id: string;
    bounds: Range;
    requested: number;
    shrinkPriority: number;
    growPriority: number;
}[]): {
    sizes: Record<string, number>;
    slack: number;
} {
    if (!Number.isFinite(available) || available < 0 || !unique(items.map(i => i.id)))
        throw new RecipeError(['invalid-axis-input']);
    for (const i of items)
        if (!validRange(i.bounds) || !Number.isFinite(i.requested) || !Number.isFinite(i.shrinkPriority) || !Number.isFinite(i.growPriority))
            throw new RecipeError(['invalid-axis-item']);
    const sizes = Object.fromEntries(items.map(i => [i.id, i.requested === i.bounds.preferred ? i.requested : fitDimension(i.requested, i.bounds)]));
    const sum = () => Object.values(sizes).reduce((a, b) => a + b, 0);
    let excess = sum() - available;
    if (excess > 1e-6)
        for (const i of [...items].sort((a, b) => a.shrinkPriority - b.shrinkPriority)) {
            const target = sizes[i.id] - excess;
            const n = Math.max(Math.ceil(i.bounds.min / 4) * 4, Math.floor(target / 4) * 4);
            if (n <= sizes[i.id] && n <= i.bounds.max)
                sizes[i.id] = n;
            excess = sum() - available;
            if (excess <= 1e-6)
                break;
        }
    if (excess > 1e-6)
        throw new RecipeError(['axis-does-not-fit']);
    return { sizes, slack: available - sum() };
}
// ===== builders.ts =====
export const B = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const P = (top = 0, right = 0, bottom = 0, left = 0): Insets => ({ top, right, bottom, left });
export const edge = (id: string, e: EdgeDecoration['edge'], clearancePx = 0, preferredThicknessPx = 2, when: EdgeDecoration['when'] = 'always'): EdgeDecoration => ({
    id, edge: e, role: 'editorial-divider', preferredThicknessPx, clearancePx, placement: 'inside-edge', when,
});
export const one: ItemLayout = { id: 'single', columns: 1, minItems: 1, maxItems: 1, gapX: fixed(0), gapY: fixed(0), align: 'start', readingOrder: 'row-major', trackBasis: 'resolved-topology' };
export function columns(max: number, preferred: number, gap = 24, align: ItemLayout['align'] = 'start', extra: Partial<ItemLayout> = {}): ItemLayout[] {
    const list = [preferred, ...Array.from({ length: max }, (_, i) => i + 1).filter(n => n !== preferred)];
    return list.map(n => ({ ...one, id: `columns-${n}`, columns: n, minItems: n, maxItems: max,
        gapX: fixed(n > 1 ? gap : 0), gapY: fixed(gap), align, readingOrder: 'row-major', ...extra,
        // Positional gutters/weights belong only to the authored horizontal topology.
        ...(n === preferred ? {} : { itemPadding: undefined, preferredWeights: undefined }),
    }));
}
export function R(id: string, role: string, node: string | undefined, rect: Rect, type = 'text', min = 1, max = 1, opts: Partial<Region> = {}): Region {
    return { id, role, sourceNode: node, preferredRect: rect, size: { width: scale30(rect.w), height: scale30(rect.h) }, accepts: [type],
        minItems: min, maxItems: max, priority: type === 'text' ? 'primitive-first' : type === 'visual' ? 'asset-only' : 'component-first',
        typographyRole: type === 'text' ? role : undefined, emphasis: role === 'title' ? ['primary'] : ['secondary'], maxPrimaryItems: role === 'title' ? 1 : 0,
        layouts: [one], preferredLayoutId: 'single', ...opts };
}
export const C = (id: string, opts: Omit<ChildRef, 'kind' | 'id'> = {}): ChildRef => ({ kind: 'region', id, ...opts });
export const CG = (id: string, opts: Omit<ChildRef, 'kind' | 'id'> = {}): ChildRef => ({ kind: 'group', id, ...opts });
export function G(id: string, rect: Rect, direction: Group['direction'], children: readonly ChildRef[], opts: Partial<Group> = {}): Group {
    return { id, preferredRect: rect, size: { width: scale30(rect.w), height: scale30(rect.h) }, direction, align: 'start', justify: 'start',
        gap: fixed(0), padding: { ...ZERO }, surfaceRole: 'plain', children, decorations: [], collapseEmpty: true, ...opts };
}
export function root(rect: Rect, children: readonly ChildRef[], opts: Partial<Group> = {}): Group {
    return G('slide-root', rect, 'column', children, { size: { width: fixed(rect.w), height: fixed(rect.h) }, align: 'stretch', collapseEmpty: false, ...opts });
}
export function S(id: string, familyId: string, modeId: string, sourceFrame: string, regions: Region[], groups: Group[], adaptationNotes: string[] = [], surfaceRole = 'slide'): State {
    return { id, familyId, modeId, sourceFrame, canvas: { width: 1920, height: 1080 }, rootGroupId: 'slide-root', regions, groups, surfaceRole, adaptationNotes };
}
export const F = (id: string, fieldPath: string, typographyRole: string, extra: Partial<InternalNode> = {}): InternalNode => ({ id, kind: 'field', fieldPath, typographyRole, ...extra });
export const IG = (id: string, children: InternalNode[], extra: Partial<InternalNode> = {}): InternalNode => ({ id, kind: 'group', direction: 'column', align: 'stretch', justify: 'start', gap: fixed(0), padding: P(), surfaceRole: 'plain', children, ...extra });
export const RP = (id: string, path: string, min: number, max: number, item: InternalNode, extra: Partial<InternalNode> = {}): InternalNode => ({ id, kind: 'repeat', fieldPath: path, minItems: min, maxItems: max, direction: 'column', item, gap: fixed(0), ...extra });
export const single = (required = true) => ({ kind: 'single' as const, required });
export const list = (min: number, max: number, itemFields: Record<string, {
    required: boolean;
}>, required = true) => ({ kind: 'list' as const, required, minItems: min, maxItems: max, itemFields });
export const req = { required: true }, opt = { required: false };
export const PL = (id: string, n: InternalNode, extra: Partial<PrimitiveLayout> = {}): PrimitiveLayout => ({ id, root: n, ...extra });
export const BC = (type: string, fields: BlockContract['fields'], layouts: PrimitiveLayout[], queryRole: string | null = type, componentLayouts: string[] = layouts.map(l => l.id)): BlockContract => ({ type, fields, queryRole, componentLayouts, primitiveLayouts: layouts });
/** Full row occupancy + stable right anchoring, including a right-only row. */
export function plainHeader(leftNode: string, rightNode: string, leftWidth = 380, rightWidth = 364, x = 46, w = 1828) {
    return {
        regions: [R('header-left', 'header-left', leftNode, B(x, 44, leftWidth, 27), 'text', 0),
            R('header-right', 'header-right', rightNode, B(x + w - rightWidth, 44, rightWidth, 27), 'text', 0)],
        group: G('header-row', B(x, 44, w, 62), 'row', [C('header-left'), C('header-right', { pushToEnd: true })], {
            size: { width: fixed(w), height: range(44, 62, 80) }, gap: fixed(24), padding: P(0, 0, 35), decorations: [edge('header-line', 'bottom')],
        }),
    };
}
export function footer(leftNode?: string, rightNode?: string, y = 994, leftW = 680, rightW = 364, h = 27, rightH = 27, lineGap = 24, x = 46, w = 1828) {
    const regions = [
        ...(leftNode ? [R('footer', 'footer', leftNode, B(x, y, leftW, h), 'text', 0)] : []),
        ...(rightNode ? [R('footer-right', 'footer-right', rightNode, B(x + w - rightW, y, rightW, rightH), 'text', 0)] : []),
    ];
    return { regions, group: G('footer-row', B(x, y - lineGap - 2, w, Math.max(h, rightH) + lineGap + 2), 'row', [
            ...(leftNode ? [C('footer')] : []), ...(rightNode ? [C('footer-right', { pushToEnd: true })] : []),
        ], { align: 'start', gap: fixed(24), padding: P(lineGap + 2), decorations: [edge('footer-line', 'top')] }) };
}
/** Compact chrome used by the last authored content frames. */
export function editorialChrome(ids: {
    context: string;
    year: string;
    format: string;
    footer: string;
    page: string;
}, formatW: number, pageW = 69) {
    return {
        regions: [R('context', 'context', ids.context, B(46, 56.5, 197, 29), 'text', 0),
            R('year', 'year', ids.year, B(393, 56.5, 59, 29), 'text', 0),
            R('format', 'format', ids.format, B(1874 - formatW, 56.5, formatW, 29), 'text', 0),
            R('footer', 'footer', ids.footer, B(46, 1019, 530, 27), 'text', 0),
            R('page', 'page', ids.page, B(1874 - pageW, 1019, pageW, 27), 'text', 0)],
        groups: [G('header-row', B(46, 44, 1828, 54), 'row', [CG('context-year'), C('format', { pushToEnd: true })], { align: 'center', gap: fixed(16), size: { width: fixed(1828), height: fixed(54) } }),
            G('context-year', B(46, 56.5, 406, 29), 'row', [C('context'), C('year')], { align: 'center', gap: fixed(16), flowSeparators: [{ id: 'context-rule', afterId: 'context', beforeId: 'year', role: 'context-separator', width: 118, height: 2, gap: 16 }] }),
            G('footer-row', B(46, 1012, 1828, 34), 'row', [C('footer'), C('page', { pushToEnd: true })], { align: 'end', gap: fixed(24), size: { width: fixed(1828), height: fixed(34) } })],
    };
}
/** Inferred vertical flow from authored bands. Positive distances become elastic
 * neighbour gaps; no absolute child coordinate is emitted at runtime. */
export function stack(rect: Rect, children: ChildRef[], bands: Record<string, Rect>, extra: Partial<Group> = {}): Group {
    const refs = children.map((item, i) => {
        const dx = Math.max(0, (bands[item.id]?.x ?? rect.x) - rect.x);
        const c = { ...item, ...(dx ? { marginBeforeCrossPx: dx } : {}) };
        if (!i)
            return c;
        const prev = bands[children[i - 1].id], next = bands[c.id];
        if (!prev || !next)
            throw Error('Missing authored band');
        const gap = Math.max(0, next.y - prev.y - prev.h);
        return { ...c, gapBefore: c.gapBefore ?? range(Math.min(gap, 24), gap, Math.max(gap, gap * 1.3)) };
    });
    const last = bands[children.at(-1)?.id ?? ''];
    const tail = last ? Math.max(0, rect.y + rect.h - last.y - last.h) : 0;
    const first = bands[children[0]?.id ?? ''];
    return root(rect, refs, { padding: P(Math.max(0, (first?.y ?? rect.y) - rect.y)), trailingSpace: range(0, tail, Math.max(tail, 32)), ...extra });
}
// ===== contracts.ts =====
/** Field contracts and internal layouts. Values are supplied as immutable refs. */
const head = (prefix = 'h') => IG(`${prefix}-group`, [F(`${prefix}-index`, 'index', 'index'), F(`${prefix}-title`, 'heading', 'column-title')], { gap: fixed(12) });
const bullet = () => IG('bullet', [F('marker', 'marker', 'list-marker', { preferredWidth: 56 }), F('text', 'text', 'body', { flex: { grow: 1, shrink: 1, basis: 0 } })], { direction: 'row', gap: fixed(18), align: 'start' });
const body = (id: string, path: string, role = 'body') => F(id, path, role);
const excerpt = (id: string, gap: number) => PL(id, IG('root', [head(), body('body', 'body'), body('note', 'note', 'note')], { gap: fixed(gap) }));
const lineTop = edge('top-rule', 'top');
const explanation = BC('explanation', { index: single(false), heading: single(), body: single(), note: single(false) }, [excerpt('explanation-24', 24), excerpt('explanation-22', 22)]);
const principle = BC('principle', { index: single(false), heading: single(), body: single(), items: list(1, 4, { marker: opt, text: req }, false) }, [PL('principle', IG('root', [head(), body('body', 'body'), RP('items', 'items', 1, 4, bullet(), { gap: fixed(28) })], { gap: fixed(28), padding: P(28), decorations: [lineTop] }))]);
const article = BC('article-section', { index: single(false), heading: single(), paragraphs: list(1, 4, { text: req }) }, [PL('article-section', IG('root', [head(), RP('paragraphs', 'paragraphs', 1, 4, IG('paragraph', [F('text', 'text', 'body-small')]), { gap: fixed(18) })], { gap: fixed(18) }))]);
const actions = BC('action-list', { index: single(false), heading: single(), items: list(1, 6, { marker: opt, text: req }) }, [PL('action-list', IG('root', [head(), RP('items', 'items', 1, 6, bullet(), { gap: fixed(22) })], { gap: fixed(22) }))]);
const credit = (roleName: string) => IG('credit', [F('author', 'author', 'quote-author'), F('source', 'source', roleName)], { gap: fixed(10) });
const quote = BC('quote', { quote: single(), author: single(), source: single(false) }, [
    PL('summary-quote', IG('root', [F('quote', 'quote', 'quote'), credit('note')], { justify: 'space-between', gap: fixed(24) })),
    PL('hero-quote', IG('root', [
        { id: 'quote-sign', kind: 'ornament', ornamentRole: 'quotation-mark', ornamentSize: { w: 54, h: 91 } },
        F('quote', 'quote', 'quote-display'), credit('quote-role'),
    ], { justify: 'space-between', gap: fixed(24) })),
]);
const commentary = BC('commentary', { index: single(false), heading: single(), body: single(), note: single(false) }, [
    PL('commentary', IG('root', [head(), F('body', 'body', 'body'),
        IG('conclusion-reserve', [IG('conclusion', [F('note', 'note', 'note')], { padding: P(18), decorations: [lineTop] })], { flex: { grow: 1, shrink: 1 }, justify: 'end' }),
    ], { gap: fixed(28), padding: P(84, 0, 24) })),
]);
const author = BC('author', { index: single(false), name: single(), role: single(false) }, [PL('author', IG('root', [F('index', 'index', 'index'), F('name', 'name', 'author-name'), F('role', 'role', 'author-role')], { gap: fixed(12) }))]);
const metric = BC('metric', { value: single(), caption: single(), note: single(false) }, [
    PL('metric-cover', IG('root', [F('value', 'value', 'metric-value'), F('caption', 'caption', 'metric-caption'), F('note', 'note', 'note')], { gap: fixed(18) })),
    PL('metric-summary', IG('root', [F('value', 'value', 'metric-value'), F('caption', 'caption', 'metric-caption'), F('note', 'note', 'note')], { gap: fixed(8) })),
]);
const headingBody = BC('heading-body', { eyebrow: single(false), title: single(), body: single(false) }, [
    PL('heading-body-34', IG('root', [F('eyebrow', 'eyebrow', 'eyebrow'), F('title', 'title', 'title'), F('body', 'body', 'support')], { gap: fixed(34) })),
    PL('heading-body-28', IG('root', [F('eyebrow', 'eyebrow', 'eyebrow'), F('title', 'title', 'title'), F('body', 'body', 'support')], { gap: fixed(28) })),
]);
const passport = BC('passport', { kind: single(false), title: single(), update: single(false) }, [PL('passport', IG('root', [F('kind', 'kind', 'header'), F('title', 'title', 'title'), F('update', 'update', 'support')], { gap: fixed(28) }))]);
const metadata = BC('metadata', { label: single(), value: single() }, [PL('metadata', IG('root', [F('label', 'label', 'metadata-label'), F('value', 'value', 'metadata-value')], { gap: fixed(14) }))]);
const partner = BC('partner', { name: single() }, [PL('partner-name', IG('root', [F('name', 'name', 'partner-name', { textAlign: 'center' })], { justify: 'center', align: 'stretch', padding: P(24, 24, 24, 24), surfaceRole: 'partner-panel' }))]);
const theses = BC('thesis-list', { items: list(1, 7, { marker: opt, text: req }), conclusion: single(false) }, [2, 1].map(n => PL(`theses-${n}-columns`, RP('items', 'items', 1, 7, bullet(), {
    columns: n, readingOrder: 'column-major', gap: fixed(30),
    tail: IG('conclusion', [F('conclusion-text', 'conclusion', 'callout')], { surfaceRole: 'callout', padding: P(24, 24, 24, 24) }),
}))));
const step = BC('step', { marker: single(), heading: single(), body: single() }, [PL('step-row', IG('root', [F('marker', 'marker', 'step-marker', { preferredWidth: 130 }), F('heading', 'heading', 'step-heading', { preferredWidth: 439 }), F('body', 'body', 'body-small', { flex: { grow: 1, shrink: 1, basis: 0 } })], { direction: 'row', gap: fixed(24), align: 'center', padding: P(12, 0, 12) }))]);
const episode = BC('episode', { time: single(), heading: single(), body: single() }, [PL('episode-row', IG('root', [F('time', 'time', 'time', { preferredWidth: 285 }), F('heading', 'heading', 'episode-heading', { preferredWidth: 439 }), F('body', 'body', 'body-small', { flex: { grow: 1, shrink: 1, basis: 0 } })], { direction: 'row', gap: fixed(24), align: 'center', padding: P(12, 0, 12) }))]);
export const contracts: Readonly<Record<string, BlockContract>> = {
    text: BC('text', { text: single() }, [PL('text', IG('root', [F('text', 'text', 'body')]))], null),
    label: BC('label', { text: single() }, [PL('label', IG('root', [F('text', 'text', 'tag')], { padding: P(12, 24, 12, 24), surfaceRole: 'tag' }))]),
    explanation, principle, 'article-section': article, 'action-list': actions, quote, commentary, author, metric,
    'heading-body': headingBody, passport, metadata, partner, 'thesis-list': theses, step, episode,
    visual: BC('visual', { assetRef: single(), visualType: { kind: 'visual-type', required: true } }, [], null),
};
// ===== recipes/editorial.ts =====
export const editorialStates: State[] = (() => {
    const FAMILY = 'editorial-explanations';
    const fill = { grow: 1, shrink: 1, growPriority: 1, shrinkPriority: 1 };
    const notes = ['Column-count changes are authorised recipe extensions, not additional Figma frames.', 'A column is a complete immutable semantic block; its internal fields never migrate to another column.'];
    const twoColumns = S('two-explanations-01', FAMILY, 'two-explanations', '8:1082', [
        R('title', 'title', '8:1091', B(46, 44, 1365, 160)),
        R('explanations', 'explanations', '8:1093', B(46, 274, 1828, 772), 'explanation', 1, 2, {
            layouts: columns(2, 2, 24, 'end', { cellHeight: { mode: 'reference', preferred: 354 }, itemPadding: { first: P(0, 72), middle: P(0, 0, 0, 72), last: P(0, 0, 0, 72) }, betweenItemsRole: 'editorial-divider' }),
            preferredLayoutId: 'columns-2', primitiveLayoutIds: ['explanation-24'],
        }),
    ], [
        G('intro-band', B(46, 44, 1828, 196), 'column', [C('title')], { padding: P(0, 0, 36), decorations: [edge('title-rule', 'bottom')], align: 'stretch' }),
        root(B(46, 44, 1828, 1002), [CG('intro-band'), C('explanations', { flex: fill })], { gap: range(24, 34, 44) }),
    ], notes);
    const principles = S('principles-01', FAMILY, 'principles', '8:1110', [
        R('title', 'title', '8:1120', B(46, 44, 1211, 168)), R('lead', 'lead', '8:1121', B(1435, 110, 439, 102), 'text', 0),
        R('principles', 'principles', '8:1122', B(46, 252, 1828, 794), 'principle', 1, 3, {
            layouts: columns(3, 3, 24, 'end', { cellHeight: { mode: 'reference', preferred: 379 } }), preferredLayoutId: 'columns-3',
        }),
    ], [
        G('intro-row', B(46, 44, 1828, 168), 'row', [C('title'), C('lead', { pushToEnd: true })], { gap: range(24, 178, 240), align: 'end' }),
        root(B(46, 44, 1828, 1002), [CG('intro-row'), C('principles', { flex: fill })], { gap: range(24, 40, 52) }),
    ], notes);
    const article = S('long-article-01', FAMILY, 'long-article', '8:1300', [
        R('title', 'title', '8:1310', B(46, 44, 1211, 122)), R('lead', 'lead', '8:1311', B(1435, 46, 439, 120), 'text', 0),
        R('sections', 'article-sections', '8:1313', B(46, 216, 1828, 748), 'article-section', 1, 3, {
            layouts: columns(3, 3, 36, 'start', { cellHeight: { mode: 'hug' } }), preferredLayoutId: 'columns-3',
        }),
        R('footnotes', 'footnotes', undefined, B(46, 1002, 1828, 44), 'text', 0, 3, {
            layouts: columns(3, 3, 36), preferredLayoutId: 'columns-3', typographyRole: 'footnote',
        }),
    ], [
        G('intro-row', B(46, 44, 1828, 148), 'row', [C('title'), C('lead', { pushToEnd: true })], { gap: range(24, 178, 240), align: 'end', padding: P(0, 0, 26), decorations: [edge('article-rule', 'bottom')] }),
        G('footnotes-row', B(46, 988, 1828, 58), 'column', [C('footnotes')], { padding: P(14), decorations: [edge('footnote-rule', 'top', 0, 1)], align: 'stretch' }),
        root(B(46, 44, 1828, 1002), [CG('intro-row'), C('sections', { flex: fill }), CG('footnotes-row')], { gap: fixed(24) }),
    ], [...notes, 'Footnotes are a single occupancy row: it disappears only when no footnote was supplied. Their order remains the source order; reference numerals are source content.']);
    const summary = S('mixed-summary-01', FAMILY, 'mixed-summary', '8:1463', [
        R('tag', 'tag', '8:1474', B(46, 44, 255, 53), 'label', 0), R('title', 'title', '8:1476', B(46, 119, 1211, 156)),
        R('metric', 'metric', '8:1477', B(1281, 44, 593, 170), 'metric', 1, 1, { primitiveLayoutIds: ['metric-summary'] }),
        R('actions', 'actions', '8:1482', B(46, 333, 748, 292), 'action-list'),
        R('check', 'check', '8:1495', B(818, 333, 439, 318), 'explanation', 1, 1, { primitiveLayoutIds: ['explanation-22'] }),
        R('quote', 'quote', '8:1501', B(1281, 333, 593, 713), 'quote', 1, 1, { primitiveLayoutIds: ['summary-quote'] }),
    ], [
        G('title-stack', B(46, 44, 1211, 231), 'column', [C('tag'), C('title')], { gap: fixed(22), align: 'stretch' }),
        G('metric-shell', B(1281, 44, 593, 170), 'column', [C('metric', { flex: fill })], { padding: P(0, 0, 0, 36), decorations: [edge('metric-left', 'left')], align: 'stretch' }),
        G('intro-row', B(46, 44, 1828, 261), 'row', [CG('title-stack'), CG('metric-shell', { flex: fill })], { gap: fixed(24), padding: P(0, 0, 30), decorations: [edge('summary-rule', 'bottom')] }),
        G('actions-shell', B(46, 333, 748, 292), 'column', [C('actions')], { padding: P(0, 32), align: 'stretch' }),
        G('check-shell', B(818, 333, 439, 318), 'column', [C('check')], { padding: P(0, 28, 0, 28), decorations: [edge('check-left', 'left', 0, 1), edge('check-right', 'right', 0, 1)], align: 'stretch' }),
        G('quote-shell', B(1281, 333, 593, 713), 'column', [C('quote', { flex: fill })], { padding: P(0, 0, 0, 28), align: 'stretch' }),
        G('summary-main', B(46, 333, 1828, 713), 'row', [CG('actions-shell'), CG('check-shell'), CG('quote-shell', { flex: fill })], { gap: fixed(24), align: 'start' }),
        root(B(46, 44, 1828, 1002), [CG('intro-row'), CG('summary-main', { flex: fill })], { gap: fixed(28) }),
    ], ['Summary is heterogeneous: actions, check and quote are not interchangeable column types.', 'A component is measured in the inner shell, after the reserved divider/padding.']);
    const chrome = editorialChrome({ context: '39:652', year: '39:654', format: '39:656', footer: '39:674', page: '39:675' }, 294);
    const bigQuote = S('quote-comment-01', FAMILY, 'quote-comment', '39:650', [
        ...chrome.regions,
        R('quote', 'quote', '39:659', B(46, 122, 1211, 866), 'quote', 1, 1, { primitiveLayoutIds: ['hero-quote'], emphasis: ['primary'], maxPrimaryItems: 1 }),
        R('comment', 'comment', '39:665', B(1281, 122, 593, 866), 'commentary'),
    ], [
        ...chrome.groups,
        G('quote-shell', B(46, 122, 1211, 866), 'column', [C('quote', { flex: fill })], { padding: P(0, 52), align: 'stretch' }),
        G('comment-shell', B(1281, 122, 593, 866), 'column', [C('comment', { flex: fill })], { padding: P(0, 0, 0, 44), decorations: [edge('comment-left', 'left')], align: 'stretch' }),
        G('quote-main', B(46, 122, 1828, 866), 'row', [CG('quote-shell'), CG('comment-shell', { flex: fill })], { gap: fixed(24), align: 'stretch' }),
        root(B(46, 44, 1828, 1002), [CG('header-row'), CG('quote-main', { flex: fill }), CG('footer-row')], { gap: fixed(24) }),
    ], ['Quotation mark is a DS ornament, not a copied glyph or a fabricated content fragment.', 'Quote credits are bottom-aligned; the comment conclusion and its rule collapse together when absent.'], 'slide-inverse');
    return [twoColumns, principles, summary, article, bigQuote];
})();
// ===== recipes/covers.ts =====
export const coverStates: State[] = (() => {
    const FAMILY = 'covers-passports';
    const fill = { grow: 1, shrink: 1, growPriority: 1, shrinkPriority: 1 };
    const colNotes = ['One/two/three-column reflows are explicit recipe extensions. All supplied blocks remain present in source order.', 'Changing column count recalculates track bases; the +/-30% range applies to enclosing regions and to local adjustment around the new topology.'];
    function stackRoot(groups: Group[], regions: Region[], ids: string[], rect = B(46, 44, 1828, 1002), growing?: string) {
        const bands = Object.fromEntries([...groups, ...regions].map(n => [n.id, n.preferredRect]));
        return stack(rect, ids.map(id => groups.some(g => g.id === id) ? CG(id, id === growing ? { flex: fill } : {}) : C(id, id === growing ? { flex: fill } : {})), bands);
    }
    function authors(): State {
        const h = plainHeader('41:392', '41:393', 320);
        const regions = [...h.regions, R('title', 'title', '41:395', B(46, 168, 1320, 327)), R('description', 'description', '41:396', B(1410, 184, 464, 102), 'text', 0),
            R('authors', 'authors', '41:397', B(46, 708, 1828, 286), 'author', 1, 3, { layouts: columns(3, 3, 0, 'stretch', {
                    itemPadding: { first: P(24, 52), middle: P(24, 40, 0, 34), last: P(24, 0, 0, 34) }, betweenItemsRole: 'editorial-divider', borderEdges: ['top'], cellHeight: { mode: 'fill' }, preferredWeights: [610, 610, 608],
                }), preferredLayoutId: 'columns-3' })];
        const groups = [h.group, G('title-row', B(46, 168, 1828, 327), 'row', [C('title'), C('description', { pushToEnd: true, marginBeforeCrossPx: 16 })], { gap: range(24, 44, 64) })];
        return S('authors-cover-01', FAMILY, 'authors-cover', '41:391', regions, [...groups, stackRoot(groups, regions, ['header-row', 'title-row', 'authors'], undefined, 'title-row')], colNotes);
    }
    function chapter(): State {
        const h = plainHeader('41:483', '41:484'), f = footer('41:492', undefined, 980, 660, 364, 27, 27, 30);
        const regions = [...h.regions, ...f.regions, R('chapter', 'chapter-number', '41:486', B(36, 150, 710, 377)),
            R('heading', 'heading', '41:487', B(840, 200, 1034, 610), 'heading-body', 1, 1, { primitiveLayoutIds: ['heading-body-34'], emphasis: ['primary'], maxPrimaryItems: 1 })];
        const groups = [h.group, f.group, G('heading-shell', B(840, 200, 1034, 610), 'column', [C('heading', { flex: fill })], { padding: P(0, 0, 0, 42), decorations: [edge('heading-left', 'left')], align: 'stretch' }),
            G('chapter-main', B(36, 150, 1838, 660), 'row', [C('chapter'), CG('heading-shell', { marginBeforeCrossPx: 50, flex: fill })], { gap: range(24, 94, 124) })];
        return S('chapter-cover-01', FAMILY, 'chapter-cover', '41:482', regions, [...groups, stackRoot(groups, regions, ['header-row', 'chapter-main', 'footer-row'], B(36, 44, 1838, 1002), 'chapter-main')], ['Authored chapter numeral has a 10px optical left extension. The main root starts at x36; header/footer retain their 10px inset.']);
    }
    function split(): State {
        const h = plainHeader('39:526', '39:525', 320, 374), f = footer('39:517', '39:516', 954, 520, 464, 27, 54, 42);
        const regions = [...h.regions, ...f.regions, R('eyebrow', 'eyebrow', '39:523', B(46, 192, 310, 68), 'text', 0), R('title', 'title', '39:522', B(46, 278, 1080, 274)),
            R('subtitle', 'subtitle', '39:519', B(1270, 286, 604, 470), 'heading-body', 1, 1, { primitiveLayoutIds: ['heading-body-28'] })];
        const groups = [h.group, f.group, G('title-stack', B(46, 192, 1080, 360), 'column', [C('eyebrow'), C('title')], { gap: fixed(18), align: 'stretch' }),
            G('subtitle-shell', B(1270, 286, 604, 470), 'column', [C('subtitle', { flex: fill })], { padding: P(0, 0, 0, 34), decorations: [edge('subtitle-left', 'left')], align: 'stretch' }),
            G('split-main', B(46, 192, 1828, 564), 'row', [CG('title-stack'), CG('subtitle-shell', { flex: fill, marginBeforeCrossPx: 94 })], { gap: range(24, 144, 184) })];
        return S('split-cover-01', FAMILY, 'split-cover', '39:515', regions, [...groups, stackRoot(groups, regions, ['header-row', 'split-main', 'footer-row'], undefined, 'split-main')]);
    }
    function media(): State {
        const f = footer('39:529', '39:528', 994, 480);
        const regions = [...f.regions, R('header-left', 'header-left', '39:538', B(46, 44, 320, 54), 'text', 0), R('title', 'title', '39:536', B(46, 160, 1010, 297)),
            R('intro', 'intro', '39:535', B(46, 604, 1000, 220), 'text', 0), R('visual', 'visual', '39:531', B(1170, 44, 704, 870), 'visual')];
        const groups = [f.group, G('left-header', B(46, 44, 1068, 62), 'column', [C('header-left')], { padding: P(0, 0, 8), decorations: [edge('left-header-rule', 'bottom')], align: 'stretch' }),
            G('left-column', B(46, 44, 1068, 870), 'column', [CG('left-header'), C('title', { gapBefore: range(24, 54, 72) }), C('intro', { gapBefore: range(24, 147, 191) })], { align: 'start', trailingSpace: range(0, 90, 118) }),
            G('media-main', B(46, 44, 1828, 870), 'row', [CG('left-column'), C('visual', { flex: fill })], { gap: range(24, 56, 72), align: 'start' })];
        return S('media-intro-01', FAMILY, 'media-intro', '39:527', regions, [...groups, stackRoot(groups, regions, ['media-main', 'footer-row'], undefined, 'media-main')], ['Media crosshairs and placeholder labels are not content. Only the supplied asset is rendered.']);
    }
    function dated(): State {
        const f = footer('39:540', undefined, 982, 620, 364, 54, 54, 28);
        const regions = [...f.regions, R('status', 'status', '39:550', B(46, 48, 600, 58), 'text', 0), R('version', 'version', '39:549', B(1510, 58, 364, 34), 'text', 0),
            R('date', 'date', '39:547', B(46, 242, 820, 148)), R('year-large', 'year-large', '39:546', B(46, 408, 820, 148), 'text', 0),
            R('passport', 'passport', '39:542', B(1000, 242, 874, 620), 'passport', 1, 1, { emphasis: ['primary'], maxPrimaryItems: 1 })];
        const groups = [f.group, G('status-row', B(0, 0, 1920, 174), 'row', [C('status'), C('version', { pushToEnd: true, marginBeforeCrossPx: 10 })], { surfaceRole: 'status-band', padding: P(48, 46, 68, 46), gap: fixed(24) }),
            G('date-stack', B(46, 242, 820, 314), 'column', [C('date'), C('year-large')], { gap: fixed(18), align: 'stretch' }),
            G('passport-shell', B(1000, 242, 874, 620), 'column', [C('passport', { flex: fill })], { padding: P(0, 0, 0, 40), decorations: [edge('passport-left', 'left')], align: 'stretch' }),
            G('dated-main', B(46, 242, 1828, 620), 'row', [CG('date-stack'), CG('passport-shell', { flex: fill })], { gap: range(24, 134, 172) }),
            G('dated-body', B(46, 242, 1828, 794), 'column', [CG('dated-main', { flex: fill }), CG('footer-row', { gapBefore: range(24, 90, 116) })], { align: 'stretch' })];
        return S('dated-passport-01', FAMILY, 'dated-passport', '39:539', regions, [...groups, root(B(0, 0, 1920, 1080), [CG('status-row'), CG('dated-body', { gapBefore: range(24, 68, 88), alignSelf: 'center', flex: fill })], { trailingSpace: range(0, 44, 56) })], ['Status/version form one occupancy band. It collapses only when both fields are absent; its DS surface belongs to the surviving band.']);
    }
    function rail(): State {
        const h = plainHeader('39:599', '39:598', 430, 364, 342, 1532);
        const regions = [...h.regions, R('kind', 'kind', '39:603', B(46, 48, 200, 27), 'text', 0), R('subject', 'subject', '39:602', B(46, 180, 200, 93)), R('rail-year', 'rail-year', '39:601', B(46, 960, 200, 34), 'text', 0),
            R('title', 'title', '39:596', B(342, 144, 1450, 575)), R('support', 'support', '39:595', B(342, 913, 890, 68), 'text', 0), R('footer-right', 'footer-right', '39:594', B(1510, 974, 364, 27), 'text', 0)];
        const groups = [h.group, G('rail', B(0, 0, 292, 1080), 'column', [C('kind'), C('subject', { gapBefore: range(24, 105, 136) }), C('rail-year', { pushToEnd: true })], { surfaceRole: 'sidebar-inverse', size: { width: fixed(292), height: fixed(1080) }, padding: P(48, 46, 86, 46), gap: fixed(24), collapseEmpty: false }),
            G('bottom-row', B(342, 913, 1532, 88), 'row', [C('support'), C('footer-right', { pushToEnd: true, alignSelf: 'end' })], { gap: range(24, 278, 340) }),
            G('body-column', B(342, 44, 1532, 957), 'column', [CG('header-row'), C('title', { gapBefore: range(24, 38, 52) }), CG('bottom-row', { gapBefore: range(24, 194, 252), pushToEnd: true })], { align: 'stretch' })];
        return S('sidebar-cover-01', FAMILY, 'sidebar-cover', '39:593', regions, [...groups, root(B(0, 0, 1920, 1080), [CG('rail'), CG('body-column', { marginBeforeCrossPx: 44, flex: fill })], { direction: 'row', padding: P(0, 46), gap: fixed(50), align: 'start' })], ['The sidebar subject is required for this mode. Year and type may be absent; the rail never becomes an accidental unowned decoration.']);
    }
    function metadataCover(): State {
        const h = plainHeader('39:627', '39:626'), f = footer('39:606', undefined, 994, 820);
        // There is no extra rule at y968: the metadata band's bottom edge is the rule.
        f.group.decorations = [];
        f.group.padding = P();
        f.group.preferredRect = B(46, 994, 1828, 27);
        f.group.size = { width: fixed(1828), height: range(20, 27, 35) };
        const regions = [...h.regions, ...f.regions, R('title', 'title', '39:624', B(46, 154, 1120, 392)), R('visual', 'visual', '39:620', B(1250, 154, 624, 522), 'visual'),
            R('metadata', 'metadata', '39:607', B(46, 726, 1828, 238), 'metadata', 1, 4, { layouts: columns(4, 4, 0, 'stretch', {
                    preferredWeights: [330, 330, 330, 838], itemPadding: { first: P(24, 28), middle: P(24, 28, 0, 28), last: P(24, 0, 0, 28) }, betweenItemsRole: 'editorial-divider', borderEdges: ['top', 'bottom'], cellHeight: { mode: 'fill' },
                }), preferredLayoutId: 'columns-4' })];
        const groups = [h.group, f.group, G('title-media', B(46, 154, 1828, 522), 'row', [C('title'), C('visual', { flex: fill })], { gap: range(24, 84, 108) })];
        return S('metadata-cover-01', FAMILY, 'metadata-cover', '39:605', regions, [...groups, stackRoot(groups, regions, ['header-row', 'title-media', 'metadata', 'footer-row'], undefined, 'title-media')], ['Metadata label/value pairs are atomic. The final wide reference cell is a positional weight, not a hardcoded field name.', 'Columns 1–4 are authorised; no supplied key/value may be silently removed.']);
    }
    function partners(): State {
        const h = plainHeader('41:494', '41:495'), f = footer('41:513', undefined, 994, 700);
        const regions = [...h.regions, ...f.regions, R('title', 'title', '41:497', B(46, 168, 1280, 321)), R('description', 'description', '41:498', B(1400, 188, 474, 102), 'text', 0),
            R('program-visual', 'program-visual', '41:499', B(46, 594, 460, 300), 'visual', 0, 1, { allowedVisualTypes: ['logo', 'illustration', 'abstract-graphic'] }), R('partners-title', 'partners-title', '41:504', B(590, 594, 500, 27), 'text', 0),
            R('partners', 'partners', '41:505', B(590, 649, 1284, 245), 'partner', 1, 3, { accepts: ['partner', 'visual'], allowedVisualTypes: ['logo'], priority: 'mixed-partners', layouts: columns(3, 3, 22, 'stretch', { preferredWeights: [400, 400, 440], cellHeight: { mode: 'fill' } }), preferredLayoutId: 'columns-3' })];
        const groups = [h.group, f.group, G('title-row', B(46, 168, 1828, 321), 'row', [C('title'), C('description', { pushToEnd: true, marginBeforeCrossPx: 20 })], { gap: range(24, 74, 96) }),
            G('partners-stack', B(590, 594, 1284, 300), 'column', [C('partners-title'), C('partners', { flex: fill })], { gap: fixed(28), align: 'stretch' }),
            G('partners-main', B(46, 594, 1828, 300), 'row', [C('program-visual'), CG('partners-stack', { flex: fill })], { gap: range(24, 84, 108) })];
        return S('partners-cover-01', FAMILY, 'partners-cover', '41:493', regions, [...groups, stackRoot(groups, regions, ['header-row', 'title-row', 'partners-main', 'footer-row'], undefined, 'title-row')], ['Partner names and supplied logo assets are distinct locked blocks. Logos always use contain; no logo is invented from a name.', 'A missing program image collapses its child; the partners row remains.']);
    }
    return [authors(), chapter(), split(), media(), dated(), rail(), metadataCover(), partners()];
})();
// ===== recipes/metrics.ts =====
export const metricStates: State[] = (() => {
    const FAMILY = 'key-metrics';
    function metrics(content: boolean): State {
        const h = content ? plainHeader('39:591', '39:590') : null;
        const titleY = content ? 156 : 55;
        const regions = [...(h?.regions ?? []), R('title', 'title', content ? '39:588' : '39:567', B(46, titleY, 1040, 198)),
            R('description', 'description', content ? '39:587' : '39:566', B(1270, titleY + 18, 604, 105), 'text', 0),
            R('metrics', 'metrics', content ? '39:574' : '39:553', B(46, 560, 1828, 392), 'metric', 1, 3, {
                primitiveLayoutIds: ['metric-cover'], layouts: columns(3, 3, 0, 'stretch', {
                    preferredWeights: [610, 610, 608], itemPadding: { first: P(28, 46), middle: P(28, 34, 0, 34), last: P(28, 0, 0, 34) },
                    betweenItemsRole: 'editorial-divider', borderEdges: ['top', 'bottom'], cellHeight: { mode: 'fill' },
                }), preferredLayoutId: 'columns-3',
            }), R('footer', 'footer', content ? '39:573' : '39:552', B(46, 990, 680, 54), 'text', 0)];
        const groups = [...(h ? [h.group] : []), G('title-row', B(46, titleY, 1828, 198), 'row', [C('title'), C('description', { pushToEnd: true, marginBeforeCrossPx: 18 })], { gap: range(24, 184, 240) })];
        const bands = Object.fromEntries([...regions, ...groups].map(n => [n.id, n.preferredRect]));
        return S(content ? 'key-metrics-content-01' : 'key-metrics-cover-01', FAMILY, 'key-metrics', content ? '39:572' : '39:551', regions, [...groups,
            stack(B(46, 44, 1828, 1002), [...(h ? [CG('header-row')] : []), CG('title-row'), C('metrics', { gapBefore: range(24, 560 - titleY - 198, 399), flex: { grow: 1, shrink: 1, growPriority: 1, shrinkPriority: 2 } }), C('footer')], bands),
        ], ['The bare cover and the version with a service row are states of one family, not different semantic contents.', 'Metrics preserve value → caption → optional note as a top-aligned stack, not a value-top/caption-bottom panel.', 'The enclosing band has +/-30% bounds. Track widths are recalculated for authorised 1/2/3-column topology; source metric values are never parsed or rewritten.']);
    }
    return [metrics(false), metrics(true)];
})();
// ===== recipes/lists.ts =====
export const listStates: State[] = (() => {
    const FAMILY = 'lists-scenarios';
    const fill = { grow: 1, shrink: 1, growPriority: 1, shrinkPriority: 1 };
    function seven(copy = false): State {
        const id = (n: number) => `39:${n + (copy ? 45 : 0)}`;
        const chrome = editorialChrome({ context: id(679), year: id(681), format: id(683), footer: id(719), page: id(720) }, 418);
        const regions = [...chrome.regions, R('tag', 'tag', id(688), B(46, 122, 217, 53), 'label', 0), R('title', 'title', id(690), B(46, 201, 696, 332)),
            R('note', 'note', id(691), B(46, 932, 696, 56), 'text', 0), R('theses', 'theses', id(692), B(818, 122, 1056, 866), 'thesis-list', 1, 1, { primitiveLayoutIds: ['theses-2-columns', 'theses-1-columns'] })];
        const groups = [...chrome.groups, G('title-block', B(46, 122, 696, 411), 'column', [C('tag'), C('title')], { gap: fixed(26), align: 'stretch' }),
            G('left-column', B(46, 122, 748, 866), 'column', [CG('title-block'), C('note', { pushToEnd: true })], { padding: P(0, 52), gap: fixed(24), align: 'stretch' }),
            G('theses-shell', B(818, 122, 1056, 866), 'column', [C('theses', { flex: fill })], { padding: P(0, 0, 0, 40), decorations: [edge('theses-left', 'left')], align: 'stretch' }),
            G('main-row', B(46, 122, 1828, 866), 'row', [CG('left-column'), CG('theses-shell', { flex: fill })], { gap: fixed(24), align: 'stretch' })];
        const state = S(copy ? 'seven-theses-reference-copy' : 'seven-theses-01', FAMILY, 'seven-theses', copy ? '39:722' : '39:677', regions, [...groups,
            root(B(46, 44, 1828, 1002), [CG('header-row'), CG('main-row', { flex: fill }), CG('footer-row')], { gap: fixed(24) })], ['Reference has seven ordered items, first four in the left lane and last three in the right. The conclusion follows the final item.', 'The declared 1..7-item contract and single-column reflow are authorised extensions. No filler items or auto-generated numbered text.', 'The second Figma frame is an exact structural alias and has no extra candidate weight.']);
        if (copy)
            state.aliasOf = 'seven-theses-01';
        return state;
    }
    const stepsChrome = editorialChrome({ context: '8:1212', year: '8:1214', format: '8:1216', footer: '8:1245', page: '8:1246' }, 309);
    const steps = S('five-steps-01', FAMILY, 'five-steps', '8:1210', [
        ...stepsChrome.regions, R('title', 'title', '8:1220', B(46, 122, 1056, 148)), R('lead', 'lead', '8:1221', B(1281, 165, 593, 105), 'text', 0),
        R('steps', 'steps', '8:1223', B(46, 320, 1828, 668), 'step', 1, 5, { layouts: [{ ...one, id: 'step-rows', maxItems: 5, cellHeight: { mode: 'fill' }, betweenItemsRole: 'editorial-divider' }], preferredLayoutId: 'step-rows' }),
    ], [
        ...stepsChrome.groups, G('intro-row', B(46, 122, 1828, 174), 'row', [C('title'), C('lead', { pushToEnd: true })], { gap: range(24, 179, 232), align: 'end', padding: P(0, 0, 26), decorations: [edge('intro-rule', 'bottom')] }),
        G('main-column', B(46, 122, 1828, 866), 'column', [CG('intro-row'), C('steps', { flex: fill })], { gap: fixed(24), align: 'stretch' }),
        root(B(46, 44, 1828, 1002), [CG('header-row'), CG('main-column', { flex: fill }), CG('footer-row')], { gap: fixed(24) }),
    ], ['1..5 complete step rows are allowed. Marker, heading and body have a shared cross-row track definition (130 / 439 / remainder at native width).', 'Separators belong between live rows; the final row has no bottom separator.']);
    const episodeChrome = editorialChrome({ context: '39:769', year: '39:771', format: '39:773', footer: '39:795', page: '39:796' }, 346, 65);
    const episodes = S('day-scenario-01', FAMILY, 'day-scenario', '39:767', [
        ...episodeChrome.regions, R('title', 'title', '39:777', B(46, 122, 1056, 148)), R('lead', 'lead', '39:778', B(1281, 200, 593, 70), 'text', 0),
        R('episodes', 'episodes', '39:780', B(46, 332, 1828, 598), 'episode', 1, 3, { layouts: [{ ...one, id: 'episode-rows', maxItems: 3, cellHeight: { mode: 'fill' }, betweenItemsRole: 'editorial-divider' }], preferredLayoutId: 'episode-rows' }),
        R('note', 'note', '39:793', B(46, 960, 1828, 28), 'text', 0),
    ], [
        ...episodeChrome.groups, G('intro-row', B(46, 122, 1828, 180), 'row', [C('title'), C('lead', { pushToEnd: true })], { gap: range(24, 179, 232), align: 'end', padding: P(0, 0, 32), decorations: [edge('intro-rule', 'bottom')] }),
        G('main-column', B(46, 122, 1828, 866), 'column', [CG('intro-row'), C('episodes', { flex: fill }), C('note')], { gap: fixed(30), align: 'stretch' }),
        root(B(46, 44, 1828, 1002), [CG('header-row'), CG('main-column', { flex: fill }), CG('footer-row')], { gap: fixed(24) }),
    ], ['1..3 episodes are allowed. Time is immutable source text, not a generated clock value.', 'The note and the service footer are separate occupancy groups. A page number retains the footer even without the source caption.']);
    return [seven(), seven(true), steps, episodes];
})();
// ===== runtime.ts =====
export type SlotPlan = {
    id: string;
    block: BoundBlockPlan;
    row: number;
    column: number;
    padding: Insets;
    decorations: (EdgeDecoration & {
        ownerNodeId: string;
    })[];
    trackWeight: number;
    height: 'hug' | 'fill' | 'reference';
    referenceHeight?: number;
};
export type RegionSlots = {
    id: string;
    columns: number;
    rows: number;
    gapX: Range;
    gapY: Range;
    align: string;
    decorations: (EdgeDecoration & {
        ownerNodeId: string;
    })[];
    slots: SlotPlan[];
};
/** Slot shells work identically for library components, primitives and logo assets.
 * A component is measured AFTER these insets are subtracted, not in the raw cell.
 * Track sizes are derived by the adapter's flex layout, not chosen by Qwen. */
export function compileRegionSlots(plan: RenderPlan): RegionSlots[] {
    return plan.regions.map(r => {
        const l = r.layout, n = r.blocks.length, c = Math.min(l.columns, n), rows = Math.ceil(n / c);
        const slots = r.blocks.map((block, i): SlotPlan => {
            const row = Math.floor(i / c), column = i % c, id = `${r.regionId}/slot/${block.blockId}`;
            const padding = { ...ZERO, ...(l.itemPadding ? (column === 0 ? l.itemPadding.first : column === c - 1 ? l.itemPadding.last : l.itemPadding.middle) : {}) };
            const decorations: SlotPlan['decorations'] = [];
            if (l.betweenItemsRole && (c === 1 ? row > 0 : column > 0)) {
                const edge = c === 1 ? 'top' : 'left';
                const d: EdgeDecoration & {
                    ownerNodeId: string;
                } = { id: `${id}/separator`, ownerNodeId: id, edge, placement: 'inside-edge', preferredThicknessPx: 1, clearancePx: 0, role: l.betweenItemsRole };
                decorations.push(d);
                padding[edge] = Math.max(padding[edge], d.preferredThicknessPx);
            }
            return { id, block, row, column, padding, decorations, trackWeight: l.preferredWeights?.length === c ? l.preferredWeights[column] : 1, height: l.cellHeight?.mode ?? 'hug', referenceHeight: l.cellHeight?.preferred };
        });
        return { id: r.regionId, columns: c, rows, gapX: l.gapX, gapY: l.gapY, align: l.align, slots, decorations: (l.borderEdges ?? []).map(edge => ({ id: `${r.regionId}/${edge}-border`, ownerNodeId: r.regionId, edge, placement: 'inside-edge' as const, role: 'editorial-divider', preferredThicknessPx: 2, clearancePx: 0 })) };
    });
}
export type TypographyProfile = {
    role: string;
    fontFamily: string;
    fontWeight: string | number;
    preferredPx: number;
    minPx: number;
    maxPx: number;
    lineHeightRatio: number;
    letterSpacingEm: number;
    colorToken: string;
};
export function typographyCandidates(p: TypographyProfile): number[] {
    if (!p.role || !p.fontFamily || !p.colorToken || ![p.minPx, p.preferredPx, p.maxPx, p.lineHeightRatio, p.letterSpacingEm].every(Number.isFinite) || p.minPx <= 0 || p.minPx > p.preferredPx || p.preferredPx > p.maxPx || p.lineHeightRatio <= 0)
        throw new RecipeError(['invalid-active-ds-typography-profile']);
    const values = [p.preferredPx];
    for (let n = Math.floor(p.preferredPx / 4) * 4; n >= p.minPx; n -= 4)
        if (n !== p.preferredPx)
            values.push(n);
    return values;
}
export function resolveTypography(p: TypographyProfile, size: number) {
    typographyCandidates(p);
    if (size < p.minPx || size > p.maxPx || (size !== p.preferredPx && size % 4 !== 0))
        throw new RecipeError(['font-outside-role-limits']);
    return { fontFamily: p.fontFamily, fontWeight: p.fontWeight, fontSize: size, lineHeight: size * p.lineHeightRatio, letterSpacing: size * p.letterSpacingEm, colorToken: p.colorToken };
}
/** Geometry report supplied by the real layout adapter. Parent/child containment
 * is intentional; collision is tested between siblings, not whole ancestor trees. */
export type GeometryBox = {
    id: string;
    parentId: string | null;
    rect: Rect;
    kind: 'region' | 'group' | 'field' | 'asset' | 'decoration';
    overflow: boolean;
    allowedSize?: {
        width: Range;
        height: Range;
    };
    authoredSize?: {
        w: number;
        h: number;
    };
};
export function validateGeometryReport(boxes: readonly GeometryBox[], canvas = { width: 1920, height: 1080 }): string[] {
    const issues: string[] = [], map = new Map(boxes.map(b => [b.id, b]));
    if (map.size !== boxes.length)
        issues.push('duplicate-rendered-node-id');
    const epsilon = .05;
    for (const b of boxes) {
        const r = b.rect;
        if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) {
            issues.push(`${b.id}:invalid-bounds`);
            continue;
        }
        if (b.overflow)
            issues.push(`${b.id}:overflow`);
        if (r.x < -epsilon || r.y < -epsilon || r.x + r.w > canvas.width + epsilon || r.y + r.h > canvas.height + epsilon)
            issues.push(`${b.id}:out-of-canvas`);
        if (b.parentId) {
            const p = map.get(b.parentId)?.rect;
            if (!p)
                issues.push(`${b.id}:unknown-parent`);
            else if (r.x < p.x - epsilon || r.y < p.y - epsilon || r.x + r.w > p.x + p.w + epsilon || r.y + r.h > p.y + p.h + epsilon)
                issues.push(`${b.id}:outside-parent`);
        }
        if (b.allowedSize)
            for (const [k, key] of [['w', 'width'], ['h', 'height']] as const) {
                const lim = b.allowedSize[key];
                if (r[k] < lim.min - epsilon || r[k] > lim.max + epsilon)
                    issues.push(`${b.id}:${key}:outside-adaptation-range`);
                if (!(b.authoredSize && Math.abs(r[k] - b.authoredSize[k]) <= epsilon) && Math.abs(r[k] / 4 - Math.round(r[k] / 4)) > epsilon / 4)
                    issues.push(`${b.id}:${key}:not-4px`);
            }
    }
    for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (a.parentId !== b.parentId)
                continue;
            if (Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x) > epsilon && Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y) > epsilon)
                issues.push(`collision:${a.id}:${b.id}`);
        }
    return issues;
}
export const runtimePolicy = {
    dimensionSearch: 'every-feasible-4px-value-inside-bounds', initialSamplesAreExhaustive: false,
    unchangedAuthoredDimensionsMayBeOffGrid: true, geometrySource: 'hierarchical-flex-flow',
    typographySource: 'active-design-system-role-profile', colorsAndSurfaces: 'active-design-system',
    fontReduction: 'last-resort-after-native-type-and-geometry-search', contentCoverage: 'every-supplied-block-and-field-exactly-once',
    componentMeasurement: 'exact-inner-slot-and-current-snapshots', nativeArtwork: 'never-stretch-or-recolor-without-component-contract',
    decorations: 'attached-owner-with-measured-thickness-and-reserved-inset',
    requiredFinalChecks: ['loaded-ds-fonts', 'internal-text-overflow', 'node-bounds', 'sibling-collisions', 'field-bindings', 'source-coverage', 'asset-cropping', 'active-role-size-limits'],
} as const;
// ===== zod-adapter.ts =====
/** Optional adapter for the host's Zod. No package download or second Zod copy.
 * The constrained-decoding grammar is schema.jsonSchema, not z.custom() output.
 * Call validateQwenAssignment/createStateRenderPlan after parsing: a shape parser
 * does not certify component measurements or the rendered geometry. */
export type ZodParser<T> = {
    parse(value: unknown): T;
    safeParse(value: unknown): {
        success: true;
        data: T;
    } | {
        success: false;
        error: unknown;
    };
};
export type HostZod = {
    custom<T>(check: (value: unknown) => boolean, params?: {
        message: string;
    }): ZodParser<T>;
};
export function createZodAssignmentSchema(z: HostZod, bundle: Bundle, ctx: QwenContext) {
    const parser = createQwenAssignmentSchema(bundle, ctx);
    const schema = z.custom<Assignment>(value => parser.safeParse(value).success, { message: 'Invalid MSP recipe assignment; inspect strict parser issues for details.' });
    return { schema, jsonSchema: parser.jsonSchema, parse: parser.parse, safeParse: parser.safeParse };
}
// ===== index.ts =====
export const states = [...editorialStates, ...coverStates, ...metricStates, ...listStates];
const groups = [
    { id: 'editorial-explanations', name: 'Редакционные объяснения и выводы', states: editorialStates },
    { id: 'covers-passports', name: 'Обложки, авторы и паспорта', states: coverStates },
    { id: 'key-metrics', name: 'Ключевые метрики', states: metricStates },
    { id: 'lists-scenarios', name: 'Тезисы, списки и сценарии', states: listStates },
];
export const bundle: Bundle = {
    id: 'section-39-514', revision: '6.0.0', sourceSection: '39:514',
    sourceFrames: ['8:1082', '8:1110', '8:1463', '8:1300', '41:391', '41:482', '39:515', '39:527', '39:539', '39:551', '39:572', '39:593', '39:605', '41:493', '39:650', '39:677', '39:722', '8:1210', '39:767'],
    contracts, states,
    families: groups.map(f => ({ id: f.id, name: f.name, modes: [...new Set(f.states.map(s => s.modeId))].map(id => ({ id, stateIds: f.states.filter(s => s.modeId === id).map(s => s.id) })) })),
};
export const RECIPE_DEFINITION_ISSUES = validateRecipeDefinition(bundle);
if (RECIPE_DEFINITION_ISSUES.length)
    throw Error(RECIPE_DEFINITION_ISSUES.join('\n'));
/** Source aliases remain auditable but never give a layout an extra ranking vote. */
export const canonicalStates = states.filter(s => !s.aliasOf);
export const recipes = bundle.families.map(f => ({ id: f.id, sourceSection: bundle.sourceSection, revision: bundle.revision, modes: f.modes, states: states.filter(s => s.familyId === f.id) }));
/** Convenience entry point; family-specific subsets are exported as recipes. */
export const recipe = bundle;
export default bundle;
