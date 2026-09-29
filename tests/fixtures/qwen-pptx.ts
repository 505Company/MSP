import JSZip from "jszip"

export const SECRET = "PRIVATE_CONTENT_SENTINEL"

export function shape(id: string | null, options: { kind?: "text" | "image" | "line"; transform?: string; properties?: string; text?: string } = {}): string {
  const kind = options.kind ?? "text"
  const [tag, nv] = kind === "image" ? ["p:pic", "p:nvPicPr"] : kind === "line" ? ["p:cxnSp", "p:nvCxnSpPr"] : ["p:sp", "p:nvSpPr"]
  return `<${tag}><${nv}><p:cNvPr ${id === null ? "" : `id="${id}"`} name="${SECRET}"/><p:nvPr/></${nv}>
    <p:spPr>${options.transform ?? '<a:xfrm><a:off x="100" y="50"/><a:ext cx="300" cy="100"/></a:xfrm>'}${options.properties ?? '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'}</p:spPr>
    ${kind === "text" ? `<p:txBody><a:p><a:r><a:rPr sz="2400" b="1"><a:latin typeface="Arial"/></a:rPr><a:t>${options.text ?? SECRET}</a:t></a:r></a:p></p:txBody>` : ""}</${tag}>`
}

export function group(id: string, children: string): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${SECRET}"/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="100" y="100"/><a:ext cx="600" cy="300"/><a:chOff x="0" y="0"/><a:chExt cx="300" cy="150"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`
}

export async function pptxFixture(slides: Array<{ objects: string; part?: string; hidden?: boolean }>, extraParts: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  const put = (name: string, text: string) => zip.file(name, text, { date: new Date("2020-01-01T00:00:00Z"), createFolders: false })
  const parts = slides.map((slide, i) => slide.part ?? `ppt/slides/slide${i + 1}.xml`)
  put("ppt/presentation.xml", `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${parts.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="1000" cy="500"/></p:presentation>`)
  put("ppt/_rels/presentation.xml.rels", `<Relationships>${parts.map((part, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${part.slice(4)}"/>`).join("")}</Relationships>`)
  for (const [i, slide] of slides.entries()) put(parts[i]!, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" show="${slide.hidden ? 0 : 1}"><p:cSld name="${SECRET}"><p:spTree>${slide.objects}</p:spTree></p:cSld></p:sld>`)
  put("ppt/notesSlides/notesSlide1.xml", `<notes>${SECRET}</notes>`)
  put("docProps/core.xml", `<title>${SECRET}</title>`)
  for (const [name, contents] of Object.entries(extraParts)) put(name, contents)
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
}
