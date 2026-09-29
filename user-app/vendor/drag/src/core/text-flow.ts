import type {TextElementIR,ParagraphIR} from "./model";
import {paragraphText,paragraphLineHeight} from "./paragraph-text";
export interface TextPlacement {text:TextElementIR;paragraph:ParagraphIR;x:number;y:number;width:number;height:number}
export async function flowText(source:TextElementIR,measure:(text:TextElementIR,p:ParagraphIR)=>Promise<{width:number;height:number}>):Promise<{items:TextPlacement[];height:number;overflow:boolean}> {
  const cfg=source.flow,columns=cfg?.columns??1,gap=cfg?.gap??0,width=(source.bounds.width-gap*(columns-1))/columns,height=source.bounds.height;
  if(width<=0)throw new Error("invalid-column-width");
  let col=0,y=0,probes=0;const items:TextPlacement[]=[],heights=Array.from({length:columns},()=>0),deadline=Date.now()+15000;
  const metrics=async(text:TextElementIR,p:ParagraphIR)=>{if(++probes>1024||Date.now()>deadline)throw new Error("text-layout-limit");const m=await measure(text,p);if(!Number.isFinite(m.width)||!Number.isFinite(m.height)||m.height<0||m.width<0)throw new Error("text-measurement-unavailable");return m;};
  const next=()=>{if(col+1<columns){heights[col]=Math.max(heights[col]!,y);col++;y=0;return true;}return false;};
  const base={...source,bounds:{...source.bounds,width}};
  for(const [index,original] of (source.paragraphs??[]).entries()){
    let p={...original};if(p.left+p.right>=width)throw new Error("invalid-column-margins");
    if(y+p.before+paragraphLineHeight(p)>height&&y>0)next();y+=p.before;
    if(p.start===p.end){y+=paragraphLineHeight(p)+p.after;if(y>1000000)throw new Error("text-layout-limit");heights[col]=Math.max(heights[col]!,y);continue;}
    const hanging=p.indent<0&&p.markerLength;
    if(p.indent<0)p={...p,indent:0};
    if(hanging)p={...p,start:p.start+original.markerLength!};
    let cursor=p.start,first=true;
    while(cursor<p.end){
      let chunk={...p,start:cursor,indent:first?p.indent:0};
      const text=paragraphText(base,chunk,index);
      if(text.text.includes("\t")){
        // Tabbed source lines stay one line; each field is independently editable.
        const lines=text.text.split("\n");let offset=cursor;
        for(const line of lines){
          const fields=line.split("\t");let fieldStart=offset,x=chunk.left,rowHeight=paragraphLineHeight(chunk);const row:TextPlacement[]=[];
          for(const [n,field] of fields.entries()){
            const fp={...chunk,start:fieldStart,end:fieldStart+field.length,indent:0,align:"LEFT" as const};
            const ft=paragraphText(base,fp,index);ft.textBox!.wrap=false;
            const m=field?await metrics(ft,fp):{width:0,height:paragraphLineHeight(fp)};
            let align="LEFT";
            if(n){const stop=chunk.tabs?.find(t=>t.position>x-chunk.left+0.01);const step=chunk.defaultTab??96;const position=stop?.position??(Math.floor((x-chunk.left)/step)+1)*step;x=chunk.left+position;align=stop?.align??"LEFT";}
            const left=align==="RIGHT"?x-m.width:align==="CENTER"?x-m.width/2:x;
            if(field)row.push({text:ft,paragraph:fp,x:left,y:0,width:m.width,height:m.height});
            x=Math.max(x,left+m.width);rowHeight=Math.max(rowHeight,m.height);fieldStart+=field.length+1;
          }
          if(y+rowHeight>height&&y>0)next();
          for(const item of row){item.x+=col*(width+gap);item.y=y;items.push(item);}y+=rowHeight;offset+=line.length+1;
        }
        cursor=p.end;
      }else{
        let m=await metrics(text,chunk),chosen=text;
        if(columns>1&&y+m.height>height){
          const remaining=height-y;
          if(remaining<paragraphLineHeight(chunk)&&y>0&&next())continue;
          if(col+1<columns){
            const boundaries=[...text.text.matchAll(/\s+/g)].map(match=>match.index!+match[0].length).filter(n=>n<text.text.length);
            if(!boundaries.length){let n=0;for(const char of text.text){n+=char.length;if(n<text.text.length)boundaries.push(n);}}
            let low=0,high=boundaries.length-1,best=0;
            while(low<=high){const mid=(low+high)>>1,end=boundaries[mid]!,trialP={...chunk,end:cursor+end},trial=paragraphText(base,trialP,index),size=await metrics(trial,trialP);if(size.height<=remaining){best=end;low=mid+1;}else high=mid-1;}
            if(best){chunk={...chunk,end:cursor+best};chosen=paragraphText(base,chunk,index);m=await metrics(chosen,chunk);}
            else if(y>0&&next())continue;
          }
        }
        items.push({text:chosen,paragraph:chunk,x:col*(width+gap)+chunk.left,y,width:m.width,height:m.height});
        if(first&&hanging){
          const markerText=source.text.slice(original.start,original.start+original.markerLength!).trimEnd();
          const markerSource=paragraphText(base,{...original,end:original.start+markerText.length},index);
          const marker:TextElementIR={...markerSource,text:markerText,id:`${chosen.id}-marker`,name:`List marker ${index+1}`,linkRuns:[],textBox:{align:"LEFT",vertical:"TOP",wrap:false}};
          const mp={...chunk,indent:0},mm=await metrics(marker,mp);items.push({text:marker,paragraph:mp,x:col*(width+gap)+original.left+original.indent,y,width:mm.width,height:mm.height});
        }
        cursor=chunk.end;y+=m.height;if(cursor<p.end)next();
      }
      first=false;if(items.length>20000||y>1000000)throw new Error("text-layout-limit");
    }
    y+=p.after;heights[col]=Math.max(heights[col]!,y);
  }
  let overflow=heights.some(h=>h>height+1);
  for(const item of items){const column=Math.min(columns-1,Math.max(0,Math.floor((item.x+0.01)/(width+gap))));const shift=source.textBox?.vertical==="CENTER"?(height-heights[column]!)/2:source.textBox?.vertical==="BOTTOM"?height-heights[column]!:0;item.y+=shift;if(item.x+item.width>source.bounds.width+1)overflow=true;}
  return {items,height:Math.max(...heights),overflow};
}
export function scaleText(source:TextElementIR,factor:number):TextElementIR {return {...source,fontSize:source.fontSize*factor,styleRuns:source.styleRuns?.map(r=>({...r,fontSize:r.fontSize*factor,...(r.letterSpacing===undefined?{}:{letterSpacing:r.letterSpacing*factor})}))??[],paragraphs:source.paragraphs?.map(p=>({...p,fontSize:p.fontSize*factor,...(p.lineHeight?.unit==="PIXELS"?{lineHeight:{...p.lineHeight,value:p.lineHeight.value*factor}}:{})}))??[]};}
