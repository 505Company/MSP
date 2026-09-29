export const componentSettingsPath = (upload: string, component: string) =>
  `/styles/${encodeURIComponent(upload)}/components/${encodeURIComponent(component)}`

export const componentLibraryPath = (upload: string, component?: string, kind?: string) =>
  `/styles/${encodeURIComponent(upload)}?section=${kind === 'graphic' ? 'assets' : ['composition', 'diagram'].includes(kind ?? '') ? 'composition' : 'components'}${component ? `&template=${encodeURIComponent(component)}` : ''}`
