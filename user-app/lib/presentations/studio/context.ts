import {artDirectedCandidates} from './art-direction'
import { catalogLibrary, contentHash } from '../../design-system/catalog'
import { readEditableCatalog } from '../../design-system/editable-analysis'
import { readBackgroundCatalog } from '../../design-system/background-storage'
import { projectPreparedBoxes, pinPreparedContext } from '../prepared-component-storage'
import { getProject } from '../../workspace/storage'
import { dataMaterial } from '../data-material'
import { assembleProjectData } from '../data-assembly'
import {fastContent} from './fast-content'
import {libraryCoverCandidates} from './visual-design'
import { candidatesFor } from './recipes'
import { componentBindings } from './bindings'
import {readStudioHistory} from './history'
import type {GenerationVariation} from './variation'
import {compactPackets} from './compact-content'
import {incomingCapacityMessage,INCOMING_BINDING_POLICY,type RecipeScope} from './recipe-packs'
import { STUDIO_VERSION, type StudioRun, type StudioLibrary, type ContentSlide, type SlideWork } from './contract'

export async function studioSlides(bucket:R2Bucket,projectId:string,library:StudioLibrary,content:ContentSlide[],recipeScope:RecipeScope='all',variation?:GenerationVariation,presentationTitle?:string):Promise<SlideWork[]>{
  const history=await readStudioHistory(bucket,projectId),libraryKey=await contentHash(library)
  const slides=await Promise.all(content.map(async s=>{
    const contentKey=await contentHash({version:STUDIO_VERSION,bindingPolicy:INCOMING_BINDING_POLICY,content:s,libraryKey,recipeScope}),candidates=recipeScope==='all'?artDirectedCandidates(s,[...libraryCoverCandidates(s,library),...candidatesFor(s,recipeScope)],library):candidatesFor(s,recipeScope)
    const diversityKey=variation?await contentHash([library.uploadId,variation.sourceKey,s.id]):undefined
    const previous=history.entries.filter(e=>e.contentKey===contentKey||diversityKey&&e.diversityKey===diversityKey)
    return {content:s,candidates,chrome:{title:presentationTitle??content[0].title,number:Number(s.id.match(/\d+/)?.[0]??1)},...!candidates.length&&recipeScope==='new'?{error:incomingCapacityMessage(s)}:{},bindings:Object.fromEntries(s.blocks.map(b=>[b.id,componentBindings(b,library)])),contentKey,diversityKey,variation,previousDesigns:previous.flatMap(e=>e.design?[e.design]:[]).slice(-6),history:previous.map(e=>e.signature)}
  }))
  if(recipeScope!=='new'&&slides.some(s=>!s.candidates.length))throw Error('Для части содержания нет совместимого рецепта. Добавьте заголовки слайдов или разделители --- .')
  return slides
}

export async function createStudioRun(bucket:R2Bucket,projectId:string,revision:string):Promise<StudioRun> {
  const project=await getProject(bucket,projectId)
  if(!project||project.archivedAt||project.revision!==revision)throw Error('Проект изменился. Обновите страницу.')
  const catalog=await catalogLibrary(bucket,project.uploadId)
  if(!catalog?.library.tokens.fonts.length)throw Error('Сначала завершите создание выбранной дизайн-системы.')
  const [editable,prepared,backgrounds]=await Promise.all([readEditableCatalog(bucket,project.uploadId),projectPreparedBoxes(bucket,project,{adoptCurrent:true}),readBackgroundCatalog(bucket,project.uploadId)])
  const passed=new Set(editable?.qualification?.checks.filter(c=>c.passed).map(c=>c.id)??[])
  const library:StudioLibrary={id:catalog.catalogId,uploadId:project.uploadId,name:project.styleName,tokens:catalog.library.tokens,
    rules:catalog.semantic?.rules.map(r=>r.interpretation)??[],prepared,editable:editable?.families.flatMap(f=>f.variants.filter(t=>passed.has(t.id)))??[],backgrounds:backgrounds??undefined}
  const mode=project.generationMode??'fast'
  const recipeScope:RecipeScope=mode==='smart'&&project.compositionMode==='components'?'all':project.recipeScope??'all'
  if(mode==='smart'&&project.compositionMode==='components'&&dataMaterial(project.text))throw Error('Эксперимент компонентов принимает текстовый бриф, в том числе с Markdown-таблицами. Отдельный файл структурированных данных пока доступен в режиме рецептов.')
  let content:ContentSlide[]=[],semantic:StudioRun['semantic']
  if(dataMaterial(project.text)){
    const data=await assembleProjectData(bucket,projectId)
    content=data.slides.map((s):ContentSlide=>({id:s.id,title:s.title,directions:[],blocks:[
      {id:'b1',role:'title',kind:'text',fields:{text:s.title},source:s.title},
      {id:'b2',role:'body',kind:'visual',fields:{},source:JSON.stringify(s.data),data:{template:s.template,values:s.data}},
    ]}))
  }else if(mode==='smart')semantic={source:project.text,status:'pending',strategy:project.compositionMode??'recipes',...project.modelRoute==='akashml-fp8'?{experimentalRoute:'akashml-fp8' as const}:{},units:compactPackets(project.text).map(packet=>({id:packet.id,packet,status:'pending',attempts:0}))}
  else content=fastContent(project.text,library)
  const variation:GenerationVariation={seed:revision,mode:mode==='fast'?'fast':project.compositionMode==='components'?'creative':'balanced',sourceKey:await contentHash(project.text.replace(/\s+/g,' ').trim())}
  const presentationTitle=project.name&&!/^(Слайд\s*\d+|Презентация)$/iu.test(project.name.trim())?project.name:content[0]?.title??semantic?.units?.[0]?.packet.atoms[0]?.text??'Презентация'
  const slides=await studioSlides(bucket,projectId,library,content,recipeScope,variation,presentationTitle)
  const id=await contentHash({version:STUDIO_VERSION,revision,mode,library,slides,semantic,recipeScope})
  await pinPreparedContext(bucket,{projectId,sourceRevision:revision,uploadId:project.uploadId,inputs:[{preparedComponents:prepared}] as Parameters<typeof pinPreparedContext>[1]['inputs']})
  return {version:STUDIO_VERSION,id,projectId,revision,mode,recipeScope,variation,presentationTitle,library,slides,...semantic?{semantic}:{},createdAt:new Date().toISOString(),status:'preparing',results:{},modelRequests:0,modelRunIds:[]}
}
