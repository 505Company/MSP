import {editableTableLayout} from '../lib/design-system/editable-table'
import type {EditableTemplate,EditableData} from '../lib/design-system/editable-contract'
import {renderEditableHtml} from '../lib/design-system/editable-render'

export function renderStudioData(box:HTMLElement,template:EditableTemplate,data:EditableData,preferredFontSize=template.style.fontSize??24){
  box.innerHTML=renderEditableHtml(template,data)
  if(template.kind==='table'){
    // Fitting changes type only. The shared renderer normally derives cell
    // padding from font size; keep the instance's original padding in MSP.
    for(const cell of box.querySelectorAll<HTMLElement>('td,th'))cell.style.padding=`${preferredFontSize*.6}px ${preferredFontSize*.5}px`
  }
  const svg=box.querySelector<SVGSVGElement>('svg[data-editable-chart]')
  if(template.kind!=='chart'||!svg||!['line','bar','area','combo'].includes(template.config.chartType??''))return
  const section=svg.parentElement!,style=getComputedStyle(section)
  const overhead=section.getBoundingClientRect().height-svg.getBoundingClientRect().height
  const width=section.getBoundingClientRect().width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)
  const height=Math.max(180,box.getBoundingClientRect().height-overhead)
  box.innerHTML=renderEditableHtml(template,data,{width,height})
}

/** Adapt a runtime instance, never the imported library. Sample column widths
 * and row indices describe sample data, not the newly supplied table. */
export function studioDataInstance(source:EditableTemplate,values:EditableData,width:number,step=0){
  const template=structuredClone(source),data=structuredClone(values)
  const preferredFontSize=Math.max(24,Math.min(32,Math.round((source.style.fontSize??24)/4)*4))
  template.style.fontSize=template.kind==='table'?Math.max(24,preferredFontSize-step*4):preferredFontSize
  if(template.kind==='chart'&&(data.series?.length??0)>1)template.config.legend=true
  if(template.kind==='table'){
    const rows=[data.columns??[],...data.rows??[]],font=preferredFontSize
    const canvas=document.createElement('canvas'),measure=canvas.getContext('2d')!
    const minimum=rows[0].map((_,c)=>Math.max(...rows.map((row,r)=>{
      measure.font=`${r===0?'700':'400'} ${font}px ${JSON.stringify(template.style.font??'Arial')}`
      return Math.max(0,...(row[c]??'').split(/\s+/).map(word=>measure.measureText(word).width))
    }))+font+4)
    const total=minimum.reduce((n,w)=>n+w,0),available=width-2*(template.style.padding??20)
    const extra=Math.max(0,available-total)/Math.max(1,minimum.length)
    template.columnWidths=minimum.map(w=>(w+extra)/Math.max(total+extra*minimum.length,1)*100)
    const numeric=rows[0].map((_,c)=>rows.slice(1).every(row=>/^[+−–-]?\d[\d\s.,%×хx+−–-]*(?:\s*(?:п\.п\.|дн\w*|ден\w*|лет|год\w*|руб\w*))?$/iu.test(row[c]??'')))
    // New data columns inherit the last visible cell's visual style. Extend
    // only this runtime instance; source merges must not cover the new cells.
    template.tableStyles=template.tableStyles?.map(row=>{
      const last=[...row].reverse().find(cell=>!cell.hidden)
      return [...row,...Array.from({length:Math.max(0,rows[0].length-row.length)},()=>({...last,hidden:false,colSpan:1,rowSpan:1}))]
    })
    template.tableStyles=editableTableLayout(template,data).styles.map(row=>row.map((style,c)=>({...style,align:numeric[c]?'right':'left'})))
    data.rowKeys=data.rows?.map((_,i)=>i)
  }
  return {template,data,preferredFontSize}
}
