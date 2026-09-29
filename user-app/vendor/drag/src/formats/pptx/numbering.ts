/** Plain visible list markers; numbering is retained without claiming a native list model. */
export function numberedMarker(type: string, value: number): string | undefined {
  if (!Number.isInteger(value) || value < 1 || value > 32767) throw new Error("security-limit");
  const match = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth|Plain)$/.exec(type);
  if (!match || match[2] === "Plain" && match[1] !== "arabic") return undefined;
  let label = String(value);
  if (match[1]!.startsWith("alpha")) {
    label = ""; for (let n=value;n>0;n=Math.floor((n-1)/26)) label=String.fromCharCode(65+(n-1)%26)+label;
  } else if (match[1]!.startsWith("roman")) {
    if(value>3999)return undefined;
    label="";let n=value;
    for(const [amount,letters] of [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]] as const)while(n>=amount){label+=letters;n-=amount;}
  }
  if(match[1]!.endsWith("Lc"))label=label.toLowerCase();
  return match[2]==="Period"?`${label}. `:match[2]==="ParenR"?`${label}) `:match[2]==="ParenBoth"?`(${label}) `:`${label} `;
}
export function listCounter() {
  const levels = new Map<number,{type:string;value:number}>();
  return (level: number, bullet: Element | undefined): string | undefined => {
    for (const key of levels.keys()) if(key>level)levels.delete(key);
    if(bullet?.localName!=="buAutoNum"){levels.delete(level);return undefined;}
    const type=bullet.getAttribute("type")??"arabicPeriod", previous=levels.get(level);
    const value=bullet.hasAttribute("startAt")?Number(bullet.getAttribute("startAt")):previous?.type===type?previous.value+1:1;
    const label=numberedMarker(type,value);levels.set(level,{type,value});return label;
  };
}
