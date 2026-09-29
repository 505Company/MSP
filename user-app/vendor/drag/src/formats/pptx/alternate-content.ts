const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/** Prefer the author's fallback representation; never render Choice and Fallback together. */
export function alternateChildren(root: Element | undefined, warn: (code:string)=>void, depth=0): Element[] {
  if(depth>16)throw new Error("security-limit");
  const result:Element[]=[];
  for(const node of Array.from(root?.children??[])){
    if(node.namespaceURI===MC&&node.localName==="AlternateContent"){
      const fallbacks=Array.from(node.children).filter(e=>e.namespaceURI===MC&&e.localName==="Fallback");
      if(fallbacks.length>1)throw new Error("invalid-file");
      warn(fallbacks.length?"pptx-alternate-content":"pptx-object");
      if(fallbacks[0])result.push(...alternateChildren(fallbacks[0],warn,depth+1));
    }else result.push(node);
  }
  return result;
}
