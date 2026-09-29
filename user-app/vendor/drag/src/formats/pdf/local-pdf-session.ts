import { getDocument, OPS, Util, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SECURITY_LIMITS } from "../../core/limits";
import type { BoundsIR, ColorIR, ElementIR, PageIR, ShapeElementIR, TextElementIR } from "../../core/model";
import { configurePdfWorker } from "./probe";
import { encodeImagePng } from "./image-png";
import { textPaintMatcher } from "./text-paint";
import { planPathFallbacks, renderPathFallback } from "./path-fallback";
import { comparisonSize, type PixelBuffer } from "../../core/visual-comparison";
import { renderPreviewPng } from "./bounded-render";
import { validateLocalPdf } from "./file-validation";
interface LocalFont { family: string; style: string }
import { needsComposite, compositePaints, measureCompositeRegions, compositeTiles, renderCompositeTile, hasAlignedRenderOperations } from "./composite-fallback";
import { separatePdfObjects } from "./object-separation";
import { renderSeparatedObjects } from "./separated-render";
import { LocalPdfResources } from "./local-resources";

const PDF_POINTS_TO_FIGMA_PX = 96 / 72;

export interface PdfCatalogPage {
  index: number;
  label: string;
  width: number;
  height: number;
}

export interface PdfCatalog {
  pageCount: number;
  pages: PdfCatalogPage[];
}

export class LocalPdfSession {
  private constructor(
    private readonly loadingTask: PDFDocumentLoadingTask,
    private readonly document: PDFDocumentProxy,
    readonly catalog: PdfCatalog,
  ) {}

