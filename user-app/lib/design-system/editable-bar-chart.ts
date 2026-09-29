import type {EditableProposal,EditableTemplate} from './editable-contract'
import type {SourceScene} from './source-scene'
import {containsBounds,isPanel,sourceMembers} from './editable-structure'
import {normalizedText} from './editable-native-layout'

/** Preserve observed decorated horizontal bars, including markers and range
 * labels. Model midpoint estimates never overwrite labels such as "31–40%". */
export function sourceBarChart(proposal:EditableProposal,scene:SourceScene,compile:(b:EditableProposal)=>EditableTemplate):EditableTemplate['sourceChart']|undefined{
 if(proposal.kind!=='chart'||!proposal.config.horizontal||proposal.config.chartType!=='bar'||proposal.data.series?.length!==1)return
 const members=sourceMembers(proposal.sourceIds,scene).filter(r=>!('children'in r.element)),panels=members.filter(r=>isPanel(r)&&!r.element.rotation&&r.bounds.width>r.bounds.height*2).sort((a,b)=>a.bounds.y-b.bounds.y)
 if(panels.length!==proposal.data.categories?.length||panels.length<2)return
 const rows:EditableTemplate[]=[],labels:string[]=[]
 for(const [index,panel]of panels.entries()){
  const inside=members.filter(r=>containsBounds(panel.bounds,r.bounds,3)),label=inside.filter(r=>r.element.kind==='text'&&/\d/.test(r.element.text))
  if(label.length!==1||label[0].element.kind!=='text')return
  const category=members.find(r=>r.element.kind==='text'&&normalizedText(r.element.text)===normalizedText(proposal.data.categories![index]))
  if(!category)return
  const row=compile({...proposal,id:`${proposal.id}-chart-row-${index+1}`,kind:'feature',name:'Строка диаграммы',sourceIds:[...inside.map(r=>r.element.id),category.element.id],memberIds:[],config:{},data:{title:proposal.data.categories![index],text:label[0].element.text}})
  if(!row.sourceLayout)return
  row.sourceLayout.bar={id:panel.element.id,width:panel.bounds.width}
  rows.push(row);labels.push(label[0].element.text)
 }
 const gaps=panels.slice(1).map((p,i)=>p.bounds.y-panels[i].bounds.y-panels[i].bounds.height)
 return {rows,labels,gap:Math.max(0,gaps.reduce((a,b)=>a+b,0)/gaps.length)}
}
