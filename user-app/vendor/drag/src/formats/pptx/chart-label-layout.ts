import type {TextElementIR} from "../../core/model";
/** Bounded label-box placement. Preserves every source label; reports unresolved crowding. */
export function placeChartLabels(labels:TextElementIR[],area:{x:number;y:number;width:number;height:number}):boolean{
 if(labels.length>512)return false;
 const placed:TextElementIR["bounds"][]=[];let complete=true;
 const overlaps=(a:TextElementIR["bounds"],b:TextElementIR["bounds"])=>a.x<b.x+b.width+2&&a.x+a.width+2>b.x&&a.y<b.y+b.height+2&&a.y+a.height+2>b.y;
 for(const label of labels){
  const b=label.bounds,original={...b};let found=false;
  for(let attempt=0;attempt<25;attempt++){
   const ring=Math.ceil(attempt/4),dir=attempt%4,dx=dir===1?ring*(b.width+3):dir===3?-ring*(b.width+3):0,dy=dir===0?-ring*(b.height+3):dir===2?ring*(b.height+3):0;
   const candidate={...b,x:Math.max(area.x,Math.min(area.x+area.width-b.width,original.x+dx)),y:Math.max(area.y,Math.min(area.y+area.height-b.height,original.y+dy))};
   if(b.width<=area.width&&b.height<=area.height&&!placed.some(other=>overlaps(candidate,other))){label.bounds=candidate;found=true;break;}
  }
  if(!found)complete=false;placed.push(label.bounds);
 }
 return complete;
}
