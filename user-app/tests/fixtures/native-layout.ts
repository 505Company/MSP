import type {SourceSnapshot,SourceElement} from '../../lib/digital-designer/source-types'
import type {EditableProposal} from '../../lib/design-system/editable-contract'
const color=(r:number,g:number,b:number)=>({type:'solid',color:{r,g,b,a:1}})
const shape=(id:string,kind:string,x:number,y:number,width:number,height:number,fill:ReturnType<typeof color>):SourceElement=>({id,slide:1,name:id,kind,properties:{bounds:{x,y,width,height},visible:true,opacity:1,rotation:0,zIndex:1,fill}} as SourceElement)
export const sourceText=(id:string,text:string,x:number,y:number,width:number,height:number,size:number,family='Arial',ink=color(0,0,0)):SourceElement=>({id,slide:1,name:id,kind:'text',properties:{bounds:{x,y,width,height},visible:true,opacity:1,rotation:0,zIndex:2,text,fontFamily:family,fontStyle:'Regular',fontSize:size,styleRuns:[{start:0,end:text.length,fontFamily:family,fontStyle:'Regular',fontSize:size}],colorRuns:[{start:0,end:text.length,fill:ink}],textBox:{align:'CENTER',vertical:'CENTER',wrap:true},paragraphs:[{start:0,end:text.length,fontSize:size,align:'CENTER',before:0,after:0,left:0,right:0,indent:0,lineHeight:{unit:'PERCENT',value:100}}]}})
export function nativeLayoutFixture(kind:'metric'|'radial'|'diagram'){
 let elements:SourceElement[],data:EditableProposal['data']
 if(kind==='metric'){
  const value=sourceText('value','43%',24,24,570,260,319,'Play',color(0,.467,1));value.properties.styleRuns=[{start:0,end:2,fontFamily:'Play',fontStyle:'Bold',fontSize:319},{start:2,end:3,fontFamily:'Play',fontStyle:'Bold',fontSize:184}]
  elements=[shape('frame','rectangle',0,0,640,460,color(1,1,1)),value,sourceText('caption','Описание показателя',24,340,570,80,32,'Play')];data={value:'43',unit:'%',items:[{text:'Описание показателя'}]}
 }else if(kind==='radial'){
  elements=[shape('outer','ellipse',150,0,500,500,color(.922,.953,.976)),shape('inner','ellipse',250,100,300,300,color(1,1,1)),sourceText('title','Тема',290,210,220,80,48,'Play',color(0,.467,1)),...[0,1,2,3].flatMap((i)=>[shape(`marker${i}`,'ellipse',i%2?544:244,i<2?164:324,12,12,color(1,1,1)),sourceText(`item${i}`,`Пояснение ${i+1}`,i%2?580:0,i<2?120:340,210,80,24)])];data={title:'Тема',items:[1,2,3,4].map(i=>({text:`Пояснение ${i}`}))}
 }else{elements=[shape('block','rectangle',0,0,200,100,color(0,.467,1)),sourceText('label','Текст',10,10,180,80,22)];data={}}
 const snapshot:SourceSnapshot={schemaVersion:1,sourceId:'a'.repeat(64),name:'Native source layout',slideCount:1,assets:[],colors:[],fonts:[{family:'Play',sizes:[48,184,319],occurrences:2},{family:'Arial',sizes:[22,24],occurrences:4}] as SourceSnapshot['fonts'],limitations:[],slides:[{id:'s01',number:1,width:1000,height:600,part:'ppt/slides/slide1.xml',text:'',warnings:[]}],elements}
 const proposal:EditableProposal={id:'layout',kind,name:'Образец',description:'Исходное оформление',tags:['Данные'],sourceIds:elements.map(e=>e.id),memberIds:[],style:{font:'Play',color:'#0077FF',metricSize:220},config:{},data,dataStatus:'readable'}
 return {snapshot,proposal}
}
