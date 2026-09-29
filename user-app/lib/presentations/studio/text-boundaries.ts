/** Shared input grammar for both the local interpreter and per-slide Qwen jobs.
 * Explicit headings/separators win over paragraph breaks. Without them one
 * blank-line-separated paragraph is one slide; ordinary newlines stay inside.
 * This module does not infer content, choose recipes or rewrite source words. */
export type SlideText = { chunks:string[][]; mode:'explicit'|'paragraphs'|'single' }
const separator=(line:string)=>/^\s*(?:---+|\*\*\*+)\s*$/.test(line)
function heading(line:string,numbered=true){
  const s=line.trim(),unwrapped=s.replace(/^\*\*(.*)\*\*$/,'$1').replace(/^__(.*)__$/,'$1')
  return /^#\s+/.test(s)
    ||/^(?:#{1,6}\s*)?(?:слайд|slide)\s+\d+\b/iu.test(unwrapped)
    ||numbered&&(/^\d+[.)]\s+(?:\*\*.+\*\*|__.+__)/u.test(s)
    ||s!==unwrapped&&/^\d+[.)]\s+\S/u.test(unwrapped))
}

export function splitSlideText(raw:string):SlideText{
  if(!raw.trim()||raw.length>100000)throw Error('Нужно непустое содержание до 100 000 символов.')
  // A lone CR and Unicode paragraph separators can arrive from pasted text.
  const lines=raw.replace(/\r\n?/g,'\n').replace(/\u2028/g,'\n').replace(/\u2029/g,'\n\n').split('\n')
  // Numbered bold headings are a fallback convention. A named slide, H1 or
  // separator makes numbered steps inside those slides ordinary content.
  const numbered=!lines.some(line=>separator(line)||heading(line,false))
  const explicit=lines.some(line=>separator(line)||heading(line,numbered)),chunks:string[][]=[]
  let current:string[]=[]
  const flush=()=>{if(current.some(line=>line.trim()))chunks.push(current);current=[]}
  for(const line of lines){
    if(explicit){
      if(separator(line)){flush();continue}
      if(heading(line,numbered)&&current.some(l=>l.trim()))flush()
      current.push(line)
    }else if(!line.trim())flush()
    else current.push(line)
  }
  flush()
  if(!chunks.length||chunks.length>100)throw Error('Поддерживается от 1 до 100 слайдов. Разделите большой материал.')
  return {chunks,mode:explicit?'explicit':chunks.length>1?'paragraphs':'single'}
}