  static async open(bytes: Uint8Array): Promise<LocalPdfSession> {
    if (bytes.byteLength > SECURITY_LIMITS.maxFileBytes) {
      throw new Error("file-too-large");
    }
    if (validateLocalPdf("document.pdf", bytes.byteLength, bytes.subarray(0, 1024))) throw new Error("invalid-file");

    configurePdfWorker();
    const task = getDocument({
      data: bytes.slice(),
      enableXfa: false,
      stopAtErrors: true,
      useSystemFonts: true,
      useWasm: false,
      useWorkerFetch: false,
      BinaryDataFactory: LocalPdfResources,
      cMapPacked: true,
      isOffscreenCanvasSupported: false,
    });
    try {
      const document = await task.promise;
      const { info } = await document.getMetadata();
      const metadata = info as Record<string, unknown>;
      if (metadata.EncryptFilter) throw new Error("protected-file");
      if (metadata.IsAcroFormPresent || metadata.IsXFAPresent) throw new Error("pdf-forms-unsupported");
      if (document.numPages > SECURITY_LIMITS.maxPages) {
        throw new Error("too-many-pages");
      }
      const pages: PdfCatalogPage[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: PDF_POINTS_TO_FIGMA_PX });
        if (![viewport.width, viewport.height].every((n) => Number.isFinite(n) && n >= 0.01 && n <= SECURITY_LIMITS.maxPageDimension)) {
          page.cleanup();
          throw new Error("page-dimension-limit");
        }
        pages.push({
          index: pageNumber - 1,
          label: `Page ${pageNumber}`,
          width: roundDimension(viewport.width),
          height: roundDimension(viewport.height),
        });
        page.cleanup();
      }
      return new LocalPdfSession(task, document, { pageCount: document.numPages, pages });
    } catch (error) {
      await task.destroy().catch(() => undefined);
      throw error;
    }
  }

  async renderPreview(pageIndex: number, maxWidth = 180, signal?: AbortSignal): Promise<string> {
    const descriptor = this.catalog.pages[pageIndex];
    if (!descriptor) throw new Error("page-out-of-range");
    const page = await this.document.getPage(pageIndex + 1);
    try {
      return await renderPreviewPng(page, maxWidth, signal);
    } finally {
      page.cleanup();
    }
  }

  async readFontUsage(pageIndexes: readonly number[], signal?: AbortSignal, onPageFailure?: (pageIndex: number) => void): Promise<LocalFont[]> {
    const fonts = new Map<string, LocalFont>();
    for (const index of pageIndexes) {
      throwIfAborted(signal);
      if (!Number.isInteger(index) || !this.catalog.pages[index]) throw new Error("page-out-of-range");
      let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | undefined;
      try {
        page = await this.document.getPage(index + 1);
        const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
        throwIfAborted(signal);
        if (operators.fnArray.length > SECURITY_LIMITS.maxPageOperators) throw new Error("page-operator-limit");
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const font = identifyFont(page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : undefined, content.styles[item.fontName]?.fontFamily);
          fonts.set(JSON.stringify([font.family, font.style]), font);
          if (fonts.size > 2048) throw new Error("font-count-limit");
        }
      } catch (error) {
        throwIfAborted(signal);
        if (!onPageFailure || (error instanceof Error && error.message === "font-count-limit")) throw error;
        onPageFailure(index);
      } finally { page?.cleanup(); }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return [...fonts.values()];
  }

  async readPage(pageIndex: number, signal?: AbortSignal): Promise<PageIR> {
    const descriptor = this.catalog.pages[pageIndex];
    if (!descriptor) throw new Error("page-out-of-range");
    throwIfAborted(signal);
    const page = await this.document.getPage(pageIndex + 1);
    try {
      const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      throwIfAborted(signal);
      if (operators.fnArray.length > SECURITY_LIMITS.maxPageOperators) throw new Error("page-operator-limit");
      const viewport = page.getViewport({ scale: PDF_POINTS_TO_FIGMA_PX });
      const complexPage = needsComposite(operators.fnArray, operators.argsArray);
      if (!await hasAlignedRenderOperations(page, operators.fnArray.length, signal)) {
        const assets: NonNullable<PageIR['assets']> = [], elements: ElementIR[] = [];
        for(const [index,bounds] of compositeTiles([{x:0,y:0,width:descriptor.width,height:descriptor.height}]).entries()) {
          const bytes=await renderCompositeTile(page,bounds,signal);
          if(assets.reduce((n,a)=>n+a.bytes.length,0)+bytes.length>SECURITY_LIMITS.maxPageAssetBytes)throw new Error('page-image-byte-limit');
          const id=`pdf-appearance-${index}`;assets.push({id,bytes});
          elements.push({id,name:'Preserved page appearance',kind:'raster',assetId:id,reason:'composite-effects',bounds,rotation:0,opacity:1,visible:true,zIndex:index});
        }
        return {schemaVersion:1,id:`pdf-page-${pageIndex+1}`,sourceIndex:pageIndex,width:descriptor.width,height:descriptor.height,assets,elements,degradations:[{code:'pdf-page-rasterized',message:'This page was preserved as an image because its optimized drawing operations could not be mapped safely. Text and graphics inside it are not separately editable.'}]};
      }
      let elements: ElementIR[] = reconstructRectangles(operators.fnArray, operators.argsArray, viewport);
      const assets: NonNullable<PageIR["assets"]> = [];
      let imageTransform = [1, 0, 0, 1, 0, 0];
      let imageClip: BoundsIR | undefined;
      let complexImageClip = false;
      let pendingClip = false;
      const imageStack: { transform: number[]; clip: BoundsIR | undefined; complex: boolean }[] = [];
      for (let index = 0; index < operators.fnArray.length; index++) {
        throwIfAborted(signal);
        const op = operators.fnArray[index];
        const args = operators.argsArray[index] ?? [];
        if (op === OPS.save || op === OPS.paintFormXObjectBegin) imageStack.push({ transform: [...imageTransform], clip: imageClip, complex: complexImageClip });
        if (op === OPS.paintFormXObjectBegin && args[0]) imageTransform = Util.transform(imageTransform, args[0]);
        if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
          const state = imageStack.pop();
          if (state) { imageTransform = state.transform; imageClip = state.clip; complexImageClip = state.complex; }
        }
        if (op === OPS.transform) imageTransform = Util.transform(imageTransform, args);
        if (op === OPS.clip || op === OPS.eoClip) pendingClip = true;
        if (op === OPS.constructPath && pendingClip) {
          const matrix = Util.transform(viewport.transform, imageTransform);
          if (isAxisAlignedRectanglePath(args[1]) && matrix[1] === 0 && matrix[2] === 0) {
            const box = transformBounds(asNumbers(args[2]), matrix);
            if (box) {
              const next = { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] };
              imageClip = imageClip ? intersectBounds(imageClip, next) : next;
            }
          } else complexImageClip = true;
          pendingClip = false;
        }
        if (op === OPS.paintImageMaskXObject) {
          const mask = args[0];
          if (!mask || !Number.isSafeInteger(mask.width) || !Number.isSafeInteger(mask.height) || mask.width < 1 || mask.height < 1 || mask.width > SECURITY_LIMITS.maxImageDimension || mask.height > SECURITY_LIMITS.maxImageDimension || mask.width * mask.height > SECURITY_LIMITS.maxImagePixels) throw new Error("image-pixel-limit");
        }
        if (op !== OPS.paintInlineImageXObject && op !== OPS.paintImageXObject) continue;
        const source = op === OPS.paintInlineImageXObject ? args[0] : page.objs.get(args[0]);
        // Check the source too: a small rendered region can contain a huge bitmap.
        if (source && (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1 || source.width > SECURITY_LIMITS.maxImageDimension || source.height > SECURITY_LIMITS.maxImageDimension || source.width * source.height > SECURITY_LIMITS.maxImagePixels)) throw new Error("image-pixel-limit");

        if (complexImageClip) continue;
        const matrix = Util.transform(viewport.transform, imageTransform);
        if (matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] <= 0 || matrix[3] >= 0) continue;
        if (!source?.data || (source.kind !== 2 && source.kind !== 3)) continue;
        const bytes = encodeImagePng(source.width, source.height, source.data, source.kind === 2 ? 3 : 4);
        if (assets.reduce((sum, asset) => sum + asset.bytes.length, 0) + bytes.length > SECURITY_LIMITS.maxPageAssetBytes) throw new Error("page-image-byte-limit");
        const id = `pdf-image-${index}`;
        assets.push({ id, bytes });
        elements.push({ id, name: "Image", kind: "raster", assetId: id, reason: "source-image", ...(imageClip ? { clipBounds: imageClip } : {}), bounds: { x: matrix[4], y: matrix[5] + matrix[3], width: matrix[0], height: -matrix[3] }, rotation: 0, opacity: 1, visible: true, zIndex: index });
      }
      const fallbackWarnings = [];
      const textZIndexes = operators.fnArray.flatMap((operator, index) => operator === OPS.showText ? [index] : []);
      const matchPaint = textPaintMatcher(operators.fnArray, operators.argsArray);
      let unmatchedText = false;
      let composed = false;
      const uncertainText = new Set<number>();
      let unsupportedTextMode = false;
      let textIndex = 0;
      const editableTextPaints=new Set<number>(),editableTextIds=new Set<string>();
      for (const item of content.items) {
        // PDF.js can synthesize standalone whitespace for gaps between independently
        // positioned fragments. Geometry already preserves those gaps; a Figma text
        // node adds no visible content and produces misleading font-width warnings.
        if (!("str" in item) || item.str.trim().length === 0) continue;
        const paint = matchPaint(item.str);
        if (paint?.unsupportedMode) unsupportedTextMode = true;
        if (paint?.invisible) continue;
        if (!paint && item.str.trim()) unmatchedText = true;
        const transform = Util.transform(viewport.transform, item.transform);
        const fontSize = Math.max(0.01, Math.hypot(transform[2], transform[3]));
        const style = content.styles[item.fontName];
        if (paint && (/[\u0000\uFFFD\uE000-\uF8FF]/u.test(item.str) || style?.vertical ||
          Math.abs(transform[0]! * transform[2]! + transform[1]! * transform[3]!) > 0.001 ||
          transform[0]! * transform[3]! - transform[1]! * transform[2]! > 0 ||
          Math.abs(Math.hypot(transform[0]!, transform[1]!) - Math.hypot(transform[2]!, transform[3]!)) > 0.01)) uncertainText.add(paint.zIndex);
        const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : undefined;
        const identity = identifyFont(font, style?.fontFamily);
        const ascent = Number.isFinite(style?.ascent) ? style!.ascent : Number.isFinite(style?.descent) ? 1 + style!.descent : 0.8;
        const angle = Math.atan2(transform[1], transform[0]);
        const width = Math.max(0.01, item.width * PDF_POINTS_TO_FIGMA_PX);
        const textElement: TextElementIR = {
          id: `pdf-${pageIndex + 1}-text-${textIndex + 1}`,
          name: `Text: ${truncateName(item.str)}`,
          kind: "text",
          text: item.str,
          ...(paint ? { colorRuns: paint.runs } : {}),
          fontFamily: identity.family,
          fontStyle: identity.style as NonNullable<TextElementIR["fontStyle"]>,
          fontSize: roundDimension(fontSize),
          bounds: {
            x: roundDimension(transform[4] + fontSize * ascent * Math.sin(angle)),
            y: roundDimension(transform[5] - fontSize * ascent * Math.cos(angle)),
            width: roundDimension(width),
            height: roundDimension(fontSize),
          },
          rotation: roundDimension((angle * 180) / Math.PI),
          opacity: 1,
          visible: true,
          zIndex: paint?.zIndex ?? textZIndexes[textIndex] ?? operators.fnArray.length + textIndex,
        };
        elements.push(textElement);
        if(paint&&!paint.unsupportedMode&&!/[\u0000\uFFFD\uE000-\uF8FF]/u.test(item.str)&&!style?.vertical&&transform[0]!*transform[3]!-transform[1]!*transform[2]!<0){
          if(uncertainText.has(paint.zIndex))fallbackWarnings.push({code:"pdf-text-transform-approximation",message:"Text remains editable, but its source stretch or skew is approximated by the text box.",elementId:textElement.id});
          uncertainText.delete(paint.zIndex);
          editableTextIds.add(textElement.id);for(const index of paint.operatorIndexes)editableTextPaints.add(index);
        }
        textIndex += 1;
      }
      const separation = !unmatchedText && uncertainText.size === 0 ? separatePdfObjects(operators.fnArray, operators.argsArray, elements, viewport) : undefined;
      const fallbackPlans = separation || complexPage ? [] : planPathFallbacks(operators.fnArray, operators.argsArray, new Set(elements.map((element) => element.zIndex)), viewport);
      const mappedPaths = new Set(elements.map((element) => element.zIndex));
      for (const plan of fallbackPlans) {
        mappedPaths.add(plan.operatorIndex);
        if (plan.operatorEnd !== undefined) for (let i = plan.operatorIndex; i <= plan.operatorEnd; i++) mappedPaths.add(i);
      }
      const unsupportedPaint = operators.fnArray.some((operator, index) =>
        ((operator === OPS.paintFormXObjectBegin || operator === OPS.beginGroup) && !mappedPaths.has(index)) ||
        (operator === OPS.constructPath && !mappedPaths.has(index)) ||
        ((operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject) && !mappedPaths.has(index)) ||
        ((operator === OPS.paintImageMaskXObject || operator === OPS.paintSolidColorImageMask) && !mappedPaths.has(index)) || operator === OPS.paintImageMaskXObjectRepeat || operator === OPS.paintImageMaskXObjectGroup || operator === OPS.shadingFill ||
        operator === OPS.clip || operator === OPS.eoClip || operator === OPS.setGState ||
        operator === OPS.setDash || operator === OPS.setLineCap || operator === OPS.setLineJoin || operator === OPS.setMiterLimit,
      );
      if (separation) {
        const result = await renderSeparatedObjects(page, operators, elements, assets, separation, editableTextPaints, editableTextIds, signal);
        elements = result.elements; fallbackWarnings.push(...result.warnings); composed = true;
      }
      for (const plan of separation ? [] : fallbackPlans) {
        for (const replaced of elements.filter((element) => element.zIndex >= plan.operatorIndex && element.zIndex <= (plan.operatorEnd ?? plan.operatorIndex))) {
          if (replaced.kind === "raster") {
            const assetIndex = assets.findIndex((asset) => asset.id === replaced.assetId);
            if (assetIndex >= 0) assets.splice(assetIndex, 1);
          }
        }
        const bytes = await renderPathFallback(page, operators.fnArray, plan, signal, editableTextPaints);
        if (assets.reduce((sum, asset) => sum + asset.bytes.length, 0) + bytes.length > SECURITY_LIMITS.maxPageAssetBytes) throw new Error("page-image-byte-limit");
        const id = `pdf-fallback-${plan.operatorIndex}`;
        assets.push({ id, bytes });
        elements = elements.filter((element) => editableTextIds.has(element.id)||element.zIndex < plan.operatorIndex || element.zIndex > (plan.operatorEnd ?? plan.operatorIndex));
        elements.push({ id, name: plan.operatorEnd !== undefined ? "Flattened embedded graphic" : plan.mask ? "Rasterized image mask" : plan.image ? "Flattened image" : "Rasterized path", kind: "raster", assetId: id, reason: plan.operatorEnd !== undefined ? "form-xobject" : plan.mask ? "image-mask" : plan.image ? "image-effects" : "unsupported-path", bounds: plan.bounds, rotation: 0, opacity: 1, visible: true, zIndex: plan.operatorIndex });
        fallbackWarnings.push({ code: plan.operatorEnd !== undefined ? "pdf-form-rasterized" : plan.mask ? "pdf-image-mask-rasterized" : plan.image ? "pdf-image-flattened" : "pdf-path-rasterized", message: plan.operatorEnd !== undefined ? "An embedded graphic was preserved as an image. Reliably mapped text remains separately editable." : plan.mask ? "An image mask was preserved as a transparent image. Its mask and color are no longer separately editable." : plan.image ? "An image was flattened to preserve its clipping, transform or opacity. These effects are no longer separately editable." : "A complex or clipped path was preserved as an image. Other objects remain editable.", elementId: id });
      }
      if (!separation && (complexPage || unmatchedText || uncertainText.size)) {
        const indexes = compositePaints(operators.fnArray, operators.argsArray, new Set(elements.map((element) => element.zIndex)));
        for (const index of uncertainText) indexes.add(index);
        if (unmatchedText) {
          if (!textZIndexes.length) throw new Error("pdf-text-paint-unmapped");
          for (const index of textZIndexes) indexes.add(index);
          // Ambiguous extraction may produce more fragments than paint ops.
          // Include every reconstructed text box in replacement bounds rather
          // than leaving a guessed late-z-index fragment over the source raster.
          for (const element of elements) if (element.kind === "text") element.zIndex = textZIndexes[0]!;
        }
        if(unmatchedText){editableTextIds.clear();editableTextPaints.clear();}
        for(const index of editableTextPaints)indexes.delete(index);
        const regions = await measureCompositeRegions(page, indexes, elements, signal);
        composed = indexes.size > 0;
        const lastPaint = [...indexes].reduce((last, index) => Math.max(last, index), 0);
        const contains = (region: BoundsIR, e: ElementIR) => e.rotation === 0 && e.bounds.x >= region.x && e.bounds.y >= region.y && e.bounds.x + e.bounds.width <= region.x + region.width && e.bounds.y + e.bounds.height <= region.y + region.height;
        elements = elements.filter((e) => editableTextIds.has(e.id)||(!indexes.has(e.zIndex) && !(e.zIndex <= lastPaint && regions.some((r) => contains(r, e)))));
        for(const e of elements)if(editableTextIds.has(e.id)&&e.zIndex<=lastPaint)e.zIndex=lastPaint+1;
        const retained = new Set(elements.flatMap((e) => e.kind === "raster" ? [e.assetId] : []));
        for (let i = assets.length - 1; i >= 0; i--) if (!retained.has(assets[i]!.id)) assets.splice(i, 1);
        for (const [index, bounds] of compositeTiles(regions).entries()) {
          const bytes = await renderCompositeTile(page, bounds, signal, { fn: operators.fnArray, end: lastPaint,exclude:editableTextPaints });
          if (assets.reduce((sum, asset) => sum + asset.bytes.length, 0) + bytes.length > SECURITY_LIMITS.maxPageAssetBytes) throw new Error("page-image-byte-limit");
          const id = `pdf-composite-${index}`;
          assets.push({ id, bytes });
          elements.push({ id, name: "Flattened appearance region", kind: "raster", assetId: id, reason: "composite-effects", bounds,
            rotation: 0, opacity: 1, visible: true, zIndex: lastPaint });
        }
        if (regions.length) fallbackWarnings.push({ code: "pdf-composite-rasterized", message: "Complex graphics were preserved as images. Reliably mapped text stays editable above the graphics; overlaps and clipping may differ from the source.", elementId: "pdf-composite-0" });
      }
      return {
        schemaVersion: 1,
        ...(assets.length ? { assets } : {}),
        id: `pdf-page-${pageIndex + 1}`,
        sourceIndex: pageIndex,
        width: descriptor.width,
        height: descriptor.height,
        elements: elements.sort((a, b) => a.zIndex - b.zIndex),
        degradations: [...fallbackWarnings, ...(unsupportedTextMode && !composed ? [{ code: "pdf-text-render-mode", message: "Outlined or clipping text is not fully reconstructed. Compare this page with the source before editing." }] : []), ...(unmatchedText && !composed ? [{ code: "pdf-text-paint-unmapped", message: "Some text colors could not be matched reliably and use the default color." }] : []), ...(unsupportedPaint && !composed
          ? [{ code: "pdf-unsupported-paint", message: "Some graphics or effects are not fully supported by this alpha and may be missing or look different. Compare the imported page with the preview." }]
          : operators.fnArray.length > 0 && elements.length === 0
          ? [{ code: "pdf-editable-text-unavailable", message: "This page has paint operations but no reliably mapped editable text." }]
          : [])],
      };
    } finally {
      page.cleanup();
    }
  }

  async renderComparison(pageIndex: number, signal?: AbortSignal): Promise<PixelBuffer> {
    throwIfAborted(signal);
    const descriptor = this.catalog.pages[pageIndex];
    if (!descriptor) throw new Error("page-out-of-range");
    const size = comparisonSize(descriptor.width, descriptor.height);
    const page = await this.document.getPage(pageIndex + 1);
    const canvas = document.createElement("canvas");
    let task: ReturnType<typeof page.render> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => task?.cancel();
    try {
      throwIfAborted(signal);
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas-unavailable");
      const viewport = page.getViewport({ scale: PDF_POINTS_TO_FIGMA_PX });
      task = page.render({ canvas: null, canvasContext: context, viewport,
        transform: [size.width / viewport.width, 0, 0, size.height / viewport.height, 0, 0], background: "white" });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      timer = setTimeout(cancel, SECURITY_LIMITS.maxRasterRenderMs);
      await task.promise;
      throwIfAborted(signal);
      return context.getImageData(0, 0, size.width, size.height);
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      canvas.width = 0; canvas.height = 0; page.cleanup();
    }
  }

  async dispose(): Promise<void> {
    await this.loadingTask.destroy();
  }
}

