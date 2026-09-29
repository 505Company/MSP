import type {ColorIR} from "./model";
export const PATTERNS=["horz","vert","cross","dnDiag","upDiag","diagCross","pct5","pct10","pct20","pct25","pct30","pct40","pct50","pct60","pct70","pct75","pct80","pct90","smCheck","lgCheck","dotGrid"] as const;
export interface PatternIR {preset:typeof PATTERNS[number];foreground:ColorIR;background:ColorIR}
export function patternPixels(p:PatternIR):Uint8Array {
  const data=new Uint8Array(8*8*4),bayer=[0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const v=p.preset,fg=v.startsWith("pct")?bayer[y*8+x]!<Number(v.slice(3))/100*64:v==="horz"?y%4===0:v==="vert"?x%4===0:v==="cross"?x%4===0||y%4===0:v==="dnDiag"?(x-y+8)%4===0:v==="upDiag"?(x+y)%4===0:v==="diagCross"?(x-y+8)%4===0||(x+y)%4===0:v==="smCheck"?(Math.floor(x/2)+Math.floor(y/2))%2===0:v==="lgCheck"?(Math.floor(x/4)+Math.floor(y/4))%2===0:x%4===0&&y%4===0;
    const c=fg?p.foreground:p.background;data.set([c.r,c.g,c.b,c.a].map(n=>Math.round(n*255)),(y*8+x)*4);
  }
  return data;
}
