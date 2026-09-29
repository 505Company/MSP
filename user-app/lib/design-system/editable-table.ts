import type {EditableTemplate,EditableData,TableCellStyle} from './editable-contract'

/** Preserve source cell styles through row edits. A removed merge owner cannot
 * leave invisible orphan cells; entering data in a covered cell opens the merge. */
export function editableTableLayout(t:EditableTemplate,data:EditableData){
 const rows=[data.columns??[],...data.rows??[]],source=t.tableStyles??[]
 const keys=rows.map((_,r)=>r===0?0:(data.rowKeys?.[r-1]??r-1)+1)
 const recurring=source.slice(1).filter(row=>!row.some(c=>c.hidden||(c.colSpan??1)>1||(c.rowSpan??1)>1)).slice(-2)
 const styles:TableCellStyle[][]=rows.map((row,r)=>row.map((_,c)=>{
  const observed=(r===0||keys[r]>0?source[keys[r]]?.[c]:undefined)??(r>0?recurring[(r-1)%Math.max(1,recurring.length)]?.[c]:undefined)
  return {...observed,hidden:false,colSpan:1,rowSpan:1}
 }))
 for(const [r,row] of rows.entries())for(let c=0;c<row.length;c++){
  const original=(r===0||keys[r]>0)?source[keys[r]]?.[c]:undefined
  if(!original||original.hidden)continue
  const colSpan=Math.min(original.colSpan??1,row.length-c)
  let rowSpan=1
  while(rowSpan<(original.rowSpan??1)&&r+rowSpan<rows.length&&keys[r+rowSpan]===keys[r]+rowSpan)rowSpan++
  if(colSpan===1&&rowSpan===1)continue
  let occupied=false
  for(let rr=r;rr<r+rowSpan;rr++)for(let cc=c;cc<c+colSpan;cc++)if((rr!==r||cc!==c)&&rows[rr]?.[cc]?.trim())occupied=true
  if(occupied)continue
  styles[r][c]={...styles[r][c],colSpan,rowSpan}
  for(let rr=r;rr<r+rowSpan;rr++)for(let cc=c;cc<c+colSpan;cc++)if(rr!==r||cc!==c)styles[rr][cc]={...styles[rr][cc],hidden:true}
 }
 const widths=rows[0].map((_,c)=>t.columnWidths?.[c]??100/Math.max(1,rows[0].length)),total=widths.reduce((n,w)=>n+w,0)||1
 return {styles,widths:widths.map(w=>w/total*100)}
}
