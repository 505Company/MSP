import type {ContentBlock,ContentSlide} from '../../lib/presentations/studio/contract'

export const textBlock=(id:string,text:string,role:ContentBlock['role']='body'):ContentBlock=>({id,role,kind:'text',fields:{text},source:text})
export const metricBlock=(id:string,value:string,caption:string):ContentBlock=>({id,role:'body',kind:'metric',fields:{value,caption},source:value+'\n'+caption,emphasis:'secondary'})
export function stage7Table():ContentBlock{
  const values={columns:['Сценарий','Доля','Поездок'],rows:[['Командировки','31%','7,2×'],['Пары','24%','4,1×'],['Семьи','19%','3,4×'],['Solo','14%','5,6×'],['Другие','12%','2,8×']]}
  return {id:'data',kind:'visual',role:'body',fields:{},source:JSON.stringify(values),data:{template:{id:'table',kind:'table',name:'Таблица',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:1200,height:600,style:{font:'Play',fontSize:32,color:'#162D40',headerFill:'#00805E',headerColor:'#FFFFFF'},config:{},data:values,graphicHtml:{},dataStatus:'native'},values}}
}
export function stage7Compound():ContentSlide{
  return {id:'compound',title:'Два подхода',directions:[],blocks:[textBlock('title','Два подхода','title'),...[1,2].map(i=>({id:`approach-${i}`,kind:'feature' as const,role:'body' as const,fields:{heading:`Подход ${i}`,body:'Пояснение с датой 2026.\n- Рост 12%\n- Выручка 48 млн\n- Охват 900 человек'},source:`Подход ${i}\nПояснение с датой 2026.\n- Рост 12%\n- Выручка 48 млн\n- Охват 900 человек`}))]}
}
