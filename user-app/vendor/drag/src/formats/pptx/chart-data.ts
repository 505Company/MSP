import { child, kids, number } from "./appearance";
export const C="http://schemas.openxmlformats.org/drawingml/2006/chart";
export const cc=(e:Element|undefined,name:string)=>child(e,name,C);
export const ck=(e:Element|undefined)=>kids(e,C);
export const value=(e:Element|undefined,name:string,fallback="")=>cc(e,name)?.getAttribute("val")??fallback;
export interface ChartSeries {
  source:Element; name:string; values:(number|null)[]; categories:string[];
  x:(number|null)[]; sizes:(number|null)[]; format:string;
}
export interface ChartGroup { source:Element; family:string; grouping:string; series:ChartSeries[] }

/** Read saved chart caches only. Never evaluate formulas or open embedded workbook data. */
export function readChartGroups(plot:Element, warn:(code:string)=>void):ChartGroup[] {
  let total=0;
  return ck(plot).filter(e=>e.localName.endsWith("Chart")).map(source=>{
    const series=ck(source).filter(e=>e.localName==="ser");
    if(series.length>32)throw new Error("security-limit");
    return {source,family:source.localName,grouping:value(source,"grouping","standard"),series:series.map((ser,i)=>{
      const vals=cache(cc(ser,"val")??cc(ser,"yVal"),true,warn);
      const xs=cache(cc(ser,"xVal"),true,warn),sizes=cache(cc(ser,"bubbleSize"),true,warn),cats=cache(cc(ser,"cat"),false,warn);
      total+=Math.max(vals.values.length,xs.values.length,sizes.values.length,cats.values.length);
      if(total>10000)throw new Error("security-limit");
      const tx=cc(ser,"tx"),name=cc(tx,"v")?.textContent??cache(tx,false,warn).values[0]??`Series ${i+1}`;
      return {source:ser,name:String(name),values:vals.values as (number|null)[],x:xs.values as (number|null)[],sizes:sizes.values as (number|null)[],categories:cats.values.map(v=>v===null?"":String(v)),format:vals.format};
    })};
  });
}
function cache(container:Element|undefined,numeric:boolean,warn:(code:string)=>void):{values:(string|number|null)[];format:string} {
  if(!container)return {values:[],format:"General"};
  const reference=ck(container).find(e=>["numRef","strRef","multiLvlStrRef"].includes(e.localName));
  const data=reference?cc(reference,"numCache")??cc(reference,"strCache")??cc(reference,"multiLvlStrCache"):cc(container,"numLit")??cc(container,"strLit");
  if(!data){if(reference)warn("pptx-chart-data");return {values:[],format:"General"};}
  const declared=number(cc(data,"ptCount"),"val",0);
  if(!Number.isInteger(declared)||declared<0||declared>2000)throw new Error("security-limit");
  const layers=data.localName==="multiLvlStrCache"?ck(data).filter(e=>e.localName==="lvl"):[data];
  const result:(string|number|null)[]=Array(declared).fill(null);
  for(const layer of layers){
    const seen=new Set<number>();
    for(const pt of ck(layer).filter(e=>e.localName==="pt")){
      const idx=number(pt,"idx",-1);
      if(!Number.isInteger(idx)||idx<0||idx>=2000||seen.has(idx)||declared>0&&idx>=declared)throw new Error("invalid-file");
      seen.add(idx);while(result.length<=idx)result.push(null);
      const raw=cc(pt,"v")?.textContent??"";
      if(raw.length>100000)throw new Error("security-limit");
      if(numeric){
        if(raw.trim()===""){result[idx]=null;continue;}
        if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())){warn("pptx-chart-data");result[idx]=null;continue;}
        const v=Number(raw);if(!Number.isFinite(v)||Math.abs(v)>1e100)throw new Error("security-limit");result[idx]=v;
      }else result[idx]=result[idx]===null?raw:`${raw}\n${result[idx]}`;
    }
  }
  if(data.localName==="multiLvlStrCache")warn("pptx-chart-layout");
  return {values:result,format:cc(data,"formatCode")?.textContent??"General"};
}
export function formatted(n:number,format:string,warn:(code:string)=>void):string {
  if(!Number.isFinite(n))throw new Error("invalid-file");
  if(!format||format==="General")return Number(n.toPrecision(6)).toString();
  const cleaned=format.split(";")[0]!.replace(/\\(.)/g,"$1");
  if(!/^[#0,.%$€£¥ \-]+$/.test(cleaned)){warn("pptx-chart-format");return Number(n.toPrecision(6)).toString();}
  const decimals=cleaned.includes(".")?(cleaned.split(".")[1]?.match(/^[0#]+/)?.[0].length??0):0;
  const percent=cleaned.includes("%"),currency=cleaned.match(/[$€£¥]/)?.[0]??"";
  return currency+new Intl.NumberFormat("en-US",{minimumFractionDigits:Math.min(decimals,8),maximumFractionDigits:Math.min(decimals,8),useGrouping:cleaned.includes(",")}).format(percent?n*100:n)+(percent?"%":"");
}
