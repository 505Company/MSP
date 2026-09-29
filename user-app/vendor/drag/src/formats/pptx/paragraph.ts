import type { ParagraphIR } from "../../core/model";
import { child,kids } from "./appearance";
export function percentage(raw:string|null,fallback:number):number {
  if(raw===null)return fallback;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(raw))throw new Error("invalid-file");
  const value=raw.endsWith("%")?Number(raw.slice(0,-1)):Number(raw)/1000;
  if(!Number.isFinite(value)||value<0||value>1000)throw new Error("security-limit");return value;
}
export function paragraphProperties(layers:(Element|undefined)[],attrs:Record<string,string>,sx:number,sy:number,fontSize:number,reduction:number,warn:()=>void):Omit<ParagraphIR,"start"|"end"> {
  const last=(name:string)=>layers.map(p=>child(p,name)).filter((p):p is Element=>!!p).at(-1);
  const distance=(key:string)=>{const n=attrs[key]===undefined?0:Number(attrs[key])/9525*sx;if(!Number.isFinite(n)||Math.abs(n)>10000)throw new Error("security-limit");return n;};
  const spacing=(name:string)=>{
    const container=last(name);if(!container)return undefined;
    const children=kids(container);if(children.length!==1)throw new Error("invalid-file");
    const node=children[0]!;
    if(node.localName==="spcPct")return {unit:"PERCENT" as const,value:percentage(node.getAttribute("val"),100)};
    if(node.localName!=="spcPts")throw new Error("invalid-file");
    const value=Number(node.getAttribute("val"))/100*96/72*sy;
    if(!node.hasAttribute("val")||!Number.isFinite(value)||value<0||value>10000)throw new Error("security-limit");return {unit:"PIXELS" as const,value};
  };
  let lineHeight=spacing("lnSpc");
  if(reduction){lineHeight??={unit:"PERCENT",value:100};if(lineHeight.unit==="PERCENT")lineHeight={...lineHeight,value:lineHeight.value-reduction};}
  if(lineHeight&&lineHeight.value<=0)throw new Error("security-limit");
  const gap=(name:string)=>{const s=spacing(name);if(s?.unit==="PERCENT")warn();return s?.unit==="PIXELS"?s.value:(s?.value??0)/100*fontSize;};
  const align=({l:"LEFT",ctr:"CENTER",r:"RIGHT",just:"JUSTIFIED"} as const)[attrs.algn as "l"]??"LEFT";
  if(attrs.algn&&!["l","ctr","r","just"].includes(attrs.algn))warn();
  if(attrs.rtl==="1")warn();
  const tabs=kids(last("tabLst")).map(t=>{const position=Number(t.getAttribute("pos"))/9525*sx;if(!Number.isFinite(position)||position<0||position>10000)throw new Error("security-limit");const value=t.getAttribute("algn")??"l";if(!["l","ctr","r"].includes(value))warn();return {position,align:(value==="r"?"RIGHT":value==="ctr"?"CENTER":"LEFT") as "LEFT"|"CENTER"|"RIGHT"};});
  if(tabs.length>64)throw new Error("security-limit");for(let i=1;i<tabs.length;i++)if(tabs[i]!.position<=tabs[i-1]!.position)throw new Error("invalid-file");
  const defaultTab=attrs.defTabSz===undefined?96:Number(attrs.defTabSz)/9525*sx;if(!Number.isFinite(defaultTab)||defaultTab<=0||defaultTab>10000)throw new Error("security-limit");
  const left=distance("marL"),right=distance("marR"),indent=distance("indent");
  if(left<0||right<0)throw new Error("invalid-file");
  return {...(tabs.length?{tabs}:{}),defaultTab,align,left,right,indent,before:gap("spcBef"),after:gap("spcAft"),fontSize,...(lineHeight?{lineHeight}:{})};
}
