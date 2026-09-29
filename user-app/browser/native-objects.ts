import {embeddedChartValues} from './native-workbook'
import { PptxCatalogReader, PRESENTATION as P, DRAWING as A, OFFICE_REL } from '../vendor/drag/src/formats/pptx/catalog'
import { child, kids, appearance, color, fill, themeFont, path } from '../vendor/drag/src/formats/pptx/appearance'
import { C, cc, ck, value, readChartGroups } from '../vendor/drag/src/formats/pptx/chart-data'
import { DIAGRAM as D } from '../vendor/drag/src/formats/pptx/smart-art'
import type { NativeChart, NativeDiagram, NativeTable } from '../lib/design-system/native-contract'

/** Extract data before drawing. Rendering degradations must not discard the
 * editable Office object or turn it into an image-only design-system atom. */
export function readNativeObjects(reader:PptxCatalogReader,root:Element,part:string) {
  const result=new Map<string,NativeChart|NativeDiagram|NativeTable>(),rels=reader.relationships(part),context=appearance(reader,part)
  const text=(body:Element)=>Array.from(body.getElementsByTagNameNS(A,'p')).map(p=>Array.from(p.getElementsByTagNameNS(A,'t')).map(t=>t.textContent??'').join('')).join('\n')
  const rgb=(e?:Element)=>{const paint=fill(e,context,()=>{} )??fill(child(e,'ln'),context,()=>{});return paint?'#'+[paint.color.r,paint.color.g,paint.color.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''):undefined}
  const palette=Array.from({length:6},(_,i)=>{const e=root.ownerDocument.createElementNS(A,'a:schemeClr');e.setAttribute('val',`accent${i+1}`);const p=color(e,context,()=>{});return p?'#'+[p.color.r,p.color.g,p.color.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''):'#4472c4'})
  for (const frame of Array.from(root.getElementsByTagNameNS(P,'graphicFrame'))) {
    const shapeId=frame.getElementsByTagNameNS(P,'cNvPr')[0]?.getAttribute('id'),data=frame.getElementsByTagNameNS(A,'graphicData')[0]
    if(!shapeId||!data)continue
    if(data.getAttribute('uri')===C) {
      const id=child(data,'chart',C)?.getAttributeNS(OFFICE_REL,'id'),rel=id?rels.get(id):undefined
      if(!rel||rel.external||!rel.type.endsWith('/chart'))continue
      const space=reader.xml(rel.target,C,'chartSpace'),plot=cc(cc(space,'chart'),'plotArea');if(!plot)continue
      const warnings:string[]=[],groups=readChartGroups(plot,w=>warnings.push(w)),axes=ck(plot).filter(e=>e.localName.endsWith('Ax'))
      let readValues:ReturnType<typeof embeddedChartValues>=null
      try{readValues=embeddedChartValues(reader,rel.target,space)}catch{warnings.push('embedded-workbook-unavailable')}
      if(readValues)for(const group of groups)for(const s of group.series){
        for(const [field,xmlName] of [['values','val'],['x','xVal'],['sizes','bubbleSize']] as const){const values=readValues(cc(s.source,xmlName)??(field==='values'?cc(s.source,'yVal'):undefined));if(values&&values.some(v=>v!==null))s[field]=values.map(v=>typeof v==='number'?v:null)}
        const categories=readValues(cc(s.source,'cat'));if(categories)s.categories=categories.map(v=>String(v??''))
        const name=readValues(cc(s.source,'tx'));if(name?.[0]!=null)s.name=String(name[0])
      }
      const axisIds=axes.filter(e=>e.localName==='valAx').map(e=>({id:value(e,'axId'),side:value(e,'axPos')}))
      const native:NativeChart={kind:'chart',sourcePart:rel.target,groups:groups.map(g=>{
        const axis=ck(g.source).filter(e=>e.localName==='axId').map(e=>e.getAttribute('val')),right=axisIds.some(a=>a.side==='r'&&axis.includes(a.id))
        return {type:g.family,grouping:g.grouping,horizontal:value(g.source,'barDir')==='bar',hole:Number(value(g.source,'holeSize','65'))/100,
          series:g.series.map((s,si)=>({name:s.name,categories:s.categories,values:s.values,format:s.format,x:s.x,sizes:s.sizes,
            axis:right?'right':'left',color:rgb(cc(s.source,'spPr'))??palette[si%6],colors:s.values.map((_,i)=>rgb(cc(ck(s.source).find(e=>e.localName==='dPt'&&value(e,'idx')===String(i)),'spPr'))??(value(g.source,'varyColors')==='1'?palette[i%6]:null)),smooth:value(s.source,'smooth')==='1'}))}
      }),legend:!!cc(cc(space,'chart'),'legend'),warnings,
      title:text(cc(cc(cc(space,'chart'),'title'),'tx')??space.ownerDocument.createElement('empty')),
      style:{font:themeFont(child(path(cc(space,'txPr'),'p','pPr','defRPr'),'latin')?.getAttribute('typeface')??'+mn-lt',context),palette,background:rgb(cc(space,'spPr')),color:rgb(path(cc(space,'txPr'),'p','pPr','defRPr')),
        grid:axes.some(e=>!!cc(e,'majorGridlines')),axis:axes.some(e=>value(e,'delete')!=='1'),labels:groups.some(g=>value(cc(g.source,'dLbls'),'showVal')==='1'||value(cc(g.source,'dLbls'),'showPercent')==='1')}}
      result.set(`${part}#${shapeId}`,native)
    } else if(data.getAttribute('uri')===D) {
      const ids=child(data,'relIds',D),dm=rels.get(ids?.getAttributeNS(OFFICE_REL,'dm')??''),lo=rels.get(ids?.getAttributeNS(OFFICE_REL,'lo')??'')
      if(!dm||dm.external||!dm.type.endsWith('/diagramData'))continue
      const model=reader.xml(dm.target,D,'dataModel'),points=Array.from(child(model,'ptLst',D)?.children??[])
      if(points.length>2048)throw new Error('security-limit')
      const nodes=points.filter(p=>!p.hasAttribute('type')||p.getAttribute('type')==='node').map(p=>({id:p.getAttribute('modelId')??'',text:text(p)})),known=new Set(nodes.map(n=>n.id))
      const edges=Array.from(child(model,'cxnLst',D)?.children??[]).filter(e=>e.getAttribute('type')==='parOf').map(e=>({from:e.getAttribute('srcId')??'',to:e.getAttribute('destId')??'',order:Number(e.getAttribute('srcOrd')??0)})).filter(e=>known.has(e.from)&&known.has(e.to))
      const layout=lo&&!lo.external&&lo.type.endsWith('/diagramLayout')?reader.xml(lo.target,D,'layoutDef'):undefined
      const algorithms=layout?Array.from(layout.getElementsByTagNameNS(D,'alg')).map(e=>e.getAttribute('type')??''):[]
      result.set(`${part}#${shapeId}`,{kind:'smartart',sourcePart:dm.target,nodes,edges,algorithms,layoutName:layout?.getAttribute('uniqueId')??'',
        // Kept as data/provenance. It is never evaluated as a program by HTML.
        dataXml:new XMLSerializer().serializeToString(model),layoutXml:layout?new XMLSerializer().serializeToString(layout):''})
    } else {
      const tbl=child(data,'tbl');if(!tbl)continue
      const columns=kids(child(tbl,'tblGrid')).filter(e=>e.localName==='gridCol').map(e=>Number(e.getAttribute('w'))/9525)
      const rows=kids(tbl).filter(e=>e.localName==='tr').map(row=>({height:Number(row.getAttribute('h'))/9525,cells:kids(row).filter(e=>e.localName==='tc').map(cell=>({text:text(cell),colSpan:Number(cell.getAttribute('gridSpan')??1),rowSpan:Number(cell.getAttribute('rowSpan')??1),merged:cell.getAttribute('hMerge')==='1'||cell.getAttribute('vMerge')==='1'}))}))
      result.set(`${part}#${shapeId}`,{kind:'table',sourcePart:part,columns,rows})
    }
  }
  return result
}
