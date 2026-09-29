export type BankStyle = {
  id: string; name: string; fileName: string; sourceId: string; createdAt: string
  slideCount: number; componentCount: number; styleCount: number
  previewId: string | null; colors: string[]; fonts: string[]
}
export type PresentationProject = {
  schemaVersion: 1; id: string; revision: string; name: string; text: string
  uploadId: string; styleName: string; createdAt: string; updatedAt: string; archivedAt?: string
  generationMode?: 'fast' | 'smart'
  compositionMode?: 'recipes' | 'components'
  modelRoute?: 'default' | 'akashml-fp8'
  recipeScope?: 'all' | 'new'
}
export type ProjectSummary = Omit<PresentationProject, 'text'> & {
  slideCount: number; objectCount: number; readyCount: number
  status: 'draft' | 'working' | 'ready' | 'blocked' | 'changed' | 'saved'
  previewUrl: string | null
}
