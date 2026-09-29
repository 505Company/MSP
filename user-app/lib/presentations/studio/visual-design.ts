import type {ElementIR} from '../../../vendor/drag/src/core/model'
import {assembleBackground,type BackgroundCatalog} from '../../design-system/backgrounds'
import {masterContentArea} from '../../design-system/slide-masters'
import {studioTheme} from './theme'
import {overlap} from './color-zones'
import type {Box,Candidate,ContentSlide,StudioLibrary,Slot} from './contract'

/** Reuse one observed background's ornaments only where the measured content
 * leaves room. Do not invent bands, stretch the art or mix unrelated presets. */
/** Diagram connectors are meaningful only inside their source diagram. Older
 * imports may call them decorations, including rasterized timeline arrows. */
function backgroundArtwork(art:BackgroundCatalog['artworks'][number],placement:BackgroundCatalog['artworks'][number]['placements'][number]){
  if(/таймлайн|timeline|коннектор|connector|стрелк|arrow|разделител|divider|ось\b|axis\b/iu.test(art.name))return false
  const b=placement.bounds,short=Math.min(b.width,b.height),long=Math.max(b.width,b.height)
  const horizontal=b.width>=b.height,center=horizontal?(b.y+b.height/2)/placement.height:(b.x+b.width/2)/placement.width
  // A long thin mark through the content area is a rule, even when its source
  // name is generic. Edge ribbons and branded patterns remain eligible.
  return !(long/Math.max(1,short)>24&&short/(horizontal?placement.height:placement.width)<.04&&center>.12&&center<.88)
}

export function contentBackground(library:StudioLibrary,occupied:Box[],sourceSlides:number[]=[],canvasFillId?:string,rules:Box[]=[]){
  const catalog=library.backgrounds;if(!catalog)return
  const pad=(b:Box,gap:number)=>({x:b.x-gap,y:b.y-gap,w:b.w+gap*2,h:b.h+gap*2})
  const padded=[...occupied.map(b=>pad(b,20)),...rules.map(b=>pad(b,64))]
  const fill=catalog.fills.find(f=>f.id===canvasFillId)??catalog.fills.slice().sort((a,b)=>b.slides.length-a.slides.length)[0]
  return catalog.presets.filter(p=>p.selection.fillId===fill?.id).map(p=>{
    const layers=p.selection.layers.filter(layer=>{
      const art=catalog.artworks.find(a=>a.id===layer.artworkId),placement=art?.placements.find(v=>v.id===layer.placementId)
      if(!art||!placement||art.kind==='panel'||!backgroundArtwork(art,placement))return false
      const scene=assembleBackground(catalog,{fillId:null,layers:[layer]},{width:1920,height:1080})
      const b=scene.elements[0].children[0].bounds,box={x:b.x,y:b.y,w:b.width,h:b.height}
      return box.w*box.h>=10000&&!padded.some(r=>overlap(box,r)>1)
    })
    return {id:p.id,selection:{fillId:p.selection.fillId,layers},score:layers.length+Number(p.slides.some(n=>sourceSlides.includes(n)))*2}
  }).filter(p=>p.selection.layers.length).sort((a,b)=>b.score-a.score)[0]
}

