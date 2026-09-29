import {test} from 'node:test'
import assert from 'node:assert/strict'
import {designQuality} from '../lib/presentations/studio/design-quality'
import {fastOption,draftOptions} from '../lib/presentations/studio/options'
import {creativeRecipeChoices} from '../lib/presentations/studio/creative-choices'
import {compositionsFor} from '../lib/presentations/studio/compositions'
import {fieldsPreserved,repeatedTextPrimitive,factPrimitive} from '../lib/presentations/studio/field-bindings'
import {candidatesFor,type PrimitiveNode} from '../lib/presentations/studio/recipes'
import {componentFlexTask} from '../lib/presentations/studio/component-flex'
import {strictComponentFixture} from './fixtures/studio-components'
import type {ContentSlide,RenderReceipt,DesignOption} from '../lib/presentations/studio/contract'

const content:ContentSlide={id:'slide-1',title:'Большая идея',directions:[],blocks:[{id:'title',role:'title',kind:'text',source:'Большая идея',fields:{text:'Большая идея'}},{id:'body',role:'body',kind:'text',source:'Объяснение, которое должно быть хорошо видно на экране.',fields:{text:'Объяснение, которое должно быть хорошо видно на экране.'}}]}
const text=(titleSize:number,bodySize:number):RenderReceipt['text']=>content.blocks.map((b,i)=>({blockId:b.id,field:'text',value:b.source,size:i?bodySize:titleSize,x:80,y:i?600:80,width:1760,height:i?bodySize*1.25:titleSize*1.18,font:'Play',color:'#FFFFFF',weight:i?400:700}))
test('a readable source cover survives random variety; a poorly fitting cover never displaces readable text',()=>{
 const plain=candidatesFor(content)[0],cover={...plain,id:'source-cover',recipeId:'composition/library-cover',backgroundId:'source-artwork'}
 const option=(id:string,score:number)=>({id,label:id,signature:id,plan:{candidateId:id,components:{},primary:[],rationale:''},receipt:{slideId:content.id,candidateId:id,passed:true,quality:{score,reasons:[]},preview:'',html:'',blockIds:[],issues:[],warnings:[],elapsedMs:0,components:[],text:[]}} as DesignOption)
 const work={content,candidates:[plain,cover],bindings:{},options:[option(plain.id,100),option(cover.id,100)]}
 for(let i=0;i<20;i++)assert.equal(fastOption({...work,variation:{mode:'fast',seed:String(i),sourceKey:'same-brief'}}).id,cover.id)
 work.options[1].receipt!.quality!.score=72
 assert.equal(fastOption(work).id,plain.id)
})
test('a fitting tiny caption loses to a readable explanation despite history preference',()=>{
 const candidate=candidatesFor(content)[0],bad=designQuality(content,candidate,{text:text(192,24)}),good=designQuality(content,candidate,{text:text(128,56)})
 assert.ok(good.score-bad.score>=25)
 const option=(id:string,quality:typeof good)=>({id,label:id,signature:id,plan:{candidateId:id,components:{},primary:[],rationale:''},receipt:{slideId:'slide-1',candidateId:id,passed:true,quality,preview:'',html:'',blockIds:[],issues:[],warnings:[],elapsedMs:0,components:[],text:[]}} as DesignOption)
 const work={content,candidates:[candidate],bindings:{},history:['old','readable'],options:[option('new-but-tiny',bad),option('readable',good)]}
 assert.equal(fastOption(work).id,'readable')
})

test('a statistical title stays adjacent to its explanation, including a horizontal pair',()=>{
 const slide:ContentSlide={...content,title:'5,8 источника',blocks:[{...content.blocks[0],source:'5,8 источника',fields:{text:'5,8 источника'}},{...content.blocks[1],source:'в среднем изучают перед принятием решения',fields:{text:'в среднем изучают перед принятием решения'}}]}
 const candidate=candidatesFor(slide)[0]
 const fields:RenderReceipt['text']=text(112,56).map((t,i)=>({...t,value:slide.blocks[i].source,width:760,y:i?436:192,height:i?140:140}))
 const adjacent=designQuality(slide,candidate,{text:fields})
 const detached=designQuality(slide,candidate,{text:fields.map((t,i)=>i?{...t,y:820}:t)})
 const beside=designQuality(slide,candidate,{text:fields.map((t,i)=>i?{...t,x:920,y:192}:t)})
 assert.equal(adjacent.score-detached.score,24)
 assert.equal(beside.score,adjacent.score)
})
test('creative mode keeps the exact model proposal and also measures real recipes on identical content',()=>{
 const {packet,reply,library}=strictComponentFixture(),work=componentFlexTask(packet,library).validate(reply).work,next=creativeRecipeChoices(work,library)
 assert.deepEqual(next.content,work.content);assert.equal(next.strictComponents,undefined)
 assert.deepEqual(next.candidates[0].fixedComponents,work.plan!.components)
 assert.ok(next.candidates.length>1)
 const proposed=draftOptions(next,library).find(o=>o.plan.candidateId===work.plan!.candidateId)!
 assert.deepEqual(proposed.plan.components,work.plan!.components)
})
test('ordinal features get an ordered journey, including a concluding sentence',()=>{
 const blocks=Array.from({length:5},(_,i)=>({id:`step-${i+1}`,role:'body' as const,kind:'feature' as const,source:`0${i+1}\nДействие ${i+1}`,fields:{heading:`0${i+1}`,body:`Действие ${i+1}`}}))
 const slide={...content,blocks:[content.blocks[0],...blocks,{...content.blocks[1],id:'conclusion'}]}
 const candidates=candidatesFor(slide).filter(c=>c.recipeId==='composition/journey')
 assert.ok(candidates.length>=2)
 for(const c of candidates){const positions=blocks.map(b=>c.slots.find(s=>s.blocks.includes(b.id))!.rect)
   for(let i=1;i<positions.length;i++)assert.ok(positions[i].y>positions[i-1].y||positions[i].y===positions[i-1].y&&positions[i].x>positions[i-1].x)
 }
})
test('multiline facts render as exact non-overlapping fragments, with every number retained',()=>{
 const value='Цена — 82%\nМаршрут — 71%\nОтзывы — 58%\nСобытия — 46%'
 const block={...content.blocks[1],fields:{text:value},source:value},slide={...content,blocks:[content.blocks[0],block]}
 const c=compositionsFor(slide).find(c=>c.recipeId==='composition/fact-grid')!
 assert.equal(c.slots.find(s=>s.blocks.includes(block.id))!.presentation!.repeatColumns,2)
 const node=repeatedTextPrimitive(block,2)!,parts=node.children!.map(n=>n.children![0]).map(n=>({field:n.field!,sourceRange:n.sourceRange,value:value.slice(n.sourceRange!.start,n.sourceRange!.end)}))
 assert.equal(fieldsPreserved(block,parts),true)
 assert.deepEqual(parts.map(p=>p.value.trim()),value.split('\n'))
})

