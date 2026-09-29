import type { PreparedBoxes } from '../prepared-components'
import type { EditableTemplate, EditableData } from '../../design-system/editable-contract'
import type { BackgroundCatalog } from '../../design-system/backgrounds'
import type { ComponentLibrary } from '../../design-system/types'
import type { ContentProof } from './semantic-content'
import type { SlidePacket, CompactProof } from './compact-content'

export const STUDIO_VERSION = 'studio-recipes-16'
export type GenerationMode = 'fast' | 'smart'
export type ContentBlock = {
  id: string; kind: 'text' | 'metric' | 'step' | 'quote' | 'feature' | 'list' | 'visual'
  role: 'title' | 'body' | 'footer'; fields: Record<string, string>; source: string
  placement?: 'left' | 'right' | 'top' | 'bottom'
  emphasis?: 'primary' | 'secondary'
  sourceGroup?:{id:string;order:number;position:number}
  data?: { template: EditableTemplate; values: EditableData; sourceId?:string }
}
export type ContentSlide = { id: string; title: string; blocks: ContentBlock[]; directions: string[] }
export type Box = { x: number; y: number; w: number; h: number }
export type Region = {
  id: string; rect: Box; role: string; accepts: string[]; required: boolean; min: number; max: number
  typographyRole?: string; primitiveFirst?: boolean
  layouts: { id: string; direction: 'row' | 'column' | 'wrap'; columns: number; min: number; max: number; gap: number }[]
}
export type Recipe = { id: string; source: string; mode: string; regions: Region[] }
export type SlotPresentation = { components?: 'any'|'bare'|'panel'|'accent'; density?:'large'|'normal'|'compact'; requiresNestedFields?:boolean; primitiveFirst?:boolean; typographyRole?:string; repeatColumns?:number; factLayout?:'inline'|'stacked'; contentTreatment?:'list'|'section'|'pair'|'metric'; maxTypeSize?:number; scale?: number; typeScale?: number; headingScale?:number; markerScale?:number; maxHeadingRatio?:number; align?: 'start'|'center'|'end'; ink?: 'ink'|'accent'|'inverse'|'panel' }
export type Slot = { region: string; blocks: string[]; direction: 'row' | 'column' | 'wrap'; columns: number; rect: Box; gap: number; presentation?: SlotPresentation }
export type Candidate = { id: string; recipeId: string; label: string; slots: Slot[]; score: number; backgroundId?:string; canvasFillId?:string; artDirection?:'balanced'|'creative'; mirrored?:boolean; preserveReadingOrder?:boolean; sources?: string[]; decorations?:{id:string;rect:Box;surface:'panel'|'accent'|'rule'}[]; fixedComponents?:Record<string,string>; authored?: import('./recipe-packs').PackExecution; measuredFlow?:import('./component-flex').FlexNode[] }
export type ComponentBinding = { id: string; fields: Record<string, string>; kind: 'prepared' | 'editable' }
export type SlidePlan = { candidateId: string; components: Record<string, string>; primary: string[]; rationale: string; optionId?:string }
export type StudioLibrary = {
  id: string; uploadId: string; name: string; tokens: ComponentLibrary['tokens']; rules: string[]
  prepared: PreparedBoxes; editable: EditableTemplate[]; backgrounds?: BackgroundCatalog
}
export type SlideWork = {
  chrome?: { title: string; number: number }
  fallback?: { sourceSlideId: string; sourceTitle: string; page: number; version?: number; source?: ContentSlide }
  content: ContentSlide; candidates: Candidate[]; bindings: Record<string, ComponentBinding[]>; plan?: SlidePlan
  options?: DesignOption[]; history?: string[]; contentKey?: string
  diversityKey?: string; variation?: import('./variation').GenerationVariation; previousDesigns?: import('./variation').PreviousDesign[]
  error?: string
  strictComponents?: boolean
  flexNodes?: import('./component-flex').FlexNode[]
  semanticBlocks?: import('./compact-content').CompactReply['blocks']
}
export type SemanticUnit={id:string;packet:SlidePacket;status:'pending'|'running'|'complete'|'failed';attempts:number;error?:string;proof?:CompactProof;revalidatedResponse?:string;fallback?:boolean}
export type DesignOption = { id:string; label:string; signature:string; plan:SlidePlan; receipt?:RenderReceipt }
export type RenderReceipt = {
  slideId: string; candidateId: string; passed: boolean; preview: string; html: string
  blockIds: string[]; issues: string[]; warnings: string[]; elapsedMs: number
  components: { blockId: string; componentId: string; kind: 'prepared' | 'editable'; width: number; height: number; state?:'vertical'|'horizontal'|'compact' }[]
  text: { blockId: string; field: string; value: string; sourceRange?:{start:number;end:number}; size: number; x: number; y: number; width: number; height: number; font: string; color: string; weight: number }[]
  optionId?:string
  quality?:{score:number;reasons:string[]}
  colorZone?:import('./color-zones').ColorZone
  brandAccents?:import('./brand-accents').BrandAccents
  layout?:Record<string,Box>
  dataValues?:{blockId:string;templateId:string;values:EditableData}[]
}
export type StudioRun = {
  derivedFrom?: string
  presentationTitle?: string
  /** Read-only gallery projection; hydrate before rendering or exporting. Never persisted. */
  previewOnly?: true
  version: typeof STUDIO_VERSION; id: string; projectId: string; revision: string; mode: GenerationMode
  createdAt: string; library: StudioLibrary; slides: SlideWork[]; results: Record<string, RenderReceipt>
  status: 'preparing' | 'planning' | 'rendering' | 'complete' | 'blocked' | 'cancelled'; error?: string
  cancelledAt?: string
  /** Reversible removal from this saved generation, without rewriting its source. */
  deletedSlideIds?: string[]
  modelRequests: number; modelRunIds: string[]
  recipeScope?: import('./recipe-packs').RecipeScope
  variation?: import('./variation').GenerationVariation
  semantic?: { source: string; status: 'pending' | 'complete'; proof?: ContentProof; experimentalRoute?: 'akashml-fp8'; units?:SemanticUnit[]; strategy?:'recipes'|'components' }
}

/** Only an explicit local retry may upgrade the previous recipe executor. */
export function canReflowRecipes(run:StudioRun){
  return (run.semantic?.strategy!=='components'||[STUDIO_VERSION,'studio-recipes-15','studio-recipes-14','studio-recipes-13','studio-recipes-12','studio-recipes-11'].includes(run.version))&&run.status!=='complete'&&run.status!=='cancelled'&&[STUDIO_VERSION,'studio-recipes-15','studio-recipes-14','studio-recipes-13','studio-recipes-12','studio-recipes-11','studio-recipes-10','studio-recipes-9','studio-recipes-8','studio-recipes-7'].includes(run.version)
}
