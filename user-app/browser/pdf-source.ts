import { LocalPdfSession } from '../vendor/drag/src/formats/pdf/local-pdf-session'
import type { PreparedPresentation, SourceAsset, SourceSnapshot } from '../lib/digital-designer/source-types'
import type { ElementIR } from '../vendor/drag/src/core/model'
import { sha256Bytes as hash } from '../lib/uploads/binary-bytes'

export const executionVersion = 2 as const

export async function preparePdf(bytes:Uint8Array,name:string,onProgress?:(current:number,total:number)=>void):Promise<PreparedPresentation> {
  const sourceId=await hash(bytes),session=await LocalPdfSession.open(bytes),assets:SourceAsset[]=[],previews:{id:string;dataUrl:string}[]=[],fonts=new Map<string,Set<number>>(),colors=new Map<string,number>()
  const snapshot:SourceSnapshot={schemaVersion:1,sourceId,name,slideCount:session.catalog.pageCount,slides:[],elements:[],assets:[],fonts:[],colors:[],limitations:['PDF сохраняет текст и поддержанные векторные объекты. Табличные связи, ряды данных и семантика диаграмм восстанавливаются отдельно; растровые области остаются изображениями.']}
  try {
    for(const descriptor of session.catalog.pages){
      const slide=descriptor.index+1,prefix=`s${String(slide).padStart(2,'0')}`;onProgress?.(slide,session.catalog.pageCount)
      const page=await session.readPage(descriptor.index),assetIds=new Map<string,string>()
      for(const a of page.assets??[]){const id='asset-'+(await hash(a.bytes)).slice(0,24);assetIds.set(a.id,id);if(!assets.some(s=>s.id===id))assets.push({id,bytes:a.bytes,mime:'image/png',extension:'png',origins:[`pdf/page-${slide}#${a.id}`]})}
      const visit=(items:ElementIR[],parentId?:string)=>{for(const e of items){const id=`${prefix}-${e.id}`,properties={...e} as Record<string,unknown>;delete properties.id;delete properties.name;delete properties.kind;delete properties.children
        if(e.kind==='raster')properties.assetId=assetIds.get(e.assetId)
        snapshot.elements.push({id,slide,name:e.name,kind:e.kind,properties,...(parentId?{parentId}:{})})
        if(e.kind==='text'){const sizes=fonts.get(e.fontFamily)??new Set<number>();sizes.add(e.fontSize);fonts.set(e.fontFamily,sizes)}
        if('fill' in e&&e.fill){const c=e.fill.color,hex='#'+[c.r,c.g,c.b].map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');colors.set(hex,(colors.get(hex)??0)+1)}
        if('children' in e)visit(e.children,id)
      }}
      visit(page.elements)
      snapshot.slides.push({id:prefix,number:slide,width:page.width,height:page.height,part:`pdf/page-${slide}`,text:snapshot.elements.filter(e=>e.slide===slide&&e.kind==='text').map(e=>String(e.properties.text)).join('\n'),warnings:page.degradations.map(d=>`${d.code}: ${d.message}`)})
      const png=await session.renderPreview(descriptor.index,1024),image=new Image();image.src=png;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);previews.push({id:prefix,dataUrl:canvas.toDataURL('image/jpeg',.86)});canvas.width=canvas.height=1
    }
  } finally {await session.dispose()}
  snapshot.assets=assets.map(a=>({id:a.id,mime:a.mime,byteLength:a.bytes.length,origins:a.origins}));snapshot.fonts=[...fonts].map(([family,sizes])=>({family,sizes:[...sizes],occurrences:snapshot.elements.filter(e=>e.properties.fontFamily===family).length}));snapshot.colors=[...colors].map(([hex,occurrences])=>({hex,occurrences}))
  return {snapshot,assets,previews,sheets:[],renderer:'msp-web-2026-09-25',previewKind:'reconstruction'}
}
