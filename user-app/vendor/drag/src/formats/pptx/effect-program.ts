import {child, kids, number} from "./appearance";
export type PixelEffect = {kind:"grayscl"|"biLevel"|"alphaModFix"|"alphaRepl"|"alphaBiLevel"|"alphaInv"|"lum";value:number;contrast:number};
export type EffectStep = PixelEffect | {kind:"tree"|"sib"|"blend";children:EffectStep[];mode?:string};
/** Bounded graph expansion. Every branch keeps its own input; references never execute code. */
export function effectProgram(props:Element|undefined,warn:()=>void):EffectStep[]|undefined {
 const root=child(props,"effectDag");if(!root)return undefined;
 const named=new Map<string,Element>();let count=0;
 const index=(e:Element,depth:number)=>{if(++count>64||depth>8)throw new Error("security-limit");const name=e.getAttribute("name");if(name){if(named.has(name))throw new Error("invalid-file");named.set(name,e);}for(const c of kids(e))index(c,depth+1);};index(root,0);
 let operations=0;const active=new Set<Element>();let visits=0,unsupported=false;
 const visit=(e:Element,depth:number):EffectStep|undefined=>{
  let output:EffectStep|undefined;
  if(++visits>128||depth>16)throw new Error("security-limit");if(active.has(e))throw new Error("invalid-file");active.add(e);
  if(e.localName==="effect"){const target=named.get(e.getAttribute("ref")??"");if(!target)throw new Error("invalid-file");output=visit(target,depth+1);}
  else if(e.localName==="effectDag"||e.localName==="cont"||e.localName==="blend"){
   const kind=e.localName==="blend"?"blend":e.getAttribute("type")??"sib",mode=e.getAttribute("blend")??"over";
   if(!["tree","sib","blend"].includes(kind)||kind==="blend"&&!["over","mult","screen","darken","lighten"].includes(mode))unsupported=true;
   if(kind==="blend"&&(kids(e).length!==1||kids(e)[0]?.localName!=="cont"))unsupported=true;
   const children=kids(e).map(c=>visit(c,depth+1)).filter((c):c is EffectStep=>Boolean(c));output={kind:kind as "tree"|"sib"|"blend",children,mode};
  }else if(["grayscl","biLevel","alphaModFix","alphaRepl","alphaBiLevel","alphaInv","lum"].includes(e.localName)){
   const attr=e.localName==="alphaModFix"?"amt":e.localName==="alphaRepl"?"a":e.localName==="lum"?"bright":"thresh";
   const value=number(e,attr,e.localName==="alphaModFix"?100000:0)/100000,contrast=number(e,"contrast",0)/100000;
   if(value<(e.localName==="lum"?-1:0)||value>(e.localName==="alphaModFix"?10:1)||Math.abs(contrast)>1)throw new Error("security-limit");
   if(++operations>16)throw new Error("security-limit");output={kind:e.localName as PixelEffect["kind"],value,contrast};
  }else unsupported=true;
  active.delete(e);return output;
 };const result=visit(root,0);if(unsupported){warn();return undefined;}return result&&operations?[result]:undefined;
}
/** In-place bounded pixel operations; source order is significant. */
function applyLeaves(data:Uint8ClampedArray,program:PixelEffect[]):void {
 if(program.length>16||data.length>16000000||data.length%4)throw new Error("security-limit");
 for(const op of program)for(let i=0;i<data.length;i+=4){
  if(op.kind==="alphaModFix")data[i+3]=data[i+3]!*op.value;
  else if(op.kind==="alphaRepl")data[i+3]=255*op.value;
  else if(op.kind==="alphaInv")data[i+3]=255-data[i+3]!;
  else if(op.kind==="alphaBiLevel")data[i+3]=data[i+3]!/255>=op.value?255:0;
  else if(op.kind==="lum"){for(let c=0;c<3;c++)data[i+c]=((data[i+c]!/255-.5)*(1+op.contrast)+.5+op.value)*255;}
  else {const gray=.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!,value=op.kind==="biLevel"?(gray/255>=op.value?255:0):gray;data[i]=data[i+1]=data[i+2]=value;}
 }
}

/** One-pixel evaluation avoids allocating a full bitmap for each graph branch. */
export function applyPixelEffects(data:Uint8ClampedArray,program:EffectStep[]):void {
 if(data.length>16000000||data.length%4)throw new Error("security-limit");
 let visits=0,leaves=0;const validate=(step:EffectStep,depth:number)=>{if(++visits>128||depth>16)throw new Error("security-limit");if("children"in step)step.children.forEach(s=>validate(s,depth+1));else if(++leaves>16)throw new Error("security-limit");};program.forEach(s=>validate(s,0));
 const serial:PixelEffect[]=[];const flatten=(s:EffectStep):boolean=>{if(!("children"in s)){serial.push(s);return true;}return s.kind==="tree"&&s.children.every(flatten);};if(program.every(flatten)){applyLeaves(data,serial);return;}
 const buffers=Array.from({length:18},()=>({branch:new Uint8ClampedArray(4),sum:new Uint8ClampedArray(4),input:new Uint8ClampedArray(4)}));
 const over=(dst:Uint8ClampedArray,src:Uint8ClampedArray,mode:string)=>{const sa=src[3]!/255,da=dst[3]!/255,a=sa+da*(1-sa);for(let c=0;c<3;c++){const s=src[c]!/255,d=dst[c]!/255,b=mode==="mult"?s*d:mode==="screen"?s+d-s*d:mode==="darken"?Math.min(s,d):mode==="lighten"?Math.max(s,d):s;dst[c]=a?255*((1-sa)*da*d+(1-da)*sa*s+sa*da*b)/a:0;}dst[3]=255*a;};
 const run=(step:EffectStep,pixel:Uint8ClampedArray,depth:number)=>{if(!("children"in step)){applyLeaves(pixel,[step]);return;}if(step.kind==="tree"){for(const child of step.children)run(child,pixel,depth+1);return;}
  const {branch,sum,input}=buffers[depth]!;input.set(pixel);sum.fill(0);if(step.kind==="blend")sum.set(pixel);
  for(const child of step.children){branch.set(input);run(child,branch,depth+1);over(sum,branch,step.kind==="blend"?step.mode??"over":"over");}pixel.set(sum);
 };
 const pixel=new Uint8ClampedArray(4);for(let i=0;i<data.length;i+=4){pixel.set(data.subarray(i,i+4));for(const step of program)run(step,pixel,0);data.set(pixel,i);}
}
