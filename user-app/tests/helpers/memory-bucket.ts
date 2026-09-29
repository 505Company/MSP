export function memoryBucket(){
  const data=new Map<string,{value:string;etag:string;bytes?:Uint8Array}>();let generation=0
  const bucket={
    async list(options?:R2ListOptions){
      const entries=[...data.keys()].filter(key=>key.startsWith(options?.prefix??'')).sort(),start=Number(options?.cursor??0),limit=options?.limit??1000
      return {objects:entries.slice(start,start+limit).map(key=>({key})),truncated:start+limit<entries.length,...(start+limit<entries.length?{cursor:String(start+limit)}:{})}
    },
    async delete(key:string){data.delete(key)},
    async head(key:string){const item=data.get(key);return item?{etag:item.etag,size:new TextEncoder().encode(item.value).length}:null},
    async get(key:string){const item=data.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.value),text:async()=>item.value,arrayBuffer:async()=>item.bytes?.buffer??new TextEncoder().encode(item.value).buffer}:null},
    async put(key:string,value:string|Uint8Array,options?:R2PutOptions){
      const existing=data.get(key),condition=options?.onlyIf as R2Conditional|undefined
      if(condition?.etagDoesNotMatch==='*'&&existing||condition?.etagMatches&&condition.etagMatches!==existing?.etag)return null
      const etag=String(++generation);data.set(key,{value:typeof value==='string'?value:Buffer.from(value).toString('base64'),etag,...(typeof value==='string'?{}:{bytes:Uint8Array.from(value)})});return {etag}
    }
  } as unknown as R2Bucket
  return {bucket,data}
}
