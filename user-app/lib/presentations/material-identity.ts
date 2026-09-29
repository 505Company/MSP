// Shared with the browser so a different tab's material cannot be shown as the
// result of the text still visible in this form. Contains no server dependencies.
// Parsing revisions are versioned separately; this identity pins the exact source.
export const MATERIAL_VERSION = 'web-material-1'
export async function materialIdentity(text: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: MATERIAL_VERSION, text }))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
}
