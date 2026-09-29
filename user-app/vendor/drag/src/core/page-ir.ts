import {PATTERNS} from "./pattern";
import { isSafeLink } from "./safe-link";
import { imageDimensions } from "./image-budget";
import { SECURITY_LIMITS } from "./limits";
import { PAGE_IR_SCHEMA_VERSION, type ElementIR, type PageIR, type TableGridIR } from "./model";

export class PageIRValidationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "PageIRValidationError";
  }
}

export function parsePageIR(value: unknown): PageIR {
  const page = record(value, "$page");
  if (page.schemaVersion !== PAGE_IR_SCHEMA_VERSION) fail("$page.schemaVersion", "unsupported schema");
  const elements = array(page.elements, "$page.elements");
  const rawNotes = page.serviceNotes === undefined ? undefined : array(page.serviceNotes, "$page.serviceNotes");
  if (rawNotes && rawNotes.length > 128) fail("$page.serviceNotes", "service note limit exceeded");
  const notes = rawNotes?.map((value) => {
    const note = record(value, "$page.serviceNotes");
    if (note.url !== undefined && !isSafeLink(note.url)) fail("$page.serviceNotes", "unsafe link");
    return { title: boundedString(note.title, "$page.serviceNotes.title", 512), text: boundedString(note.text, "$page.serviceNotes.text", 100000), ...(note.url === undefined ? {} : { url: note.url as string }) };
  });
  if (notes && (notes.length > 128 || notes.reduce((n, v) => n + v.title.length + v.text.length, 0) > 100000)) fail("$page.serviceNotes", "service note limit exceeded");
  if (countElements(elements) + (notes?.length ? 1 + notes.length * 2 : 0) > SECURITY_LIMITS.maxNodesPerPage) {
    fail("$page.elements", "node limit exceeded");
  }
  const parsedElements = elements.map((element, index) => parseElement(element, `$page.elements[${index}]`));
  assertUniqueElementIds(parsedElements);
  let assetBytes = 0;
  const ids = new Set<string>();
  const assets = array(page.assets ?? [], "$page.assets").map((entry, index) => {
    const asset = record(entry, `$page.assets[${index}]`);
    const id = boundedString(asset.id, "$page.assets.id", 128);
    if (ids.has(id)) fail("$page.assets", "duplicate asset id");
    ids.add(id);
    if (!(asset.bytes instanceof Uint8Array) || asset.bytes.length === 0) fail("$page.assets", "expected image bytes");
    assetBytes += asset.bytes.length;
    if (assetBytes > SECURITY_LIMITS.maxPageAssetBytes) fail("$page.assets", "asset byte limit exceeded");
    try { imageDimensions(asset.bytes); } catch (error) { fail("$page.assets", error instanceof Error && error.message === "image-pixel-limit" ? "image pixel limit exceeded" : "invalid PNG/JPEG asset"); }
    return { id, bytes: asset.bytes };
  });

  const referenced = [...parsedElements];
  while (referenced.length) {
    const element = referenced.pop()!;
    if (element.kind === "raster" && !ids.has(element.assetId)) fail("$page.assets", "missing raster asset");
    if (element.kind === "group" || element.kind === "table" || element.kind === "chart") referenced.push(...element.children);
  }

  return {
    schemaVersion: PAGE_IR_SCHEMA_VERSION,
    ...(assets.length ? { assets } : {}),
    id: boundedString(page.id, "$page.id", 128),
    sourceIndex: integer(page.sourceIndex, "$page.sourceIndex", 0),
    width: positiveFinite(page.width, "$page.width"),
    height: positiveFinite(page.height, "$page.height"),
    elements: parsedElements,
    ...(notes?.length ? { serviceNotes: notes } : {}),
    degradations: array(page.degradations, "$page.degradations").map((entry, index) => {
      const degradation = record(entry, `$page.degradations[${index}]`);
      const parsed = {
        code: boundedString(degradation.code, `$page.degradations[${index}].code`, 128),
        message: boundedString(degradation.message, `$page.degradations[${index}].message`, 2_000),
      };
      return degradation.elementId === undefined
        ? parsed
        : { ...parsed, elementId: boundedString(degradation.elementId, `$page.degradations[${index}].elementId`, 128) };
    }),
  };
}

