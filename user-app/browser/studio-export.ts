import {portableStudioAssets} from './studio-background'
import JSZip from 'jszip'
import type { StudioRun } from '../lib/presentations/studio/contract'
import { editableHtmlDocument } from '../lib/design-system/editable-html'
import { exportEditableTemplatePptx, supportsNativePptx } from '../lib/design-system/editable-pptx'

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export async function downloadStudioDeck(run:StudioRun){
  if(run.status!=='complete'||run.slides.some(s=>!run.results[s.content.id]?.passed))throw Error('Сначала завершите проверку всех слайдов.')
  const zip=new JSZip(),pages:string[]=[]
  for(const [i,slide] of run.slides.entries()){
    const result=run.results[slide.content.id]
    zip.file(`previews/${i+1}.png`,result.preview.split(',')[1],{base64:true})
    pages.push(`<article aria-label="${escape(slide.content.title)}">${await portableStudioAssets(result.html,run.library.uploadId)}</article>`)
    for(const block of slide.content.blocks){
      if(!block.data)continue
      const name=`data/${i+1}-${block.data.template.kind}`
      zip.file(name+'.json',JSON.stringify(block.data.values,null,2))
      zip.file(name+'.html',editableHtmlDocument(block.data.template,block.data.values))
      if(supportsNativePptx(block.data.template))zip.file(name+'.pptx',await exportEditableTemplatePptx(block.data.template,block.data.values))
    }
  }
  zip.file('presentation.html',`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Презентация MSP</title><style>body{margin:0;background:#ddd}article{width:1920px;height:1080px;margin:40px auto;overflow:hidden;break-after:page}nav{font:24px Arial;padding:24px;text-align:center}@media print{@page{size:1920px 1080px;margin:0}nav{display:none}article{margin:0}}</style><nav>Текст можно редактировать прямо на слайдах. Для печати или PDF используйте печать браузера.</nav>${pages.join('')}<script>document.querySelectorAll('[data-field],[data-component-field]').forEach(n=>{n.contentEditable='true'});</script></html>`)
  zip.file('source.json',JSON.stringify({version:run.version,mode:run.mode,designSystem:{id:run.library.id,name:run.library.name},slides:run.slides.map(s=>({content:s.content,plan:s.plan})),results:Object.values(run.results).map(({preview,html,...r})=>{void preview;void html;return r})},null,2))
  zip.file('README.txt','presentation.html — презентация с текстом и векторной графикой. Печать браузера сохраняет PDF.\npreviews — проверенные PNG слайдов.\ndata — таблицы и графики: исходные данные, редактор HTML и нативный PPTX с таблицей или диаграммой и книгой данных, когда этот тип поддерживает экспорт.\nsource.json — содержание, выбранные рецепты и диагностика.\nПосле изменения текста в HTML проверьте вместимость: локальный файл не запускает генератор MSP.\n')
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/zip'}))
  const a=document.createElement('a');a.href=url;a.download='MSP-presentation.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)
}
