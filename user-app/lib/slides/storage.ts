import { z } from 'zod'
import { getCatalogComponent } from '../design-system/catalog'
import { LibraryConflict } from '../design-system/storage'
import { composeSlide, slideSchema, type SavedSlide } from './document'
import type { CatalogComponent } from '../design-system/catalog-types'

const prefix=(id:string,scope:'upload'|'project'='upload')=>`${scope==='project'?'project-slides':'web-slides'}/${id}`
export async function loadSlide(bucket:R2Bucket,uploadId:string,scope:'upload'|'project'='upload'):Promise<SavedSlide|null>{
  const file=await bucket.get(`${prefix(uploadId,scope)}/current.json`)
  if(!file)return null
  const pointer=await file.json<{id:string}>(),revision=await bucket.get(`${prefix(uploadId,scope)}/${pointer.id}.json`)
  if(!revision)throw new Error('Слайд сохранён не полностью')
  return revision.json<SavedSlide>()
}
const inputSchema=z.object({baseRevision:z.string().uuid().nullable(),document:slideSchema}).strict()
export async function saveSlide(bucket:R2Bucket,uploadId:string,raw:unknown,projectId?:string):Promise<SavedSlide>{
  const storagePrefix=projectId?prefix(projectId,'project'):prefix(uploadId)
  const input=inputSchema.parse(raw),key=`${storagePrefix}/current.json`,pointer=await bucket.get(key),previous=pointer?await pointer.json<{id:string}>():null
  if((previous?.id??null)!==input.baseRevision)throw new LibraryConflict('Слайд изменён в другой вкладке. Ваши правки остались в редакторе; откройте сохранённую версию.')
  const definitions:Record<string,CatalogComponent>={}
  const savedPrevious=previous?await bucket.get(`${storagePrefix}/${previous.id}.json`):null
  const previousDefinitions=savedPrevious?(await savedPrevious.json<SavedSlide>()).definitions:{}
  for(const item of input.document.items){
    if(definitions[item.definitionId])continue
    const pinned=previousDefinitions[item.definitionId]
    const definition=pinned?.component.id===item.componentId?pinned:await getCatalogComponent(bucket,uploadId,item.componentId)
    if(definition.definitionId!==item.definitionId)throw new Error('Определение компонента изменилось')
    definitions[item.definitionId]=definition
  }
  composeSlide(input.document,definitions)
  const saved:SavedSlide={id:crypto.randomUUID(),parentId:previous?.id??null,createdAt:new Date().toISOString(),document:input.document,definitions}
  await bucket.put(`${storagePrefix}/${saved.id}.json`,JSON.stringify(saved),{httpMetadata:{contentType:'application/json'}})
  const committed=await bucket.put(key,JSON.stringify({id:saved.id}),{httpMetadata:{contentType:'application/json'},onlyIf:pointer?{etagMatches:pointer.etag}:{etagDoesNotMatch:'*'}})
  if(!committed)throw new LibraryConflict('Другая вкладка уже сохранила слайд. Откройте сохранённую версию.')
  return saved
}
