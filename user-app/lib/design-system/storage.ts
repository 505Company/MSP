import type { ComponentLibrary, LibraryRevision, SavedLibrary } from './types'

export class LibraryConflict extends Error {}
type Pointer={definitionId:string;revisionId:string}
const prefix=(uploadId:string)=>`component-libraries/${uploadId}`
const jsonMetadata={httpMetadata:{contentType:'application/json'}}
async function contentHash(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')}

export async function loadLibrary(bucket:R2Bucket,uploadId:string):Promise<SavedLibrary|null>{
  const p=await bucket.get(`${prefix(uploadId)}/current.json`)
  if(!p)return null
  const pointer=await p.json<Pointer>()
  const [definition,revision]=await Promise.all([bucket.get(`${prefix(uploadId)}/definitions/${pointer.definitionId}.json`),bucket.get(`${prefix(uploadId)}/revisions/${pointer.revisionId}.json`)])
  if(!definition||!revision)throw new Error('Библиотека сохранена не полностью')
  return {definitionId:pointer.definitionId,library:await definition.json<ComponentLibrary>(),revision:await revision.json<LibraryRevision>()}
}

export async function initializeLibrary(bucket:R2Bucket,uploadId:string,library:ComponentLibrary):Promise<SavedLibrary>{
  const existing=await loadLibrary(bucket,uploadId)
  if(existing)return existing
  const definitionId=await contentHash(library)
  const revision:LibraryRevision={schemaVersion:1,id:crypto.randomUUID(),parentId:null,definitionId,createdAt:new Date().toISOString(),decisions:{}}
  await bucket.put(`${prefix(uploadId)}/definitions/${definitionId}.json`,JSON.stringify(library),{...jsonMetadata,onlyIf:{etagDoesNotMatch:'*'}})
  await bucket.put(`${prefix(uploadId)}/revisions/${revision.id}.json`,JSON.stringify(revision),jsonMetadata)
  const saved=await bucket.put(`${prefix(uploadId)}/current.json`,JSON.stringify({definitionId,revisionId:revision.id}),{...jsonMetadata,onlyIf:{etagDoesNotMatch:'*'}})
  if(!saved){const winner=await loadLibrary(bucket,uploadId);if(!winner)throw new LibraryConflict('Повторите открытие библиотеки');return winner}
  return {definitionId,library,revision}
}
