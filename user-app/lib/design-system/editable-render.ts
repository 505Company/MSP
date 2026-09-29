import {graphicHtml,graphElements} from './diagram-graph'
import {renderNativeLayout} from './editable-native-layout'
import {editableTableLayout} from './editable-table'
import type { EditableTemplate, EditableData } from './editable-contract'

/** One deterministic HTML/SVG renderer in the app and downloaded HTML. It is
 * self contained so exports keep the same data-driven behaviour offline. */
export function renderEditableHtml(template: EditableTemplate, data: EditableData = template.data, chartBox?:{width:number;height:number}): string {
  const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
  const n=(v:unknown,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:fallback
  const safeColor=(v:unknown)=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v)?v:undefined
  data={...data,items:data.items?.map(i=>({...i,color:safeColor(i.color),ranges:i.ranges?.map(r=>({...r,color:safeColor(r.color)}))})),series:data.series?.map(s=>({...s,color:safeColor(s.color),colors:s.colors?.map(v=>safeColor(v)??'#0077ff')}))}
  const s=template.style,c=template.config,accent=s.accent??'#0077ff',color=s.color??'#111111',muted=s.muted??'#b3d3e4'
  const palette=s.palette?.length?s.palette:[accent,'#ff2b8b','#79e7ed',muted,'#eaf3f8','#ffe8f1']
  const fontSize=n(s.fontSize,22),gap=n(s.gap,24),pad=n(s.padding,20),round=n(s.radius,0)
  const css=`box-sizing:border-box;width:100%;min-width:0;font-family:${esc(s.font??'Arial')},sans-serif;font-size:${fontSize}px;line-height:1.25;color:${color};background:${s.background??'#ffffff'};padding:${pad}px;border-radius:${round}px;${s.border?`border:1px solid ${s.border};`:''}text-align:${s.align??'left'};overflow-wrap:anywhere;`
  const heading=(t?:string,scale=1.4)=>t?`<div data-field="title" style="font-family:${esc(s.headingFont??s.font??'Arial')},sans-serif;font-size:${fontSize*scale}px;line-height:1.15;margin-bottom:${gap*.65}px;white-space:pre-wrap">${esc(t)}</div>`:''
  const para=(t?:string)=>t?`<div data-field="text" style="white-space:pre-wrap">${esc(t)}</div>`:''
  const graphic=(id?:string)=>id&&template.graphicHtml[id]?`<div style="width:72px;height:72px;flex-shrink:0">${template.graphicHtml[id]}</div>`:''
  const number=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v)
  let html=''
  if(template.sourceInline){
    const inline=template.sourceInline,unit=100/template.width
    html=`<div data-source-inline style="container-type:inline-size"><div style="display:flow-root;font-family:${esc(inline.font)},sans-serif;font-size:${inline.fontSize*unit}cqw;line-height:1.25;font-weight:${inline.bold?700:400};color:${inline.color}"><span style="float:left;width:${inline.width*unit}cqw;height:${inline.height*unit}cqw;margin-right:${unit*5}cqw">${inline.graphic}</span><span data-field="text">${esc([data.title,data.text,data.value,...data.items?.map(i=>i.text??i.title??i.value)??[]].filter(Boolean).join(' ').trim())}</span></div></div>`
  }
  else if(template.sourceChart&&data.series?.length===1&&data.series[0].values.every(v=>v!==null&&v>=0)){
    const source=template.sourceChart,values=data.series[0].values,max=Math.max(1,...values.map(v=>v??0)),maxWidth=Math.max(...source.rows.map(r=>r.sourceLayout!.bar!.width)),width=Math.max(...source.rows.map(r=>r.width))
    const unchanged=JSON.stringify(values)===JSON.stringify(template.data.series?.[0].values)
    html=heading(data.title)+`<div data-source-chart style="display:grid;gap:${source.gap}px">${values.map((value,i)=>{
      const row=source.rows[i%source.rows.length],layout=row.sourceLayout!,label=unchanged?source.labels[i]:`${number(value!)}${source.labels[i%source.labels.length].includes('%')?'%':data.unit??''}`
      const bound={...row.data,title:data.categories?.[i]??'',text:label}
      return `<div data-chart-row="${i}" data-value="${value}">${renderNativeLayout(layout,bound,width,row.height,unchanged?1:value!/max*maxWidth/layout.bar!.width)}</div>`
    }).join('')}</div>`
  }
  else if(template.sourceRegion?.elements)html=graphicHtml(template.sourceRegion.elements,template.width,template.height,template.diagramUploadId??'',data)
  else if(template.diagramGraph)html=graphicHtml(graphElements(template.diagramGraph),template.width,template.height,template.diagramUploadId??'',data)
  else if(template.sourceLayout)html=renderNativeLayout(template.sourceLayout,data,template.width,template.height)
  else if (template.kind==='composition') {
    const children=template.children??[],count=data.children?.length??children.length
    const columns=c.layout==='stack'?1:n(c.columns,Math.min(3,count))
    const tracks=template.columnWidths?.length===columns&&template.columnWidths.every(w=>Number.isFinite(w)&&w>0)?template.columnWidths.map(w=>`minmax(0,${w}fr)`).join(' '):c.layout==='split'?'2fr 1fr':`repeat(${columns},minmax(0,1fr))`
    html=`<div style="display:grid;grid-template-columns:${tracks};gap:${gap}px;align-items:stretch">${Array.from({length:count},(_,i)=>{const child=children.find(t=>t.id===data.children?.[i].templateId)??children[i%children.length];return child?`<div data-member="${esc(child.id)}" style="min-width:0">${renderEditableHtml(child,data.children?.[i]??child.data)}</div>`:''}).join('')}</div>`
  } else if(template.sourceDiagram&&(template.kind==='diagram'||template.kind==='smartart'&&data.items?.length===template.data.items?.length&&data.items?.every(i=>template.data.items?.some(j=>j.id===i.id&&j.parentId===i.parentId))&&template.sourceDiagram.text.every(t=>(data.items?.find(i=>i.id===t.id)?.text??'').length<=Math.max(8,t.width*t.height/(t.fontSize*t.fontSize*.65))))){
    const d=template.sourceDiagram
    html=`<div style="position:relative;aspect-ratio:${template.width}/${template.height};width:100%">${d.graphic}<svg viewBox="0 0 ${template.width} ${template.height}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${d.text.map(t=>`<foreignObject x="${t.x}" y="${t.y}" width="${t.width}" height="${Math.max(t.height,t.fontSize*1.25)}"><div xmlns="http://www.w3.org/1999/xhtml" data-source-text="${esc(t.id)}" style="font-family:${esc(t.font)},sans-serif;font-size:${t.fontSize}px;line-height:1.15;color:${t.color};text-align:${t.align};white-space:pre-wrap;overflow-wrap:anywhere">${esc(data.items?.find(i=>i.id===t.id)?.text)}</div></foreignObject>`).join('')}</svg></div>`
  } else if(template.kind==='progress')html=`<div style="display:flex;gap:${gap}px;align-items:center;justify-content:${s.align==='center'?'center':'flex-start'}">${(data.items??[]).map((i,index)=>`<span style="display:flex;gap:10px;align-items:center"><span aria-label="${esc(i.title??i.text??`Этап ${index+1}`)}" style="display:block;flex-shrink:0;width:28px;height:28px;border:2px solid ${i.color??accent};border-radius:50%;background:${i.color??accent}"></span>${heading(i.title,1)}${para(i.text)}</span>`).join('')}</div>`
  else if (template.kind==='text') html=heading(data.title,1.12)+para(data.text)+(data.items?.length?`<ul style="margin:0;padding-left:1.2em;display:grid;gap:${gap*.6}px">${data.items.map(i=>`<li style="white-space:pre-wrap">${esc(i.title??i.text)}</li>`).join('')}</ul>`:'')
  else if (template.kind==='feature') {
    const mark=s.marker&&s.marker!=='none'?`background:${s.markerColor??accent};border-radius:${s.marker==='circle'?'50%':s.marker==='petal'?'0 48% 0 0':'0'};padding:18px;`:''
    html=`<div style="display:flex;flex-direction:column;align-items:${s.align==='center'?'center':'flex-start'};gap:${gap}px"><div style="${mark}">${graphic(data.graphicId)||`<span style="font-size:32px;color:${accent}">${esc(data.value??'')}</span>`}</div><div>${heading(data.title,1.12)}${para(data.text)}${(data.items??[]).map(i=>heading(i.title,1.12)+para(i.text)).join('')}</div></div>`
  } else if (template.kind==='metric') html=`<div data-field="value" style="font-family:${esc(s.headingFont??s.font??'Arial')},sans-serif;font-size:${n(s.metricSize,96)}px;line-height:1;color:${accent};white-space:normal;margin-bottom:${gap}px;font-variant-numeric:tabular-nums">${esc(data.value)}<span style="font-size:.62em">${esc(data.unit)}</span></div>${heading(data.title,1.1)}${para(data.text)}${(data.items??[]).map(i=>heading(i.title,1.1)+para(i.text)).join('')}`
  else if (template.kind==='table') {
    const rows=[data.columns??[],...data.rows??[]],{styles,widths}=editableTableLayout(template,data)
    html=heading(data.title)+`<div style="overflow-x:auto"><table data-editable-table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:${fontSize}px"><colgroup>${rows[0].map((_,i)=>`<col style="width:${widths[i]}%"/>`).join('')}</colgroup><tbody>${rows.map((row,ri)=>`<tr>${row.map((cell,ci)=>{
      const style=styles[ri]?.[ci]
      if(style?.hidden)return ''
      const emphasized=s.accentRow===ri-1||s.accentColumn===ci
      const bg=style?.background??(emphasized?accent:ri===0?s.headerFill:ri%2===0?s.stripe:undefined)??'transparent'
      const ink=style?.color??(emphasized?'#ffffff':ri===0?s.headerColor:undefined)??color
      return `<${ri===0?'th':'td'} ${ri===0?'scope="col"':''} ${style?.colSpan&&style.colSpan>1?`colspan="${style.colSpan}"`:''} ${style?.rowSpan&&style.rowSpan>1?`rowspan="${style.rowSpan}"`:''} style="padding:${fontSize*.6}px ${fontSize*.5}px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;background:${bg};color:${ink};text-align:${style?.align??(ci===0?'left':'right')};font-weight:${style?.bold?'700':'400'};border-bottom:1px solid ${style?.borderBottom??s.border??'#d2e0e8'}">${esc(cell)}</${ri===0?'th':'td'}>`
    }).join('')}</tr>`).join('')}</tbody></table></div>`+para(data.text)
  } else if (template.kind==='timeline') {
    html=heading(data.title)+`<div style="display:grid;grid-template-columns:repeat(${n(c.columns,4)},minmax(0,1fr));gap:${gap*1.8}px 0">${(data.items??[]).map((item,i)=>`<div style="position:relative;padding:20px 22px 0 0;border-top:2px solid ${muted}"><span style="position:absolute;top:-8px;left:0;width:14px;height:14px;border-radius:50%;background:${item.color??accent}"></span><div style="font-size:${fontSize*1.7}px;margin:4px 0 10px">${esc(item.title??String(i+1))}</div><div style="white-space:pre-wrap">${esc(item.text)}</div></div>`).join('')}</div>`
  } else if (template.kind==='gantt') {
    const periods=data.periods??[],items=data.items??[]
    html=heading(data.title)+`<div style="display:grid;grid-template-columns:minmax(110px,22%) minmax(0,1fr);gap:${gap}px 18px">${items.map(item=>`<div style="align-self:center">${esc(item.title)}</div><div style="position:relative;min-height:38px;background:linear-gradient(transparent calc(50% - .5px),#dbe1e6 50%,transparent calc(50% + .5px))">${(item.ranges??[]).map(range=>`<span data-range-start="${range.start}" data-range-end="${range.end}" style="position:absolute;top:10px;left:${range.start/periods.length*100}%;width:${(range.end-range.start)/periods.length*100}%;height:22px;background:${range.color??item.color??accent};border-radius:20px"></span>`).join('')}</div>`).join('')}<span></span><div style="display:grid;grid-template-columns:repeat(${periods.length},1fr);border-top:2px solid #dbe1e6;padding-top:14px;gap:5px;font-size:${fontSize*.8}px">${periods.map(p=>`<span>${esc(p)}</span>`).join('')}</div></div>`
  } else if (template.kind==='smartart') {
    const items=data.items??[],parents=new Map(items.map(i=>[i.id,i.parentId])),layout=c.diagramLayout??'grid'
    const level=(id?:string)=>{let depth=0;const seen=new Set<string>();while(id&&parents.get(id)&&!seen.has(id)){seen.add(id);id=parents.get(id);depth++}return depth}
    const levels=items.map(i=>level(i.id)),rows=Math.max(1,...levels.map(n=>n+1)),w=900,rowHeight=Math.max(150,...items.map(i=>Math.ceil((i.title??i.text??'').length/14)*24+60)),h=layout==='tree'?Math.max(300,rows*rowHeight):layout==='cycle'?560:360
    const boxes=items.map((item,i)=>{
      const row=levels[i],peers=levels.filter(n=>n===row).length,position=levels.slice(0,i).filter(n=>n===row).length
      const width=layout==='tree'?Math.min(250,(w-40)/peers-24):layout==='pyramid'?180+(i+1)*500/items.length:layout==='cycle'?180:Math.min(240,(w-40)/Math.min(4,items.length)-24),height=Math.max(90,Math.ceil((item.title??item.text??'').length/Math.max(1,Math.floor((width-24)/10)))*24+24)
      const angle=-Math.PI/2+i*Math.PI*2/items.length
      return {item,width,height,x:layout==='tree'?(position+.5)*(w-40)/peers+20-width/2:layout==='cycle'?w/2+Math.cos(angle)*300-width/2:layout==='pyramid'?(w-width)/2:20+(i%4)*((w-40)/Math.min(4,items.length)),y:layout==='tree'?20+row*rowHeight:layout==='cycle'?h/2+Math.sin(angle)*200-height/2:layout==='pyramid'?i*rowHeight:20+Math.floor(i/4)*rowHeight}
    })
    const height=Math.max(h,...boxes.map(b=>b.y+b.height+20)),byId=new Map(boxes.map(b=>[b.item.id,b]))
    const links=boxes.flatMap(b=>{const a=byId.get(b.item.parentId);return a?[`<path d="M${a.x+a.width/2} ${a.y+a.height} V${(a.y+a.height+b.y)/2} H${b.x+b.width/2} V${b.y}" fill="none" stroke="${muted}" stroke-width="2"/>`]:[]}).join('')
    html=heading(data.title)+`<svg viewBox="0 0 ${w} ${height}" width="100%" role="img" aria-label="SmartArt">${links}${boxes.map(b=>`<g data-node="${esc(b.item.id)}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${round||8}" fill="${b.item.color??accent}"/><foreignObject x="${b.x+12}" y="${b.y+12}" width="${b.width-24}" height="${b.height-24}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:white;font-size:19px;line-height:1.2;text-align:center;overflow-wrap:anywhere">${esc(b.item.title??b.item.text)}</div></foreignObject></g>`).join('')}</svg>`
  } else if (template.kind==='radial') {
    const items=data.items??[],left=items.filter((_,i)=>i%2===0),right=items.filter((_,i)=>i%2===1)
    const column=(values:typeof items)=>`<div style="display:flex;flex-direction:column;justify-content:space-around;gap:${gap}px">${values.map(i=>`<div>${heading(i.title,1)}${para(i.text)}</div>`).join('')}</div>`
    html=`<div style="display:grid;grid-template-columns:1fr minmax(180px,1.5fr) 1fr;gap:${gap}px;align-items:stretch">${column(left)}<div style="border:${Math.max(18,gap)}px solid ${s.markerColor??'#eaf3f8'};border-radius:50%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;color:${accent};box-shadow:inset 0 0 0 2px ${accent};font-size:${fontSize*1.5}px"><div>${esc(data.title??data.text)}</div></div>${column(right)}</div>`
  } else if (template.kind==='chart') {
    const series=data.series??[],cats=data.categories??[],circular=['donut','pie'].includes(c.chartType??'')
    const legend=c.legend?`<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px 18px;margin-top:14px;font-size:${fontSize*.8}px">${(circular?cats:series.map(s=>s.name)).map((name,i)=>`<span style="display:inline-flex;gap:7px;align-items:center"><i style="display:block;width:11px;height:11px;flex-shrink:0;background:${circular?series[0]?.colors?.[i]??palette[i%palette.length]:series[i]?.color??palette[i%palette.length]}"></i>${esc(name)}</span>`).join('')}</div>`:''
    if(['scatter','bubble','radar'].includes(c.chartType??'')) {
      const w=800,h=460,pad=50,values=series.flatMap(s=>s.values.map(v=>v??0)),xs=series.flatMap(s=>s.x??s.values.map((_,i)=>i+1)).map(v=>v??0),min=c.yMin??Math.min(0,...values),max=Math.max(min+1,c.yMax??Math.max(1,...values)),xmin=Math.min(0,...xs),xmax=Math.max(xmin+1,...xs)
      if(c.chartType==='radar'){
        const cx=w/2,cy=h/2,r=180,point=(v:number,i:number)=>({x:cx+Math.cos(-Math.PI/2+i*2*Math.PI/cats.length)*r*v/max,y:cy+Math.sin(-Math.PI/2+i*2*Math.PI/cats.length)*r*v/max})
        const spokes=cats.map((label,i)=>{const p=point(max,i);return `<path d="M${cx} ${cy}L${p.x} ${p.y}" stroke="${muted}"/><text x="${p.x}" y="${p.y-8}" text-anchor="middle" font-size="16">${esc(label)}</text>`}).join('')
        html=heading(data.title)+`<svg viewBox="0 0 ${w} ${h}" width="100%" data-editable-chart>${spokes}${series.map((s,si)=>`<polygon points="${s.values.map((v,i)=>{const p=point(v??0,i);return `${p.x},${p.y}`}).join(' ')}" fill="none" stroke="${s.color??palette[si%palette.length]}" stroke-width="3"/>`).join('')}</svg>`+legend
      }else html=heading(data.title)+`<svg viewBox="0 0 ${w} ${h}" width="100%" data-editable-chart><path d="M${pad} ${pad}V${h-pad}H${w-pad}" stroke="${muted}" fill="none"/>${series.map((s,si)=>s.values.map((v,i)=>v===null||s.x?.[i]===null?'':`<circle data-value="${v}" cx="${pad+((s.x?.[i]??i+1)-xmin)/(xmax-xmin)*(w-2*pad)}" cy="${h-pad-(v-min)/(max-min)*(h-2*pad)}" r="${c.chartType==='bubble'?Math.max(3,Math.min(45,Math.sqrt(Math.abs(s.sizes?.[i]??1))*5)):5}" fill="${s.color??palette[si%palette.length]}" fill-opacity=".75"/>`).join('')).join('')}</svg>`+legend
    } else if(circular) {
      const values=series[0]?.values??[],total=values.reduce<number>((sum,v)=>sum+(v??0),0),hole=c.chartType==='pie'?0:n(c.hole,.66),r=145,cx=180,cy=180
      const wedges=series.map((ring,ri)=>{
       const outer=r-(r-r*hole)*ri/series.length,inner=hole?r-(r-r*hole)*(ri+1)/series.length:0,values=ring.values,total=values.reduce<number>((sum,v)=>sum+(v??0),0);let at=-Math.PI/2
       return values.map((v,i)=>{
        if(v===null||v<=0||!total)return ''
        const start=at,delta=Math.min(v/total*Math.PI*2,Math.PI*2-.000001),end=at+delta;at=end
        const p=(a:number,radius:number)=>`${cx+Math.cos(a)*radius} ${cy+Math.sin(a)*radius}`
        const path=hole?`M${p(start,outer)} A${outer} ${outer} 0 ${delta>Math.PI?1:0} 1 ${p(end,outer)} L${p(end,inner)} A${inner} ${inner} 0 ${delta>Math.PI?1:0} 0 ${p(start,inner)} Z`:`M${cx} ${cy} L${p(start,r)} A${r} ${r} 0 ${delta>Math.PI?1:0} 1 ${p(end,r)} Z`
        const middle=(start+end)/2,lr=(inner+outer)/2
        return `<path data-value="${v}" d="${path}" fill="${ring.colors?.[i]??palette[i%palette.length]}"/>${c.labels&&delta>.21?`<text x="${cx+Math.cos(middle)*lr}" y="${cy+Math.sin(middle)*lr}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="14">${number(v/total*100)}%</text>`:''}`
      }).join('')}).join('')
      html=heading(data.title)+`<div style="position:relative;max-width:500px;margin:auto"><svg data-editable-chart viewBox="0 0 360 360" width="100%" style="display:block" role="img" aria-label="${esc(template.name)}">${wedges||`<circle cx="180" cy="180" r="145" fill="none" stroke="${muted}" stroke-width="20"/>`}</svg>${hole?`<div style="position:absolute;inset:${(1-hole)*50+8}%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.15"><span style="font-size:${data.value?fontSize*2.6:fontSize}px;color:${data.value?accent:color}">${esc(data.value&&total&&data.unit==='%'?number((values[0]??0)/total*100):data.value??data.text)}${esc(data.value?data.unit:'')}</span>${data.value&&data.text?`<small style="margin-top:12px;font-size:${fontSize*.75}px">${esc(data.text)}</small>`:''}</div>`:''}</div>`+legend
    } else {
      const w=chartBox?.width??900,h=chartBox?.height??(c.horizontal?Math.max(320,cats.length*36+64):420),labelSize=chartBox?20:cats.length>12?12:15,tickSize=chartBox?20:14,left=c.horizontal?240:72,right=series.some(s=>s.axis==='right')?76:24,top=20,bottom=c.horizontal?30:chartBox&&cats.length>8?Math.max(76,Math.max(...cats.map(s=>s.length))*labelSize*.45+30):76,pw=w-left-right,ph=Math.max(60,h-top-bottom)
      const extent=(axis:string)=>{
        const selected=series.filter(s=>(s.axis??'left')===axis),values=selected.flatMap(s=>s.values.filter((v):v is number=>v!==null))
        if(c.stacked)for(let i=0;i<cats.length;i++) { values.push(selected.reduce((sum,s)=>sum+Math.max(0,s.values[i]??0),0)); values.push(selected.reduce((sum,s)=>sum+Math.min(0,s.values[i]??0),0)) }
        const min=axis==='left'?n(c.yMin,Math.min(0,...values)):Math.min(0,...values),max=axis==='left'?n(c.yMax,Math.max(1,...values)*1.08):Math.max(1,...values)*1.08
        return {min,max:Math.max(min+1,max)}
      }
      const ranges={left:extent('left'),right:extent('right')},project=(v:number,axis:'left'|'right'='left')=>{const r=ranges[axis];return c.horizontal?left+(v-r.min)/(r.max-r.min)*pw:top+ph-(v-r.min)/(r.max-r.min)*ph}
      const step=(c.horizontal?ph:pw)/Math.max(1,cats.length),position=(i:number)=>c.horizontal?top+(i+.5)*step:left+(i+.5)*step
      const ticks=c.axis!==false||c.grid?Array.from({length:5},(_,i)=>{
        const value=ranges.left.min+(ranges.left.max-ranges.left.min)*i/4,p=project(value)
        return (c.grid?`<path d="${c.horizontal?`M${p} ${top}v${ph}`:`M${left} ${p}h${pw}`}" stroke="#e1e5e9"/>`:'')+(c.axis!==false?`<text x="${c.horizontal?p:left-12}" y="${c.horizontal?top+ph+22:p+4}" text-anchor="${c.horizontal?'middle':'end'}" font-size="${tickSize}" fill="${color}">${esc(number(value))}</text>`:'')
      }).join(''):''
      const barCount=series.filter(s=>(s.type??(c.chartType==='combo'?'bar':c.chartType))==='bar').length
      let barIndex=0
      const plotted=series.map((ser,si)=>{
        const type=ser.type??(c.chartType==='combo'?'bar':c.chartType),ink=ser.color??palette[si%palette.length],axis=ser.axis??'left'
        if(type==='bar') {
          const index=barIndex++,bw=step*.72/(c.stacked?1:Math.max(1,barCount))
          return ser.values.map((value,i)=>{
            if(value===null)return ''
            const prior=c.stacked?series.slice(0,si).filter(s=>(s.axis??'left')===axis&&(s.type??'bar')==='bar').reduce((sum,s)=>sum+((s.values[i]??0)*value>0?s.values[i]??0:0),0):0
            const a=project(prior,axis),b=project(prior+value,axis),pos=position(i)-step*.36+(c.stacked?0:index*bw)
            return `<rect data-value="${value}" x="${c.horizontal?Math.min(a,b):pos}" y="${c.horizontal?pos:Math.min(a,b)}" width="${c.horizontal?Math.abs(b-a):bw}" height="${c.horizontal?bw:Math.abs(b-a)}" fill="${ser.colors?.[i]??ink}"/>${c.labels?`<text x="${c.horizontal?b+7:pos+bw/2}" y="${c.horizontal?pos+bw/2+4:b-7}" text-anchor="${c.horizontal?'start':'middle'}" font-size="15" fill="${color}">${number(value)}${esc(data.unit)}</text>`:''}`
          }).join('')
        }
        // Nulls split paths: a missing value is never silently plotted as zero.
        const segments:{x:number;y:number;floor:number}[][]=[[]]
        ser.values.forEach((v,i)=>{if(v===null){if(segments.at(-1)!.length)segments.push([])}else {const floor=c.stacked&&type==='area'?series.slice(0,si).filter(s=>(s.axis??'left')===axis&&(s.type??c.chartType)==='area').reduce((sum,s)=>sum+((s.values[i]??0)*v>0?s.values[i]??0:0),0):0;segments.at(-1)!.push({x:position(i),y:project(floor+v,axis),floor:project(floor,axis)})}})
        return segments.filter(points=>points.length).map(points=>{
          let path=`M${points[0].x} ${points[0].y}`
          for(let i=1;i<points.length;i++){const p=points[i-1],q=points[i];path+=c.smooth?` C${(p.x+q.x)/2} ${p.y} ${(p.x+q.x)/2} ${q.y} ${q.x} ${q.y}`:` L${q.x} ${q.y}`}
          if(type==='area')path+=points.toReversed().map(p=>` L${p.x} ${p.floor}`).join('')+' Z'
          return `<path data-series="${esc(ser.name)}" d="${path}" fill="${type==='area'?ink:'none'}" stroke="${ink}" stroke-width="3"/>`
        }).join('')
      }).join('')
      const labels=cats.map((cat,i)=>`<text x="${c.horizontal?left-14:position(i)}" y="${c.horizontal?position(i)+5:top+ph+24}" text-anchor="${c.horizontal?'end':cats.length>8?'end':'middle'}" font-size="${labelSize}" fill="${color}" ${!c.horizontal&&cats.length>8?`transform="rotate(-45 ${position(i)} ${top+ph+24})"`:''}>${esc(cat)}</text>`).join('')
      const secondary=series.some(s=>s.axis==='right')?Array.from({length:5},(_,i)=>`<text x="${w-right+10}" y="${top+ph-ph*i/4+4}" font-size="${tickSize}" fill="${color}">${number(ranges.right.min+(ranges.right.max-ranges.right.min)*i/4)}</text>`).join(''):''
      html=heading(data.title)+`<svg data-editable-chart viewBox="0 0 ${w} ${h}" width="100%" style="display:block;overflow:visible" role="img" aria-label="${esc(template.name)}">${ticks}${plotted}${labels}${secondary}${c.axis!==false?`<path d="M${left} ${top} V${top+ph} H${w-right}" fill="none" stroke="#a7b3bc"/>`:''}</svg>`+legend+para(data.text)
    }
  }
  return `<section data-editable-kind="${template.kind}" style="${css}">${html}</section>`
}
