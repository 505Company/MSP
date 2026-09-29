"use client"
import {useEffect} from 'react'
import {executeDesignSystem} from './automatic-design-system'
import type {DesignProgressUpdate} from '@/lib/uploads/design-progress'
import {ProcessingRecoveryError} from '@/lib/uploads/automatic-recovery'
import {isUploadCancelled} from '@/lib/uploads/cancellation'
import {executeLayoutGeneration,LayoutGenerationError} from '@/browser/layout-generation'
import {executeRecipeDiscovery,RecipeDiscoveryError} from '@/browser/recipe-discovery'
import {executeComponentPreparation} from '@/browser/component-lab/preparation'
import {executeStudioGeneration} from '@/browser/studio-runner'
declare global {interface Window {
 __mspRunBackground?:(id:string)=>Promise<{ok:boolean;error?:string;retryable?:boolean;cancelled?:boolean}>
 __mspRunLayout?:(id:string,inputId:string,retry?:boolean)=>Promise<{ok:boolean;error?:string;retryable?:boolean}>
 __mspRunRecipes?:(uploadId:string,jobId:string,token:string)=>Promise<{ok:boolean;error?:string;errorCode?:string;retryable?:boolean}>
 __mspRunComponents?:(uploadId:string,jobId:string,token:string)=>Promise<{ok:boolean;error?:string;retryable?:boolean}>
 __mspRunStudio?:(projectId:string,revision:string,token:string)=>Promise<{ok:boolean;error?:string;retryable?:boolean}>
 __mspAbortBackground?:()=>void
 __mspWorkerProgress?:(progress:DesignProgressUpdate)=>Promise<void>
}}
/** Loaded by the separately supervised renderer, never by a user's editor. */
export function BackgroundProcessingRunner(){
 useEffect(()=>{
  let active:AbortController|null=null
  window.__mspRunBackground=async id=>{
   if(active)return {ok:false,error:'Обработчик занят',retryable:true}
   active=new AbortController()
   try{await executeDesignSystem(id,()=>{},active.signal,true,p=>{void window.__mspWorkerProgress?.(p)});return {ok:true}}
   catch(error){return {ok:false,error:error instanceof Error?error.message:'Обработка прервалась',cancelled:isUploadCancelled(error),retryable:!(error instanceof ProcessingRecoveryError)||error.retryable}}
   finally{active=null}
  }
  window.__mspRunLayout=async(id,inputId,retry)=>{
   if(active)return {ok:false,error:'Обработчик занят',retryable:true}
   active=new AbortController()
   try{
    await executeLayoutGeneration(id,{inputId,retry,signal:active.signal,onUpdate:(view,detail)=>{void window.__mspWorkerProgress?.({step:'analysis',detail,completed:view.slides.filter(s=>s.phase==='ready').length,total:view.slides.length})}})
    return {ok:true}
   }catch(error){return {ok:false,error:error instanceof Error?error.message:'Генерация прервалась',retryable:error instanceof LayoutGenerationError?error.retryable:true}}
   finally{active=null}
  }
  window.__mspRunRecipes=async(uploadId,jobId,token)=>{
   if(active)return {ok:false,error:'Обработчик занят',retryable:true}
   active=new AbortController()
   try{await executeRecipeDiscovery(uploadId,jobId,token,active.signal);return {ok:true}}
   catch(error){return {ok:false,error:error instanceof Error?error.message:'Пополнение рецептов прервалось',errorCode:error instanceof RecipeDiscoveryError?error.code:undefined,retryable:error instanceof RecipeDiscoveryError?error.retryable:true}}
   finally{active=null}
  }
  window.__mspRunComponents=async(uploadId,jobId,token)=>{
   if(active)return {ok:false,error:'Обработчик занят',retryable:true}
   active=new AbortController()
   try{await executeComponentPreparation(uploadId,jobId,token,active.signal);return {ok:true}}
   catch(error){return {ok:false,error:error instanceof Error?error.message:'Подготовка компонента прервалась.',retryable:true}}
   finally{active=null}
  }
  window.__mspRunStudio=async(projectId,revision,token)=>{
   if(active)return {ok:false,error:'Обработчик занят',retryable:true}
   active=new AbortController()
   try{await executeStudioGeneration(projectId,revision,token,active.signal,(completed,total)=>{void window.__mspWorkerProgress?.({step:'analysis',detail:`Готово ${completed} из ${total} слайдов`,completed,total})});return {ok:true}}
   catch(error){return {ok:false,error:error instanceof Error?error.message:'Генерация прервалась.',retryable:true}}
   finally{active=null}
  }
  window.__mspAbortBackground=()=>active?.abort(new Error('Утрачено владение фоновой задачей'))
  return ()=>{active?.abort();delete window.__mspRunBackground;delete window.__mspRunLayout;delete window.__mspRunRecipes;delete window.__mspRunComponents;delete window.__mspRunStudio;delete window.__mspAbortBackground}
 },[])
 return <p>Фоновый обработчик презентаций</p>
}
