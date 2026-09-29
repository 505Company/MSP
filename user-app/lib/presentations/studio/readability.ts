import type {ContentBlock} from './contract'

/** A model cannot make a paragraph readable merely by calling it a footer.
 * Reserve the smaller footer size for short notes, not long body paragraphs. */
export function minimumReadableSize(block:ContentBlock,field:string){
  if(block.role==='title')return 40
  if(block.role==='footer')return (block.fields[field]?.length??0)>160?24:20
  return field==='caption'||field==='author'?20:field==='value'?48:24
}
