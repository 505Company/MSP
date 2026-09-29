import {labTemplate} from '../../component-lab/fixtures'
import {studioFixture} from './studio'
import {compactPackets} from '../../lib/presentations/studio/compact-content'

export function strictComponentFixture(){
  const run=studioFixture('smart'),library=run.library
  library.editable=['title','text'].map((field,i)=>{
    const t=labTemplate('text'),slot=t.sourceLayout!.text[i]
    t.id=`native-${field}`;t.kind='text';t.sourceLayout={graphic:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 658 209" width="100%" height="100%" overflow="visible"><g transform="translate(0 0)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 658 209" width="658" height="209" overflow="visible" aria-hidden="true"></svg></g></svg>',graphicIds:[],text:[slot]};t.data={[field]:slot.element.text}
    t.style={font:'Play',background:i?'#FFFFFF':'#265fc1',color:i?'#162D40':'#FFFFFF',padding:0}
    if(i)slot.element.colorRuns=[{start:0,end:slot.element.text.length,fill:{type:'solid',color:{r:.08,g:.18,b:.25,a:1}}}]
    return t
  })
  const packet=compactPackets('# Путешествие начинается с выбора\nМаршруты, транспорт и события в одном сервисе.')[0]
  const reply={blocks:[{kind:'text',role:'title',priority:'primary',placement:'auto',fields:[{name:'text',ids:['f1']}],data:'',chart:'none',component:'native-title'},{kind:'text',role:'body',priority:'normal',placement:'auto',fields:[{name:'text',ids:['f2']}],data:'',chart:'none',component:'native-text'}],nodes:[{id:'n1',parent:'',direction:'column',block:'',weight:1,gap:32},{id:'n2',parent:'n1',direction:'leaf',block:'b1',weight:1,gap:0},{id:'n3',parent:'n1',direction:'leaf',block:'b2',weight:3,gap:0}]}
  return {run,library,packet,reply}
}