test('fact hierarchy preserves percentage signs, decimal values, dashes and original line separators',()=>{
 const value='Цена — 82%\nУдобство маршрута — 71,5%\nОтзывы — 58%\nСобытия — 46%\n'
 const block={...content.blocks[1],fields:{text:value},source:value}
 const leaves=(node:PrimitiveNode):PrimitiveNode[]=>node.field?[node]:(node.children??[]).flatMap(leaves)
 for(const layout of ['inline','stacked'] as const){
   const parts=leaves(factPrimitive(block,2,layout)!).map(n=>({field:n.field!,sourceRange:n.sourceRange,value:value.slice(n.sourceRange!.start,n.sourceRange!.end)}))
   assert.equal(fieldsPreserved(block,parts),true)
   assert.deepEqual(parts.filter((_,i)=>i%2).map(p=>p.value.trim()),['82%','71,5%','58%','46%'])
 }
})

test('two-state recipes keep the second label with its content, and separate the shared conclusion and footer',()=>{
 const values=['До изменения','Первое действие','Второе действие','Третье действие','Новый подход','Все этапы теперь доступны пользователю одновременно в одном интерфейсе.','Пользователь принимает решение быстрее, потому что видит всю картину.']
 const slide:ContentSlide={...content,blocks:values.map((value,i)=>({id:`b${i}`,kind:'text' as const,role:i?'body' as const:'title' as const,fields:{text:value},source:value,...[4,6].includes(i)?{emphasis:'secondary' as const}:{}}))}
 slide.blocks.push({...slide.blocks[0],id:'footer',role:'footer',source:'Источник исследования',fields:{text:'Источник исследования'}})
 const recipe=compositionsFor(slide).find(c=>c.id==='composition/comparison-sections')!
 assert.ok(recipe)
 assert.deepEqual(recipe.slots.flatMap(s=>s.blocks).sort(),slide.blocks.map(b=>b.id).sort())
 for(const [i,a] of recipe.slots.entries())for(const b of recipe.slots.slice(i+1))assert.ok(Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)<=Math.max(a.rect.x,b.rect.x)||Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)<=Math.max(a.rect.y,b.rect.y),'text areas do not overlap')
 const label=recipe.slots.find(s=>s.blocks.includes('b4'))!,after=recipe.slots.find(s=>s.blocks.includes('b5'))!
 assert.equal(label.rect.x,after.rect.x);assert.ok(after.rect.y>label.rect.y+label.rect.h)
})

test('a display recipe with four readable paragraphs is not confused with a tiny step list',()=>{
 const paragraphs=Array.from({length:4},(_,i)=>({...content.blocks[1],id:`p${i}`})),slide={...content,blocks:[content.blocks[0],...paragraphs]}
 const c=candidatesFor(slide).find(c=>c.recipeId==='6:185/title-support-balanced')!
 const fields=[text(144,56)[0],...paragraphs.map((b,i)=>({...text(144,56)[1],blockId:b.id,y:580+i*90,height:70}))]
 const result=designQuality(slide,c,{text:fields})
 assert.equal(result.score,100)
})

test('a numeric feature keeps its source fields and is never assigned as both prose and metric',()=>{
 const metric={id:'m1',kind:'metric' as const,role:'body' as const,fields:{value:'24%',caption:'Рост'},source:'24%\nРост'}
 const feature={id:'m2',kind:'feature' as const,role:'body' as const,fields:{heading:'3,7 поездки',body:'За год'},source:'3,7 поездки\nЗа год'}
 const slide={...content,blocks:[content.blocks[0],metric,feature,content.blocks[1]]}
 const choices=compositionsFor(slide)
 assert.ok(choices.some(c=>c.recipeId==='composition/metric-grid'))
 for(const candidate of choices)assert.deepEqual(candidate.slots.flatMap(s=>s.blocks).sort(),slide.blocks.map(b=>b.id).sort(),candidate.id)
})
