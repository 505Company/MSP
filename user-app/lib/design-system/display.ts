import type { ComponentIssue, TextSlot } from './types'

// Names from drawing tools are identifiers, not useful component titles.
const generatedName=/^(?:Google Shape(?:;|$)|(?:cmp-)?s\d+-object-|(?:Shape|Group|TextBox|Rectangle|Rounded Rectangle|Oval|Picture|Freeform|Line|Chart|Table)[\s;_\d:-]*$)/i
export function componentLabel(component:{name:string;kind:string;text?:string;slots?:Pick<TextSlot,'defaultText'>[]}):string{
  if(component.name.trim()&&!generatedName.test(component.name))return component.name
  const text=(component.text??component.slots?.map(s=>s.defaultText).join(' · ')??'').replace(/\s+/g,' ').trim()
  return text.length>90?text.slice(0,87)+'…':text||(component.kind==='compound'?'Группа элементов':component.kind==='table'?'Таблица':'Графический элемент')
}
export function textFieldLabel(slot:TextSlot,index:number){return generatedName.test(slot.label)?`Текст ${index+1}`:slot.label}
export function componentIssueText(issue:ComponentIssue):string{
  const messages:Record<string,string>={
    'text-overflow':'В этом поле текст не помещается. Сократите его или выберите компонент с большим текстовым полем.',
    'source-warning':'Некоторые детали оформления могут отличаться от исходного слайда.',
    effects:'Тени и размытие пока не поддерживаются.',
    'table-layout':'Заполнение этой таблицы пока недоступно.',
    chart:'Данные этой диаграммы пока нельзя редактировать.',
    justified:'Выравнивание текста по ширине пока не поддерживается.',
    'asset-format':'Этот формат изображения пока не поддерживается.',
    'outside-slide':'Компонент выходит за границы слайда. Переместите или уменьшите его.',
    'pptx-export-property':'Некоторые элементы пока нельзя экспортировать в PPTX. Выберите другой компонент.',
    'execution-error':'Не удалось показать компонент. Попробуйте открыть его снова.',
    'slide-error':'Не удалось показать слайд. Проверьте добавленные компоненты.'
  }
  return messages[issue.code]??issue.message
}