function reconstructRectangles(fnArray: number[], argsArray: unknown[][], viewport: { transform: number[] }): ShapeElementIR[] {
  const elements: ShapeElementIR[] = [];
  let fill: ColorIR = { r: 0, g: 0, b: 0, a: 1 };
  let stroke: ColorIR = { r: 0, g: 0, b: 0, a: 1 };
  let lineWidth = 1;
  let transform = [1, 0, 0, 1, 0, 0];
  const stack: { fill: ColorIR; stroke: ColorIR; lineWidth: number; transform: number[] }[] = [];
  for (let index = 0; index < fnArray.length; index += 1) {
    const operator = fnArray[index];
    const args = argsArray[index] ?? [];
    if (operator === OPS.save || operator === OPS.paintFormXObjectBegin) {
      stack.push({ fill, stroke, lineWidth, transform: [...transform] });
      if (operator === OPS.paintFormXObjectBegin && args[0]) transform = Util.transform(transform, args[0] as number[]);
      continue;
    }
    if (operator === OPS.restore || operator === OPS.paintFormXObjectEnd) {
      const state = stack.pop();
      if (state) ({ fill, stroke, lineWidth, transform } = state);
      continue;
    }
    if (operator === OPS.transform) {
      const matrix = asNumbers(args);
      if (matrix.length === 6) transform = Util.transform(transform, matrix);
      continue;
    }
    if (operator === OPS.setFillRGBColor && typeof args[0] === "string") {
      fill = parseHexColor(args[0]);
      continue;
    }
    if (operator === OPS.setStrokeRGBColor && typeof args[0] === "string") stroke = parseHexColor(args[0]);
    if (operator === OPS.setLineWidth && typeof args[0] === "number") lineWidth = args[0];
    const hasFill = isFillOperator(args[0]);
    const hasStroke = args[0] === OPS.stroke || args[0] === OPS.closeStroke || args[0] === OPS.fillStroke || args[0] === OPS.eoFillStroke || args[0] === OPS.closeFillStroke || args[0] === OPS.closeEOFillStroke;
    if (operator !== OPS.constructPath || (!hasFill && !hasStroke)) continue;
    const sourceBounds = asNumbers(args[2]);
    if (sourceBounds.length !== 4) continue;
    const matrix = Util.transform(viewport.transform, transform);
    const scale = Math.hypot(matrix[0]!, matrix[1]!);
    if (hasStroke && (lineWidth <= 0 || Math.abs(scale - Math.hypot(matrix[2]!, matrix[3]!)) > 0.00001 || Math.abs(matrix[0]! * matrix[2]! + matrix[1]! * matrix[3]!) > 0.00001)) continue;
    const transformed = transformBounds(sourceBounds, matrix);
    if (!transformed) continue;
    const [x1, y1, x2, y2] = transformed;
    const rectangle = isAxisAlignedRectanglePath(args[1]) && matrix[1] === 0 && matrix[2] === 0;
    const pathData = rectangle ? undefined : convertPath(args[1], matrix, x1, y1);
    if (!rectangle && !pathData) continue;
    elements.push({
      id: `pdf-shape-${index + 1}`,
      name: rectangle ? "Rectangle" : "Vector",
      kind: rectangle ? "rectangle" : "path",
      ...(pathData ? { pathData, windingRule: args[0] === OPS.eoFill || args[0] === OPS.eoFillStroke || args[0] === OPS.closeEOFillStroke ? "EVENODD" as const : "NONZERO" as const } : {}),
      bounds: {
        x: roundDimension(Math.min(x1, x2)),
        y: roundDimension(Math.min(y1, y2)),
        width: roundDimension(Math.abs(x2 - x1)),
        height: roundDimension(Math.abs(y2 - y1)),
      },
      ...(hasFill ? { fill: { type: "solid" as const, color: fill } } : {}),
      ...(hasStroke ? { stroke: { paint: { type: "solid" as const, color: stroke }, width: lineWidth * scale } } : {}),
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: index,
    });
  }
  return elements;
}

