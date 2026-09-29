import {chromium} from '@playwright/test'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
const run=JSON.parse(await readFile(process.argv[2],'utf8')),id=process.argv[3]??'slide-1',out=process.argv[4]
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto('http://127.0.0.1:5184/processing-worker')
  const receipt=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';return (await import(path) as typeof import('../browser/studio-generation')).renderStudioSlide(library,work)},{library:run.library,work:run.slides.find((s:{content:{id:string}})=>s.content.id===id)})
  await writeFile(out+'/receipt.json',JSON.stringify(receipt));await writeFile(out+'/actual.png',Buffer.from(receipt.preview.split(',')[1],'base64'))
  await page.setContent('<style>body{margin:0}</style>'+receipt.html);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:out+'/dom.png'})
  const result=await page.evaluate(async()=>{const path='/node_modules/html-to-image/es/index.js',{toPng,toSvg}=await import(path);const root=document.querySelector<HTMLElement>('[data-studio-slide]')!;const options={pixelRatio:2/3,fontEmbedCSS:document.querySelectorAll('style')[1].textContent};return {png:await toPng(root,options),svg:await toSvg(root,options)}})
  await writeFile(out+'/standalone.png',Buffer.from(result.png.split(',')[1],'base64'));await writeFile(out+'/clone.svg',decodeURIComponent(result.svg.split(',').slice(1).join(',')))
  const variants=await page.evaluate(async html=>{
    const path='/node_modules/html-to-image/es/index.js',{toPng}=await import(path),results=[]
    for(const variant of ['unchanged','position','no-empty-svg','no-svg','clip','isolate','background-color']){
      document.body.innerHTML=html;const root=document.querySelector<HTMLElement>('[data-studio-slide]')!
      if(variant==='position')root.querySelectorAll<HTMLElement>('section').forEach(e=>e.style.position='relative')
      if(variant==='no-empty-svg')root.querySelectorAll('[data-native-layout]').forEach(e=>e.firstElementChild?.remove())
      if(variant==='no-svg')root.querySelectorAll('svg').forEach(e=>e.remove())
      if(variant==='clip')root.querySelectorAll<HTMLElement>('section').forEach(e=>e.style.overflow='hidden')
      if(variant==='isolate')root.style.isolation='isolate'
      if(variant==='background-color')root.querySelectorAll<HTMLElement>('section').forEach(e=>{const c=getComputedStyle(e).backgroundColor;e.style.background='none';e.style.backgroundColor=c})
      await document.fonts.ready
      const png=await toPng(root,{pixelRatio:2/3,fontEmbedCSS:[...document.querySelectorAll('style')].map(e=>e.textContent).join('\n')})
      const i=new Image();i.src=png;await i.decode();const c=document.createElement('canvas').getContext('2d')!;c.canvas.width=i.width;c.canvas.height=i.height;c.drawImage(i,0,0)
      results.push({variant,png,pixels:[[8,80],[80,8]].map(([x,y])=>[...c.getImageData(x,y,1,1).data])})
    }return results
  },receipt.html)
  for(const {variant,png,pixels}of variants){await writeFile(`${out}/${variant}.png`,Buffer.from(png.split(',')[1],'base64'));console.log({variant,pixels})}
  console.log({passed:receipt.passed,issues:receipt.issues,out})
}finally{await browser.close()}