function assertUniqueElementIds(elements: ElementIR[]): void {
  const seen = new Set<string>();
  const stack = [...elements];
  while (stack.length > 0) {
    const element = stack.pop();
    if (!element) continue;
    if (seen.has(element.id)) fail("$page.elements", `duplicate element id: ${element.id}`);
    seen.add(element.id);
    if (element.kind === "group" || element.kind === "table" || element.kind === "chart") {
      stack.push(...element.children);
    }
  }
}

/** Validate a stored scene separately from the resource bytes, which are loaded on execution. */
export function parseSceneElements(value: unknown): ElementIR[] {
  const values = array(value, "$scene");
  if (countElements(values) > SECURITY_LIMITS.maxNodesPerPage) fail("$scene", "node limit exceeded");
  const elements = values.map((entry, index) => parseElement(entry, `$scene[${index}]`));
  assertUniqueElementIds(elements);
  return elements;
}

function parseElement(value: unknown, path: string): ElementIR {
  const element = record(value, path);
  const kind = boundedString(element.kind, `${path}.kind`, 32);
  const base = {
    id: boundedString(element.id, `${path}.id`, 128),
    name: boundedString(element.name, `${path}.name`, 512),
    bounds: parseBounds(element.bounds, `${path}.bounds`),
    rotation: finite(element.rotation, `${path}.rotation`),
    opacity: rangedFinite(element.opacity, `${path}.opacity`, 0, 1),
    visible: boolean(element.visible, `${path}.visible`),
    zIndex: integer(element.zIndex, `${path}.zIndex`, 0),
  };

  if(element.blur!==undefined)Object.assign(base,{blur:rangedFinite(element.blur,path,0,1000)});
  if(element.sourceRef!==undefined){const ref=record(element.sourceRef,path);Object.assign(base,{sourceRef:{part:boundedString(ref.part,path,400),shapeId:boundedString(ref.shapeId,path,128)}});}
  const centered = element.centeredTransform === undefined ? undefined : record(element.centeredTransform, `${path}.centeredTransform`);
  const transform = centered ? { centeredTransform: { flipH: boolean(centered.flipH, path), flipV: boolean(centered.flipV, path) } } : {};
  Object.assign(base, transform);
  if (element.effects !== undefined) {
    const values = array(element.effects, `${path}.effects`);
    if (values.length > 4) fail(path, "effect limit exceeded");
    Object.assign(base, { effects: values.map(value => {
      const effect = record(value, path), offset = record(effect.offset, path);
      if (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW") fail(path, "unsupported effect");
      return { type: effect.type, color: parseSolidPaint({ type: "solid", color: effect.color }, path).color,
        offset: { x: rangedFinite(offset.x, path, -10000, 10000), y: rangedFinite(offset.y, path, -10000, 10000) }, radius: rangedFinite(effect.radius, path, 0, 1000) };
    }) });
  }

  if (kind === "text") {
    if (element.fontStyle !== undefined && !["Regular", "Bold", "Italic", "Bold Italic"].includes(String(element.fontStyle))) fail(`${path}.fontStyle`, "unsupported font style");
    const text = boundedString(element.text, `${path}.text`, 1_000_000);
    if (Array.isArray(element.styleRuns) && element.styleRuns.length > 20000 || Array.isArray(element.colorRuns) && element.colorRuns.length > 20000) fail(path, "text range limit exceeded");
    if (Array.isArray(element.linkRuns) && element.linkRuns.length > 20000) fail(path, "text range limit exceeded");
    const flowRaw=element.flow===undefined?undefined:record(element.flow,path);
    const flow=flowRaw?{columns:integer(flowRaw.columns,path,1),gap:rangedFinite(flowRaw.gap,path,0,10000),autoFit:flowRaw.autoFit as "NONE"|"SHRINK"|"GROW"}:undefined;
    if(flow&&(flow.columns>16||!["NONE","SHRINK","GROW"].includes(flow.autoFit)||base.bounds.width-flow.gap*(flow.columns-1)<=0||element.paragraphs===undefined))fail(path,"invalid text flow");
    let paragraphEnd=-1;
    const paragraphs=element.paragraphs===undefined?undefined:array(element.paragraphs,path).map(value=>{
      const p=record(value,path),start=integer(p.start,path,0),end=integer(p.end,path,0);
      if(start!==paragraphEnd+1||end<start||end>text.length||start>0&&text[start-1]!=="\n")fail(path,"invalid paragraph range");paragraphEnd=end;
      if(!["LEFT","CENTER","RIGHT","JUSTIFIED"].includes(String(p.align)))fail(path,"invalid paragraph alignment");
      const left=rangedFinite(p.left,path,0,10000),right=rangedFinite(p.right,path,0,10000);
      if(left+right>=base.bounds.width)fail(path,"invalid paragraph margins");
      const lh=p.lineHeight===undefined?undefined:record(p.lineHeight,path);
      if(lh&&lh.unit!=="PIXELS"&&lh.unit!=="PERCENT")fail(path,"invalid line height");
      const tabs=p.tabs===undefined?undefined:array(p.tabs,path).map(value=>{const t=record(value,path);if(!["LEFT","CENTER","RIGHT"].includes(String(t.align)))fail(path,"invalid tab alignment");return {position:rangedFinite(t.position,path,0,10000),align:t.align as "LEFT"|"CENTER"|"RIGHT"};});
      if(tabs&&(tabs.length>64||tabs.some((t,i)=>i>0&&t.position<=tabs[i-1]!.position)))fail(path,"invalid tab stops");
      const defaultTab=p.defaultTab===undefined?undefined:rangedFinite(p.defaultTab,path,.01,10000);
      const markerLength=p.markerLength===undefined?undefined:integer(p.markerLength,path,1);
      if(markerLength!==undefined&&markerLength>end-start)fail(path,"invalid paragraph marker");
      return {...(tabs?{tabs}:{}),...(defaultTab===undefined?{}:{defaultTab}),...(markerLength===undefined?{}:{markerLength}),start,end,align:p.align as "LEFT"|"CENTER"|"RIGHT"|"JUSTIFIED",left,right,indent:rangedFinite(p.indent,path,-10000,10000),before:rangedFinite(p.before,path,0,10000),after:rangedFinite(p.after,path,0,10000),fontSize:rangedFinite(p.fontSize,path,.01,10000),...(lh?{lineHeight:{unit:lh.unit as "PIXELS"|"PERCENT",value:rangedFinite(lh.value,path,.01,10000)}}:{})};
    });
    if(paragraphs&&(!paragraphs.length||paragraphs.length>2048||paragraphEnd!==text.length))fail(path,"invalid paragraph coverage");
    let linkEnd = 0;
    const linkRuns = element.linkRuns === undefined ? undefined : array(element.linkRuns, path).map(value => {
      const run = record(value, path), start = integer(run.start, path, 0), end = integer(run.end, path, 1);
      if (start < linkEnd || end <= start || end > text.length || !isSafeLink(run.url)) fail(path, "invalid text link");
      linkEnd = end; return { start, end, url: run.url };
    });
    if (linkRuns && linkRuns.length > 20000) fail(path, "text range limit exceeded");
    let previousEnd = 0;
    const runs = element.colorRuns === undefined ? undefined : array(element.colorRuns, `${path}.colorRuns`).map((value, index) => {
      const run = record(value, `${path}.colorRuns[${index}]`);
      const start = integer(run.start, `${path}.colorRuns.start`, 0);
      const end = integer(run.end, `${path}.colorRuns.end`, 1);
      if (start < previousEnd || end <= start || end > text.length) fail(`${path}.colorRuns`, "invalid or overlapping text range");
      previousEnd = end;
      return { start, end, fill: parseSolidPaint(run.fill, `${path}.colorRuns.fill`) };
    });
    let styleEnd = 0;
    const styleRuns = element.styleRuns === undefined ? undefined : array(element.styleRuns, `${path}.styleRuns`).map((value) => {
      const run = record(value, path);
      const start = integer(run.start, path, 0), end = integer(run.end, path, 1);
      if (start < styleEnd || end <= start || end > text.length) fail(path, "invalid text style range");
      styleEnd = end;
      if (!["Regular", "Bold", "Italic", "Bold Italic"].includes(String(run.fontStyle))) fail(path, "invalid font style");
      if (run.decoration !== undefined && !["NONE","UNDERLINE","STRIKETHROUGH"].includes(String(run.decoration))) fail(path,"invalid text decoration");
      return { ...(run.baselineShift===undefined?{}:{baselineShift:rangedFinite(run.baselineShift,path,-4,4)}), ...(run.decoration === undefined ? {} : {decoration: run.decoration as "NONE" | "UNDERLINE" | "STRIKETHROUGH"}), ...(run.letterSpacing === undefined ? {} : {letterSpacing: rangedFinite(run.letterSpacing,path,-1000,1000)}), start, end, fontFamily: boundedString(run.fontFamily, path, 256), fontStyle: run.fontStyle as "Regular" | "Bold" | "Italic" | "Bold Italic", fontSize: positiveFinite(run.fontSize, path) };
    });
    const box = element.textBox === undefined ? undefined : record(element.textBox, path);
    if (box && (!["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].includes(String(box.align)) || !["TOP", "CENTER", "BOTTOM"].includes(String(box.vertical)))) fail(path, "invalid text alignment");
    return {
      ...base,
      kind,
      text,
      ...(flow?{flow}:{}),
      ...(paragraphs?{paragraphs}:{}),
      ...(styleRuns ? { styleRuns } : {}),
      ...(linkRuns?.length ? { linkRuns } : {}),
      ...(box ? { textBox: { align: box.align as "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED", vertical: box.vertical as "TOP" | "CENTER" | "BOTTOM", wrap: boolean(box.wrap, path) } } : {}),
      ...(runs ? { colorRuns: runs } : {}),
      fontFamily: boundedString(element.fontFamily, `${path}.fontFamily`, 256),
      ...(element.fontStyle === undefined ? {} : { fontStyle: element.fontStyle as "Regular" | "Bold" | "Italic" | "Bold Italic" }),
      fontSize: positiveFinite(element.fontSize, `${path}.fontSize`),
    };
  }
  if (kind === "rectangle" || kind === "ellipse" || kind === "line" || kind === "path") {
    const shape = { ...base, kind, ...(element.clipBounds === undefined ? {} : {clipBounds: parseBounds(element.clipBounds, `${path}.clipBounds`)}), ...(element.fill === undefined ? {} : { fill: parseSolidPaint(element.fill, `${path}.fill`) }) };
    if (element.gradient !== undefined) {
      if(shape.bounds.width<=0||shape.bounds.height<=0)fail(path,"gradient requires positive area");
      const gradient = record(element.gradient, path), start = record(gradient.start,path), end = record(gradient.end,path);
      if (gradient.type !== "linear" && gradient.type !== "radial") fail(path,"invalid gradient type");
      const a={x:rangedFinite(start.x,path,-10000,10000),y:rangedFinite(start.y,path,-10000,10000)}, b={x:rangedFinite(end.x,path,-10000,10000),y:rangedFinite(end.y,path,-10000,10000)};
      if(Math.hypot(a.x-b.x,a.y-b.y)<1e-8)fail(path,"degenerate gradient");
      const raw=array(gradient.stops,path);if(raw.length<2||raw.length>64)fail(path,"gradient stop limit exceeded");
      let prev=-1;
      const stops=raw.map(value=>{const stop=record(value,path),position=rangedFinite(stop.position,path,0,1);if(position<prev)fail(path,"unordered gradient stops");prev=position;return {position,color:parseSolidPaint({type:"solid",color:stop.color},path).color};});
      if(element.fill!==undefined)fail(path,"ambiguous shape fill");
      if(gradient.type==="radial"&&(b.x<=a.x||b.y<=a.y))fail(path,"invalid radial bounds");
      Object.assign(shape,{gradient:{type:gradient.type,start:a,end:b,stops}});
    }
    if(element.pattern!==undefined){const p=record(element.pattern,path);if(!PATTERNS.includes(p.preset as typeof PATTERNS[number]))fail(path,"invalid pattern");if(element.fill!==undefined||element.gradient!==undefined)fail(path,"ambiguous pattern fill");Object.assign(shape,{pattern:{preset:p.preset,foreground:parseSolidPaint({type:"solid",color:p.foreground},path).color,background:parseSolidPaint({type:"solid",color:p.background},path).color}});}
    const stroke = element.stroke === undefined ? undefined : record(element.stroke, `${path}.stroke`);
    if (stroke?.cap !== undefined && !["NONE","ROUND","SQUARE"].includes(String(stroke.cap))) fail(path,"invalid stroke cap");
    if (stroke?.join !== undefined && !["MITER","BEVEL","ROUND"].includes(String(stroke.join))) fail(path,"invalid stroke join");
    const dash = stroke?.dash === undefined ? undefined : array(stroke.dash,path).map(n=>rangedFinite(n,path,0.000001,10000));
    if (dash && (!dash.length || dash.length > 64 || dash.length % 2)) fail(path,"invalid dash pattern");
    const paint = stroke ? { stroke: { ...(dash ? {dash}:{}), ...(stroke.cap === undefined ? {} : {cap:stroke.cap as "NONE" | "ROUND" | "SQUARE"}), ...(stroke.join === undefined ? {} : {join:stroke.join as "MITER" | "BEVEL" | "ROUND"}), paint: parseSolidPaint(stroke.paint, `${path}.stroke.paint`), width: positiveFinite(stroke.width, `${path}.stroke.width`) } } : {};
    if (kind !== "path") return { ...shape, ...paint, kind };
    const data = boundedString(element.pathData, `${path}.pathData`, 500_000);
    if (!/^[MLCQZ0-9eE+.,\s-]+$/.test(data)) fail(`${path}.pathData`, "unsupported path syntax");
    if (element.windingRule !== "NONZERO" && element.windingRule !== "EVENODD") fail(`${path}.windingRule`, "invalid winding rule");
    return { ...shape, ...paint, kind, pathData: data, windingRule: element.windingRule };
  }
  if (kind === "raster") {
    return {
      ...base,
      ...(element.clipBounds === undefined ? {} : { clipBounds: parseBounds(element.clipBounds, `${path}.clipBounds`) }),
      kind,
      ...(element.stretch === undefined ? {} : { stretch: boolean(element.stretch, path) }),
      assetId: boundedString(element.assetId, `${path}.assetId`, 128),
      reason: boundedString(element.reason, `${path}.reason`, 1_000),
    };
  }
  if (kind === "group" || kind === "table" || kind === "chart") {
    const children = array(element.children, `${path}.children`);
    if (element.layout !== undefined && element.layout !== "HORIZONTAL" && element.layout !== "VERTICAL") fail(path, "invalid group layout");
    const parsedChildren = children.map((child, index) => parseElement(child, `${path}.children[${index}]`));
    const clipPathData = element.clipPathData === undefined ? undefined : boundedString(element.clipPathData, `${path}.clipPathData`, 500_000);
    if (clipPathData !== undefined && !/^[MLCQZ0-9eE+.,\s-]+$/.test(clipPathData)) fail(path, "unsupported clip path syntax");
    return {
      ...base,
      kind,
      ...(element.layout === undefined ? {} : { layout: element.layout as "HORIZONTAL" | "VERTICAL" }),
      ...(element.clipsContent === undefined ? {} : { clipsContent: boolean(element.clipsContent, path) }),
      ...(clipPathData === undefined ? {} : { clipPathData }),
      children: parsedChildren,
      ...(element.tableGrid === undefined ? {} : { tableGrid: parseTableGrid(element.tableGrid, parsedChildren, path) }),
    };
  }
  fail(`${path}.kind`, "unsupported element kind");
}

function parseTableGrid(value: unknown, children: ElementIR[], path: string): TableGridIR {
  const grid = record(value, `${path}.tableGrid`), rawHeights = array(grid.rowHeights, path), rawCells = array(grid.cells, path);
  if (!rawHeights.length || rawHeights.length > 2000 || !rawCells.length || rawCells.length > 2000) fail(path, 'table grid limit exceeded');
  const rowHeights = rawHeights.map(h => rangedFinite(h, path, .001, 1000000));
  if (rowHeights.reduce((a, b) => a + b, 0) > 1000000) fail(path, 'table height limit exceeded');
  const nodes = new Map<string, ElementIR>(), stack = [...children];
  while (stack.length) { const node = stack.pop()!; nodes.set(node.id, node); if ('children' in node) stack.push(...node.children); }
  const seen = new Set<string>();
  const reference = (value: unknown) => {
    const id = boundedString(value, path, 128), node = nodes.get(id);
    if (!node || !('children' in node) || seen.has(id)) fail(path, 'invalid table node reference');
    seen.add(id); return id;
  };
  const rawContainers = array(grid.containers, path), rawRows = array(grid.rows, path);
  if (rawContainers.length < 1 || rawContainers.length > 3 || rawRows.length && rawRows.length !== rowHeights.length) fail(path, 'invalid table containers');
  const containers = rawContainers.map(reference), rows = rawRows.map(reference);
  const cells = rawCells.map(value => {
    const cell = record(value, path), row = integer(cell.row, path, 0), rowSpan = integer(cell.rowSpan, path, 1);
    if (row + rowSpan > rowHeights.length) fail(path, 'invalid table row span');
    const id = reference(cell.id), node = nodes.get(id)!;
    if (node.bounds.height <= 0) fail(path, 'invalid table cell height');
    return { id, row, rowSpan, ...(cell.borderId === undefined ? {} : { borderId: reference(cell.borderId) }) };
  });
  return { rowHeights, containers, rows, cells };
}

function parseSolidPaint(value: unknown, path: string) {
  const paint = record(value, path);
  if (paint.type !== "solid") fail(`${path}.type`, "expected solid paint");
  const color = record(paint.color, `${path}.color`);
  return {
    type: "solid" as const,
    color: {
      r: rangedFinite(color.r, `${path}.color.r`, 0, 1),
      g: rangedFinite(color.g, `${path}.color.g`, 0, 1),
      b: rangedFinite(color.b, `${path}.color.b`, 0, 1),
      a: rangedFinite(color.a, `${path}.color.a`, 0, 1),
    },
  };
}

function parseBounds(value: unknown, path: string) {
  const bounds = record(value, path);
  return {
    x: finite(bounds.x, `${path}.x`),
    y: finite(bounds.y, `${path}.y`),
    width: nonNegativeFinite(bounds.width, `${path}.width`),
    height: nonNegativeFinite(bounds.height, `${path}.height`),
  };
}

function countElements(values: unknown[]): number {
  if (values.length > SECURITY_LIMITS.maxNodesPerPage) return values.length;
  let total = 0;
  const stack = values.map((value) => ({ value, depth: 1 }));
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (depth > SECURITY_LIMITS.maxElementDepth) fail("$page.elements", "group depth limit exceeded");
    total += 1;
    if (total > SECURITY_LIMITS.maxNodesPerPage) return total;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (["raster", "rectangle", "ellipse", "line", "path"].includes(String((value as Record<string, unknown>).kind)) && (value as Record<string, unknown>).clipBounds !== undefined) total += 1;
      const paragraphs=(value as Record<string,unknown>).paragraphs;
      if(Array.isArray(paragraphs)){
        const object=value as Record<string,unknown>,flow=object.flow as {columns?:number}|undefined,columns=typeof flow?.columns==="number"&&Number.isInteger(flow.columns)&&flow.columns>0&&flow.columns<=16?flow.columns:1;
        total+=paragraphs.length*2*columns;
        if(typeof object.text==="string"&&object.text.includes("\t"))total+=(object.text.match(/[\t\n]/g)?.length??0)+1;
      }
      const children = (value as Record<string, unknown>).children;
      if (Array.isArray(children)) {
        if (children.length > SECURITY_LIMITS.maxNodesPerPage) return SECURITY_LIMITS.maxNodesPerPage + 1;
        stack.push(...children.map((value) => ({ value, depth: depth + 1 })));
      }
    }
  }
  return total;
}


function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected array");
  return value;
}

function boundedString(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(path, `expected 1-${max} characters`);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected finite number");
  return value;
}

function positiveFinite(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (parsed <= 0) fail(path, "expected positive number");
  return parsed;
}

function nonNegativeFinite(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (parsed < 0) fail(path, "expected non-negative number");
  return parsed;
}

function rangedFinite(value: unknown, path: string, min: number, max: number): number {
  const parsed = finite(value, path);
  if (parsed < min || parsed > max) fail(path, `expected number from ${min} to ${max}`);
  return parsed;
}

function integer(value: unknown, path: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) fail(path, `expected integer >= ${min}`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected boolean");
  return value;
}

function fail(path: string, reason: string): never {
  throw new PageIRValidationError(path, reason);
}