function transformBounds(bounds: number[], matrix: number[]): [number, number, number, number] | null {
  const [x1, y1, x2, y2] = bounds;
  const [a, b, c, d, e, f] = matrix;
  if ([x1, y1, x2, y2, a, b, c, d, e, f].some((value) => value === undefined)) return null;
  const points = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => [a! * x! + c! * y! + e!, b! * x! + d! * y! + f!]);
  const xs = points.map(([x]) => x!);
  const ys = points.map(([, y]) => y!);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersectBounds(a: BoundsIR, b: BoundsIR): BoundsIR {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

function isFillOperator(value: unknown): boolean {
  return value === OPS.fill || value === OPS.eoFill || value === OPS.fillStroke || value === OPS.eoFillStroke || value === OPS.closeFillStroke || value === OPS.closeEOFillStroke;
}

function convertPath(value: unknown, matrix: number[], originX: number, originY: number): string | undefined {
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const values = asNumbers(value[0]);
  if (values.length > 70_000) throw new Error("path-command-limit");
  const result: string[] = [];
  for (let i = 0; i < values.length;) {
    const op = values[i++];
    const count = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : op === 4 ? 0 : -1;
    if (count < 0 || i + count > values.length) return undefined;
    result.push(op === 0 ? "M" : op === 1 ? "L" : op === 2 ? "C" : op === 3 ? "Q" : "Z");
    for (let j = 0; j < count; j += 2) {
      const x = values[i++]!; const y = values[i++]!;
      result.push(String(roundDimension(matrix[0]! * x + matrix[2]! * y + matrix[4]! - originX)), String(roundDimension(matrix[1]! * x + matrix[3]! * y + matrix[5]! - originY)));
    }
  }
  return result.join(" ");
}

function isAxisAlignedRectanglePath(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const path = asNumbers(value[0]);
  if (path.length !== 13 || path[0] !== 0 || path[3] !== 1 || path[6] !== 1 || path[9] !== 1 || path[12] !== 4) return false;
  const [, x1, y1, , x2, y2, , x3, y3, , x4, y4] = path;
  return x1 === x4 && y1 === y2 && x2 === x3 && y3 === y4;
}

function asNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((entry): entry is number => typeof entry === "number");
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  return [];
}

