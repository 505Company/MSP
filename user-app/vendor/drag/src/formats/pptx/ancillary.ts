import { modernComments, MODERN_REL } from "./modern-comments";
import type { ServiceNoteIR } from "../../core/model";
import { PptxCatalogReader, PRESENTATION as P, DRAWING as A, OFFICE_REL } from "./catalog";
import { child, kids, placeholder, shapeTree } from "./appearance";

/** Collect inert source metadata; never dereference URLs or decode embedded media. */
export function ancillary(reader: PptxCatalogReader, slidePart: string, warn: (code: string) => void) {
  const notes: ServiceNoteIR[] = [], seen = new Set<string>();
  let characters = 0;
  const resolved = new WeakMap<Element, string | undefined>();
  const add = (note: ServiceNoteIR, deduplicate = true) => {
    const key = JSON.stringify(note);
    if (deduplicate && seen.has(key)) return;
    characters += note.title.length + note.text.length;
    if (notes.length >= 128 || characters > 100000) throw new Error("security-limit");
    seen.add(key); notes.push(note);
  };
  const resolve = (node: Element, part: string, title = "Link"): string | undefined => {
    if (resolved.has(node)) return resolved.get(node);
    resolved.set(node, undefined);
    const id = node.getAttributeNS(OFFICE_REL, "id"), action = node.getAttribute("action") ?? "";
    // Media playback is disclosed by media(); it is never converted to an executable action.
    if (action === "ppaction://media") return undefined;
    if (action && action !== "ppaction://hlinksldjump") { warn("pptx-link"); return undefined; }
    const rel = id ? reader.relationships(part).get(id) : undefined;
    if (!rel || rel.blocked) { warn("pptx-link"); return undefined; }
    if (rel.type === `${OFFICE_REL}/hyperlink` && rel.external) { resolved.set(node, rel.target); return rel.target; }
    if (rel.type === `${OFFICE_REL}/slide` && !rel.external) {
      const destination = reader.analyze().pages.find(s => s.part === rel.target);
      if (destination) { add({ title, text: `Source slide ${destination.sourceIndex + 1} (internal link)` }); warn("pptx-link-internal"); return undefined; }
    }
    warn("pptx-link"); return undefined;
  };
  const inspectLinks = (shape: Element, part: string) => {
    for (const node of Array.from(shape.getElementsByTagNameNS(A, "hlinkClick"))) {
      const text = child(node.parentElement?.parentElement ?? undefined, "t")?.textContent;
      const title = text?.trim() ? `Link: ${text.trim().slice(0, 450)}` : "Object link";
      const url = resolve(node, part, title);
      if (url) add({ title, text: url, url });
    }
    if (shape.getElementsByTagNameNS(A, "hlinkMouseOver").length) warn("pptx-link");
  };
  const media = (shape: Element, part: string): "Video" | "Audio" | "Media" | undefined => {
    const elements = Array.from(shape.getElementsByTagName("*"));
    const source = elements.find(e => e.namespaceURI === A && ["videoFile", "audioFile", "wavAudioFile"].includes(e.localName));
    const extension = elements.find(e => e.localName === "media" && e.namespaceURI === "http://schemas.microsoft.com/office/powerpoint/2010/main");
    if (!source && !extension) return undefined;
    const kind = source?.localName === "videoFile" ? "Video" : source ? "Audio" : "Media";
    let url: string | undefined;
    for (const node of [source, extension]) {
      const id = node?.getAttributeNS(OFFICE_REL, "link") ?? node?.getAttributeNS(OFFICE_REL, "embed");
      const rel = id ? reader.relationships(part).get(id) : undefined;
      if (rel?.external && !rel.blocked && [ `${OFFICE_REL}/video`, `${OFFICE_REL}/audio`, "http://schemas.microsoft.com/office/2007/relationships/media" ].includes(rel.type)) url = rel.target;
      if (rel?.blocked) warn("pptx-link");
    }
    add({ title: kind, text: `${kind} playback was not imported.${url ? `\n${url}` : " Embedded media remains in the source presentation."}`, ...(url ? { url } : {}) });
    warn("pptx-media");
    return kind;
  };
  const readNotes = () => {
    const rels = [...reader.relationships(slidePart).values()];
    const visited = new Set<string>();
    for (const rel of rels) {
      if(visited.has(rel.target))continue;visited.add(rel.target);
      if (rel.type === `${MODERN_REL}comments`) {
        modernComments(reader,rel.target,note=>add(note,false),warn);
      } else if (rel.type === `${OFFICE_REL}/notesSlide`) {
        const root = reader.xml(rel.target, P, "notes"), bodies: string[] = [];
        for (const shape of kids(shapeTree(root), P)) {
          if (shape.localName !== "sp") continue;
          const type = placeholder(shape)?.getAttribute("type");
          if (type && type !== "body") continue;
          const body = child(shape, "txBody", P);
          const text = plainText(body);
          if (text.trim()) bodies.push(text);
          inspectLinks(shape, rel.target);
        }
        if (bodies.length) { add({ title: "Speaker notes", text: bodies.join("\n\n") }); warn("pptx-notes"); }
      } else if (rel.type === `${OFFICE_REL}/comments`) {
        const root = reader.xml(rel.target, P, "cmLst");
        let authors: Element | undefined;
        const authorsRel = [...reader.relationships(reader.presentationPart()).values()].find(r => r.type === `${OFFICE_REL}/commentAuthors`);
        if (authorsRel) authors = reader.xml(authorsRel.target, P, "cmAuthorLst");
        for (const comment of kids(root, P).filter(e => e.localName === "cm")) {
          const author = kids(authors, P).find(e => e.getAttribute("id") === comment.getAttribute("authorId"))?.getAttribute("name");
          const text = child(comment, "text", P)?.textContent ?? "";
          if (text.trim()) add({ title: author ? `Comment — ${author.slice(0, 450)}` : "Comment", text }, false);
        }
        warn("pptx-comments");
      } else if (/comment/i.test(rel.type)) warn("pptx-comments-unsupported");
    }
  };
  return { notes, add, resolve, inspectLinks, media, readNotes };
}
function plainText(body: Element | undefined): string {
  return kids(body).filter(e => e.localName === "p").map(p => kids(p).filter(e => ["r", "fld", "br"].includes(e.localName)).map(r => r.localName === "br" ? "\n" : child(r, "t")?.textContent ?? "").join("")).join("\n");
}
