import type {PatternIR} from "./pattern";
export const PAGE_IR_SCHEMA_VERSION = 1 as const;

export type ImportFormat = "pdf" | "pptx" | "docx";

export interface BoundsIR {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseElementIR {
  sourceRef?: { part: string; shapeId: string };
  id: string;
  name: string;
  bounds: BoundsIR;
  rotation: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  /** PPTX transforms rotate/reflect around the untransformed box center. */
  blur?: number;
  effects?: { type: "DROP_SHADOW" | "INNER_SHADOW"; color: ColorIR; offset: { x: number; y: number }; radius: number }[];
  centeredTransform?: { flipH: boolean; flipV: boolean };
}

export interface TextStyleRunIR {
  /** Raise/lower the run's alphabetic baseline, as a fraction of its font size. */
  baselineShift?: number;
  decoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  letterSpacing?: number;
  start: number; end: number; fontFamily: string;
  fontStyle: "Regular" | "Bold" | "Italic" | "Bold Italic";
  fontSize: number;
}

export interface ParagraphIR {
  tabs?:{position:number;align:"LEFT"|"CENTER"|"RIGHT"}[];
  defaultTab?:number;
  markerLength?:number;
  start:number; end:number; align:"LEFT"|"CENTER"|"RIGHT"|"JUSTIFIED";
  left:number; right:number; indent:number; before:number; after:number; fontSize:number;
  lineHeight?: {unit:"PIXELS"|"PERCENT";value:number};
}
export interface TextElementIR extends BaseElementIR {
  flow?: {columns:number;gap:number;autoFit:"NONE"|"SHRINK"|"GROW"};
  paragraphs?: ParagraphIR[];
  linkRuns?: { start: number; end: number; url: string }[];
  styleRuns?: TextStyleRunIR[];
  textBox?: { align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"; vertical: "TOP" | "CENTER" | "BOTTOM"; wrap: boolean };
  colorRuns?: { start: number; end: number; fill: SolidPaintIR }[];
  kind: "text";
  text: string;
  fontFamily: string;
  fontStyle?: "Regular" | "Bold" | "Italic" | "Bold Italic";
  fontSize: number;
}

export interface ColorIR {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SolidPaintIR {
  type: "solid";
  color: ColorIR;
}

export interface LinearGradientIR {
  type: "linear" | "radial";
  start: { x: number; y: number }; end: { x: number; y: number };
  stops: { position: number; color: ColorIR }[];
}

export interface ShapeElementIR extends BaseElementIR {
  clipBounds?: BoundsIR;
  pattern?:PatternIR;
  gradient?: LinearGradientIR;
  pathData?: string;
  windingRule?: "NONZERO" | "EVENODD";
  stroke?: { paint: SolidPaintIR; width: number; dash?: number[]; cap?: "NONE" | "ROUND" | "SQUARE"; join?: "MITER" | "BEVEL" | "ROUND" };
  kind: "rectangle" | "ellipse" | "line" | "path";
  fill?: SolidPaintIR;
}

export interface RasterElementIR extends BaseElementIR {
  clipBounds?: BoundsIR;
  stretch?: boolean;
  kind: "raster";
  assetId: string;
  reason: string;
}

export interface GroupElementIR extends BaseElementIR {
  /** Minimum row sizes plus local node references for text-driven table layout. */
  tableGrid?: TableGridIR;
  layout?: "HORIZONTAL" | "VERTICAL";
  clipsContent?: boolean;
  /** Local editable contour for authored web-recipe resource masks. */
  clipPathData?: string;
  kind: "group" | "table" | "chart";
  children: ElementIR[];
}

export interface TableGridIR {
  rowHeights: number[];
  containers: string[];
  rows: string[];
  cells: { id: string; row: number; rowSpan: number; borderId?: string }[];
}

export type ElementIR = TextElementIR | ShapeElementIR | RasterElementIR | GroupElementIR;

export interface DegradationIR {
  code: string;
  message: string;
  elementId?: string;
}

export interface ServiceNoteIR { title: string; text: string; url?: string }

export interface PageIR {
  serviceNotes?: ServiceNoteIR[];
  assets?: { id: string; bytes: Uint8Array }[];
  schemaVersion: typeof PAGE_IR_SCHEMA_VERSION;
  id: string;
  sourceIndex: number;
  width: number;
  height: number;
  elements: ElementIR[];
  degradations: DegradationIR[];
}
