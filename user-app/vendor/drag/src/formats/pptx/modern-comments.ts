import type { ServiceNoteIR } from "../../core/model";
import { PptxCatalogReader } from "./catalog";
import { child, kids } from "./appearance";
export const MODERN_COMMENTS = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
export const MODERN_REL = "http://schemas.microsoft.com/office/2018/10/relationships/";

/** Plain local discussion transcript, without anchors, identities or interactive mentions. */
export function modernComments(reader: PptxCatalogReader, part: string, add: (note: ServiceNoteIR) => void, warn: (code: string) => void): void {
  const ns=MODERN_COMMENTS, root=reader.xml(part,ns,"cmLst");
  const authorRels=[...reader.relationships(reader.presentationPart()).values()].filter(r=>r.type===`${MODERN_REL}authors`);
  if(authorRels.length>1)throw new Error("invalid-file");
  const authors=new Map<string,string>();
  const key=(node:Element,attribute:string)=>{
    const value=node.getAttribute(attribute);
    if(!value || value.length>256)throw new Error("invalid-file");
    return value.toLowerCase();
  };
  if(authorRels[0]){
    const list=kids(reader.xml(authorRels[0].target,ns,"authorLst"),ns);
    if(list.length>2048)throw new Error("security-limit");
    for(const author of list){
      if(author.localName!=="author"){warn("pptx-comments-unsupported");continue;}
      const id=key(author,"id");if(authors.has(id))throw new Error("invalid-file");
      authors.set(id,(author.getAttribute("name")??"").slice(0,450));
    }
  }
  const ids=new Set<string>();let count=0,total=0;
  const entry=(node:Element):{author:string;status:string;body:string}=>{
    if(++count>128)throw new Error("security-limit");
    const id=key(node,"id");if(ids.has(id))throw new Error("invalid-file");ids.add(id);
    const author=authors.get(key(node,"authorId"));
    if(!author)warn("pptx-comments-unsupported");
    const rawStatus=node.getAttribute("status")??"active";
    const status=["active","resolved","closed"].includes(rawStatus)?rawStatus:"unknown";
    if(status==="unknown")warn("pptx-comments-unsupported");
    const body=kids(child(node,"txBody",ns)).filter(p=>p.localName==="p").map(p=>kids(p).filter(r=>["r","fld","br"].includes(r.localName)).map(r=>r.localName==="br"?"\n":child(r,"t")?.textContent??"").join("")).join("\n");
    total+=body.length;if(total>100000)throw new Error("security-limit");
    if(child(node,"extLst",ns) || node.hasAttribute("assignedTo") || node.hasAttribute("dueDate"))warn("pptx-comments-unsupported");
    const created=node.getAttribute("created")??"";
    const date=/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?$/.test(created)&&created.length<=40?created:"";
    if(created&&!date)warn("pptx-comments-unsupported");
    return {author:author||"Unknown author",status,body:`${date?`${date}\n`:""}${body || "[No text]"}`};
  };
  let index=0;
  for(const comment of kids(root,ns)){
    if(comment.localName!=="cm"){warn("pptx-comments-unsupported");continue;}
    const main=entry(comment),sourceTitle=comment.getAttribute("title")??"";
    if(sourceTitle.length>1000)throw new Error("security-limit");
    const text=[sourceTitle,main.body].filter(Boolean);
    for(const reply of kids(child(comment,"replyLst",ns),ns)){
      if(reply.localName!=="reply"){warn("pptx-comments-unsupported");continue;}
      const item=entry(reply);text.push(`Reply — ${item.author} (${item.status})\n${item.body}`);
    }
    add({title:`Comment ${++index} — ${main.author} (${main.status})`,text:text.join("\n\n")});
  }
  if(index)warn("pptx-comments");
}