function parseHexColor(value: string): ColorIR {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: roundColor(Number.parseInt(match[1] ?? "00", 16) / 255),
    g: roundColor(Number.parseInt(match[2] ?? "00", 16) / 255),
    b: roundColor(Number.parseInt(match[3] ?? "00", 16) / 255),
    a: 1,
  };
}

function roundColor(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function roundDimension(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeFontFamily(value: string | undefined): string {
  const family = value?.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  if (family === "serif") return "Times New Roman";
  if (family === "monospace") return "Courier New";
  if (!family || family === "sans-serif") return "Inter";
  return family;
}

function identifyFont(value: unknown, fallback: string | undefined): LocalFont {
  const font = value as { name?: unknown; bold?: unknown; italic?: unknown } | undefined;
  const name = typeof font?.name === "string" ? font.name.replace(/^[A-Z]{6}\+/, "") : undefined;
  const bold = Boolean(font?.bold) || /bold|black|heavy|[-,](?:DmBd|Bd|BdIt)$/i.test(name ?? "");
  const italic = Boolean(font?.italic) || /italic|oblique|[-,](?:LtIt|BdIt|It)$/i.test(name ?? "");
  return {
    family: normalizeFontFamily(name?.replace(/[-,](?:BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman|DmBd|BdIt|LtIt|Bd|Rg|It)$/i, "") ?? fallback),
    style: bold ? (italic ? "Bold Italic" : "Bold") : italic ? "Italic" : "Regular",
  };
}

function truncateName(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= 80 ? oneLine : `${oneLine.slice(0, 77)}…`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
}
