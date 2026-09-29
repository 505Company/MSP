

import { PptxCatalogReader, PRESENTATION, DRAWING, OFFICE_REL } from '../vendor/drag/src/formats/pptx/catalog';
import { readSlide } from '../vendor/drag/src/formats/pptx/scene';
import type { ElementIR } from '../vendor/drag/src/core/model';
import { renderSlidePreview } from '../vendor/drag/src/formats/pptx/preview';
import type { SourceAsset, SourceSnapshot } from '../lib/digital-designer/source-types';
import { ensureSceneFonts, registerEmbeddedFont, resolveSourceFonts } from './fonts';
import { extractEmbeddedFonts } from '../lib/uploads/embedded-fonts';
import { sha256Bytes as hash } from '../lib/uploads/binary-bytes';
import { readNativeObjects } from './native-objects';
export type { SourceAsset, SourceElement, SourceSnapshot } from '../lib/digital-designer/source-types';

export async function readPresentation(bytes: Uint8Array, name: string, signal?: AbortSignal, onProgress?: (current:number,total:number)=>void, onlySlides?: number[]): Promise<{ snapshot: SourceSnapshot; assets: SourceAsset[]; previews: { id: string; dataUrl: string }[] }> {
  const sourceId = await hash(bytes);
  const previews: { id: string; dataUrl: string }[] = [];

  try {

    const reader = new PptxCatalogReader(bytes, new DOMParser());
    const pages = reader.analyze().pages;
    if (!pages.length || pages.length > 100) throw new Error('analysis-page-limit');
    if (onlySlides && (!onlySlides.length || new Set(onlySlides).size !== onlySlides.length || onlySlides.some(n => !Number.isInteger(n) || n < 1 || n > pages.length))) throw new Error('invalid-page-selection');
    const embeddedFonts=extractEmbeddedFonts(bytes);
    for (const font of embeddedFonts) await registerEmbeddedFont(font.family,font.style,font.bytes).catch(()=>undefined);
    const stored = new Map<string, SourceAsset>();
    const colors = new Map<string, number>();
    const fonts = new Map<string, { sizes: Set<number>; occurrences: number }>();
    const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId, name, slideCount: pages.length, slides: [], elements: [], assets: [], colors: [], fonts: [], limitations: [
      'Структура разрешена существующим читателем Drag a Slide; предупреждения чтения сохранены по слайдам.',
      'Обнаруженное повторение является наблюдением, пока не подтверждено правило. Скрытые части растра не восстанавливаются.',
      'Исходные изображения и геометрия их кадрирования сохранены отдельно от нормализованных объектов.'
    ] };
    const addAsset = async (data: Uint8Array, origin: string): Promise<string> => {
      const id = `asset-${(await hash(data)).slice(0, 24)}`;
      const existing = stored.get(id);
      if (existing) { if (!existing.origins.includes(origin)) existing.origins.push(origin); return id; }
      let mime = 'application/octet-stream', extension = 'bin';
      if (data[0] === 0x89 && data[1] === 0x50) { mime = 'image/png'; extension = 'png'; }
      else if (data[0] === 0xff && data[1] === 0xd8) { mime = 'image/jpeg'; extension = 'jpg'; }
      else if (new TextDecoder().decode(data.slice(0, 512)).includes('<svg')) { mime = 'image/svg+xml'; extension = 'svg'; }
      else if (new TextDecoder().decode(data.slice(0, 12)).includes('WEBP')) { mime = 'image/webp'; extension = 'webp'; }
      stored.set(id, { id, bytes: data, mime, extension, origins: [origin] }); return id;
    };
    const collectColors = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const x = value as Record<string, unknown>;
      if (['r', 'g', 'b'].every(k => typeof x[k] === 'number' && Number(x[k]) >= 0 && Number(x[k]) <= 1)) {
        const hex = '#' + ['r', 'g', 'b'].map(k => Math.round(Number(x[k]) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
        colors.set(hex, (colors.get(hex) || 0) + 1);
      } else for (const child of Object.values(x)) collectColors(child);
    };
    for (const descriptor of pages) {
      if (onlySlides && !onlySlides.includes(descriptor.sourceIndex + 1)) continue;
      onProgress?.(descriptor.sourceIndex + 1, pages.length);
      signal?.throwIfAborted();
      const slide = descriptor.sourceIndex + 1, prefix = `s${String(slide).padStart(2, '0')}`;
      const root = reader.xml(descriptor.part, PRESENTATION, 'sld');
      const text = Array.from(root.getElementsByTagNameNS(DRAWING, 't')).map(n => n.textContent || '').join('\n');
      const record = { id: prefix, number: slide, width: descriptor.width, height: descriptor.height, part: descriptor.part, text, warnings: [] as string[] };
      snapshot.slides.push(record);
      let nativeObjects:ReturnType<typeof readNativeObjects>=new Map();
      try {
        nativeObjects = readNativeObjects(reader, root, descriptor.part);
        const page = await readSlide(reader, descriptor, signal);
        const faces:{family:string;style:string}[]=[]
        const collectFaces=(elements:ElementIR[])=>{for(const e of elements){if(e.kind==='text')for(const r of [e,...e.styleRuns??[]])faces.push({family:r.fontFamily,style:r.fontStyle??'Regular'});if('children' in e)collectFaces(e.children)}}
        collectFaces(page.elements);await resolveSourceFonts(embeddedFonts,faces)
        record.warnings.push(...(await ensureSceneFonts(page.elements)).map(i=>`${i.code}: ${i.message}`));
        record.warnings.push(...page.degradations.map(d => `${d.code}: ${d.message}`));
        const assets = new Map<string,string>();
        for (const a of page.assets || []) assets.set(a.id, await addAsset(a.bytes, `${descriptor.part}#normalized:${a.id}`));
        try { previews.push({id: prefix, dataUrl: await compactPreview(await renderSlidePreview(page, 1024, signal))}); }
        catch { record.warnings.push('preview-unavailable'); }
        const visit = async (items: ElementIR[], parentId?: string) => {
          for (const item of items) {
            // These labels/colors are reader diagnostics, not artwork in the deck.
            const native = item.sourceRef ? nativeObjects.get(`${item.sourceRef.part}#${item.sourceRef.shapeId}`) : undefined;
            if (isReaderPlaceholder(item) && !native) continue;
            const id = `${prefix}-${item.id}`;
            const properties = { ...item } as Record<string, unknown>;
            delete properties.id; delete properties.name; delete properties.kind; delete properties.children;
            if (native) properties.native = native;
            if (item.kind === 'raster') properties.assetId = assets.get(item.assetId) || null;
            if ('tableGrid' in item && item.tableGrid) {
              const grid=item.tableGrid,toId=(value:string)=>`${prefix}-${value}`;
              properties.tableGrid={...grid,containers:grid.containers.map(toId),rows:grid.rows.map(toId),cells:grid.cells.map(c=>({...c,id:toId(c.id),...(c.borderId?{borderId:toId(c.borderId)}:{})}))};
            }
            snapshot.elements.push({ id, slide, kind: item.kind, name: item.name, properties, ...(parentId ? { parentId } : {}) });
            collectColors(properties);
            if (item.kind === 'text') {
              const families=new Map<string,Set<number>>();
              for(const style of [item,...item.styleRuns??[]]){const sizes=families.get(style.fontFamily)??new Set<number>();sizes.add(style.fontSize);families.set(style.fontFamily,sizes);}
              for(const [family,sizes] of families){const f=fonts.get(family)??{sizes:new Set<number>(),occurrences:0};sizes.forEach(size=>f.sizes.add(size));f.occurrences++;fonts.set(family,f);}
            }
            if ('children' in item) await visit(item.children, id);
          }
        };
        await visit(page.elements);
      } catch (error) {
        if (signal?.aborted) throw error;
        const code = error instanceof Error && /^[a-z][a-z0-9-]{1,60}$/.test(error.message) ? error.message : 'reader-environment-error';
        for(const frame of Array.from(root.getElementsByTagNameNS(PRESENTATION,'graphicFrame'))){
          const shapeId=frame.getElementsByTagNameNS(PRESENTATION,'cNvPr')[0]?.getAttribute('id'),native=nativeObjects.get(`${descriptor.part}#${shapeId}`);
          if(!native)continue;
          const xfrm=frame.getElementsByTagNameNS(PRESENTATION,'xfrm')[0],off=xfrm?.getElementsByTagNameNS(DRAWING,'off')[0],ext=xfrm?.getElementsByTagNameNS(DRAWING,'ext')[0];
          const bounds={x:Number(off?.getAttribute('x')??0)/9525,y:Number(off?.getAttribute('y')??0)/9525,width:Number(ext?.getAttribute('cx')??0)/9525,height:Number(ext?.getAttribute('cy')??0)/9525};
          if(Object.values(bounds).every(Number.isFinite)&&bounds.width>0&&bounds.height>0)snapshot.elements.push({id:`${prefix}-native-${shapeId}`,slide,kind:'group',name:'Native object — layout unavailable',properties:{bounds,visible:true,opacity:1,rotation:0,zIndex:0,native,sourceRef:{part:descriptor.part,shapeId}}});
        }
        record.warnings.push(`normalized-page-unavailable (${code}): часть нормализованной структуры недоступна; исходный текст и изображения сохранены.`);
      }
      // Keep original pictures and crops even when the existing reader rasterizes a mask.
      const parts = [{ part: descriptor.part, root }];
      const layout = [...reader.relationships(descriptor.part).values()].find(r => r.type.endsWith('/slideLayout'));
      if (layout) {
        parts.push({ part: layout.target, root: reader.xml(layout.target, PRESENTATION, 'sldLayout') });
        const master = [...reader.relationships(layout.target).values()].find(r => r.type.endsWith('/slideMaster'));
        if (master) parts.push({ part: master.target, root: reader.xml(master.target, PRESENTATION, 'sldMaster') });
      }
      for (const [partIndex, source] of parts.entries()) {
        const rels = reader.relationships(source.part);
        for (const pic of [...Array.from(source.root.getElementsByTagNameNS(PRESENTATION, 'pic')),...Array.from(source.root.getElementsByTagNameNS(PRESENTATION, 'sp')).filter(s=>s.getElementsByTagNameNS(DRAWING,'blipFill').length)]) {
          const info = pic.getElementsByTagNameNS(PRESENTATION, 'cNvPr')[0];
          const blip = pic.getElementsByTagNameNS(DRAWING, 'blip')[0];
          const rel = rels.get(blip?.getAttributeNS(OFFICE_REL, 'embed') || '');
          if (!rel || rel.external || !rel.type.endsWith('/image')) continue;
          const assetId = await addAsset(reader.readAsset(rel.target), rel.target);
          const crop = pic.getElementsByTagNameNS(DRAWING, 'srcRect')[0];
          const shape = pic.getElementsByTagNameNS(DRAWING, 'prstGeom')[0];
          const rawId = info?.getAttribute('id') || String(snapshot.elements.length);
          snapshot.elements.push({ id: `${prefix}-picture-${partIndex}-${rawId}`, slide, kind: 'source-picture', name: info?.getAttribute('name') || 'Изображение', properties: {
            sourcePart: source.part, sourceShapeId: rawId, inherited: partIndex > 0, assetId,
            crop: Object.fromEntries(['l', 't', 'r', 'b'].map(side => [side, Number(crop?.getAttribute(side) || 0) / 100000])),
            maskPreset: shape?.getAttribute('prst') || null
          } });
        }
      }
    }
    snapshot.assets = [...stored.values()].map(a => ({ id: a.id, mime: a.mime, byteLength: a.bytes.length, origins: a.origins }));
    snapshot.colors = [...colors.entries()].sort((a, b) => b[1] - a[1]).map(([hex, occurrences]) => ({ hex, occurrences }));
    snapshot.fonts = [...fonts.entries()].map(([family, f]) => ({ family, sizes: [...f.sizes].sort((a, b) => a - b), occurrences: f.occurrences }));
    return { snapshot, assets: [...stored.values()], previews };
  } finally { /* No global mutations: browser-native reader. */ }
}
export function isReaderPlaceholder(item: ElementIR): boolean {
  return item.kind === 'group' && item.name === 'Unavailable graphic'
    && item.children.some(c => c.name === 'Graphic placeholder') && item.children.some(c => c.name === 'Graphic status');
}

// Match the checkpoint's JPEG preview budget; lossless PNG can exceed provider request limits.
async function compactPreview(dataUrl: string): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl;
  });
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
  const jpeg = canvas.toDataURL('image/jpeg', .85); canvas.width = canvas.height = 1; return jpeg;
}
