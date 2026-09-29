export {hydrateEditableHtml} from './editable-hydrate'
import {validateEditableData,type EditableTemplate,type EditableData} from './editable-contract'
import {renderEditableHtml as render} from './editable-render'
export function renderEditableHtml(template:EditableTemplate,data:EditableData){
 const verify=(t:EditableTemplate,d:EditableData)=>{
  const own={...d};delete own.children;delete own.templateId;delete own.rowKeys;validateEditableData(t.kind,own,t.config)
  if(d.children){if(!t.children?.length||d.children.length<2||d.children.length>100)throw Error('Недопустимое число блоков');d.children.forEach((child,i)=>verify(t.children!.find(t=>t.id===child.templateId)??t.children![i%t.children!.length],child))}
 }
 verify(template,data);return render(template,data)
}