export function backgroundDesigns(library:StudioLibrary){
  const catalog=library.backgrounds;if(!catalog)return []
  return catalog.presets.flatMap(p=>{
    // Fixed branding is rendered separately on every slide. It must not make
    // a cover with logos on both edges look like full-width cover artwork.
    const selection={...p.selection,masterId:undefined,layers:p.selection.layers.filter(layer=>{const a=catalog.artworks.find(a=>a.id===layer.artworkId),placement=a?.placements.find(p=>p.id===layer.placementId);return a&&placement&&backgroundArtwork(a,placement)})}
    const scene=assembleBackground(catalog,selection,{width:1920,height:1080}),art=scene.elements[0].children.slice(selection.fillId?1:0)
    const leaves=(e:ElementIR):ElementIR[]=>'children' in e?e.children.flatMap(leaves):[e]
    const marks=art.flatMap(leaves),meaningful=marks.some(e=>['raster','path','ellipse'].includes(e.kind))||marks.length>=3
    // A blank half-page panel is a content placeholder, not cover artwork.
    if(art.length&&!meaningful)return []
    const left=art.filter(e=>e.bounds.x>=800),right=art.filter(e=>e.bounds.x+e.bounds.width<=1120)
    const area:Box=catalog.masters?.[0]?masterContentArea(catalog.masters[0]):{x:48,y:48,w:1824,h:984}
    if(art.length){
      if(left.length===art.length)area.w=Math.min(...left.map(e=>e.bounds.x))-area.x-48
      else if(right.length===art.length){area.x=Math.max(...right.map(e=>e.bounds.x+e.bounds.width))+48;area.w=1872-area.x}
      else return []
    }
    if(area.w<640)return []
    const fill=catalog.fills.find(f=>f.id===p.selection.fillId),color=fill?.element.fill?.color
    const background=color?'#'+[color.r,color.g,color.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''):studioTheme(library).background
    const colors=library.tokens.colors.map(c=>c.hex).filter(c=>/^#[\da-f]{6}$/i.test(c))
    const light=(hex:string)=>[1,3,5].reduce((n,i)=>n+parseInt(hex.slice(i,i+2),16)*[.2126,.7152,.0722][(i-1)/2],0)
    const ink=[...colors].sort((a,b)=>Math.abs(light(b)-light(background))-Math.abs(light(a)-light(background)))[0]
    return [{id:p.id,sourceSlides:p.slides,selection,area,background,ink,hasArtwork:!!art.length}]
  })
}

/** Covers reuse the library's complete background, with text outside the
 * observed artwork. Source proportions and margins remain untouched. */
export function libraryCoverCandidates(slide:ContentSlide,library:StudioLibrary):Candidate[]{
  if(slide.id!=='slide-1'||slide.blocks.some(b=>b.kind!=='text'||b.data)||slide.blocks.length>4)return []
  const title=slide.blocks.find(b=>b.role==='title'),body=slide.blocks.filter(b=>b.role==='body'),footer=slide.blocks.filter(b=>b.role==='footer')
  if(!title||body.length>2)return []
  return backgroundDesigns(library).filter(d=>d.hasArtwork).slice(0,6).flatMap(d=>{
    const a=d.area,tail=footer.length?80:0,top=Math.round((a.h-tail-48)*.52/4)*4
    const slot=(b:ContentSlide['blocks'][number],y:number,h:number):Slot=>({region:b.id,blocks:[b.id],direction:'column',columns:1,gap:0,rect:{x:a.x,y,w:a.w,h},presentation:{components:'bare',ink:'ink'}})
    const original:Candidate={id:`composition/library-cover/${d.id}`,recipeId:'composition/library-cover',label:'Обложка · фон из дизайн-системы',backgroundId:d.id,score:400,slots:[slot(title,a.y,top),...body.map((b,i)=>slot(b,a.y+top+32+i*(a.h-top-tail-64)/body.length,(a.h-top-tail-64)/body.length)),...footer.map(b=>slot(b,a.y+a.h-tail,tail))]}
    const bodyHeight=Math.max(160,Math.round((a.h-tail-64)*.32/4)*4),titleHeight=a.h-tail-bodyHeight-64
    const reversed:Candidate={...original,id:original.id+'/headline-low',label:'Обложка · акцент внизу',slots:[...body.map((b,i)=>slot(b,a.y+i*bodyHeight/Math.max(1,body.length),bodyHeight/Math.max(1,body.length))),slot(title,a.y+bodyHeight+32,titleHeight),...footer.map(b=>slot(b,a.y+a.h-tail,tail))]}
    const centered:Candidate={...original,id:original.id+'/centered',label:'Обложка · компактный центр',slots:original.slots.map(s=>({...s,presentation:{...s.presentation,align:'center'}}))}
    // Centering changes actual positioning inside a region; signatures must
    // also record it, rather than treating three identical previews as variety.
    return [original,reversed,centered]
  })
}
