import type { Candidate, SlideWork } from '../lib/presentations/studio/contract'

/** User-authorized presentation metadata is separate from literal slide
 * content. Use free margin bands, never cover a recipe field or its data. */
export function addStudioChrome(root:HTMLElement,work:SlideWork,candidate:Candidate,ink:string){
  if(!work.chrome||candidate.backgroundId)return
  const top=Math.min(...candidate.slots.map(s=>s.rect.y)),bottom=Math.max(...candidate.slots.map(s=>s.rect.y+s.rect.h))
  const add=(kind:string,text:string,y:number,height:number,align:string)=>{
    const label=document.createElement('div');label.dataset.studioChrome=kind;label.textContent=text
    Object.assign(label.style,{position:'absolute',left:'48px',top:`${y}px`,width:'1824px',height:`${height}px`,fontSize:'24px',lineHeight:'1.15',color:ink,whiteSpace:'nowrap',textAlign:align})
    root.appendChild(label)
    for(let size=24;size>=16;size-=2){label.style.fontSize=`${size}px`;if(label.scrollWidth<=1824&&label.scrollHeight<=height)break}
  }
  if(top>=40)add('title',work.chrome.title,Math.max(8,Math.min(44,top-36)),28,'left')
  const pageY=Math.min(1048,Math.max(1020,bottom+8))
  const origin=root.getBoundingClientRect(),page={left:origin.left+1800,right:origin.left+1872,top:origin.top+pageY,bottom:origin.top+pageY+28}
  const intersects=(r:DOMRect)=>r.width>0&&r.height>0&&r.left<page.right&&r.right>page.left&&r.top<page.bottom&&r.bottom>page.top
  // A full-width footer slot may leave its right end empty. Check real glyphs
  // there instead of treating the whole allocation as occupied.
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  let occupied=false
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(!node.textContent?.trim()||node.parentElement?.closest('style,script'))continue
    const range=document.createRange();range.selectNodeContents(node)
    if([...range.getClientRects()].some(intersects)){occupied=true;break}
  }
  occupied ||= [...root.querySelectorAll('img,canvas,svg')].some(el=>intersects(el.getBoundingClientRect()))
  if(!occupied)add('page',String(work.chrome.number).padStart(2,'0'),pageY,28,'right')
}
