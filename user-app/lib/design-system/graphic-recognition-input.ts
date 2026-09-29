import { zlibSync } from 'fflate'
import type { ModelRun } from '../uploads/model-run'
import type { StructuredRequest } from '../uploads/qwen-structured'
import { recognitionSchema } from './reconstruction-contract'

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
 for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
 return n >>> 0
})
function chunk(type: string, data: Uint8Array) {
 const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
 view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8)
 let crc = 0xffffffff
 for (const byte of bytes.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
 view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0)
 return bytes
}
/** Encode the exact bounded pixels used for geometry, with transparency.
 * The original image can have different dimensions and exceed provider limits. */
export function graphicPreviewPng(width: number, height: number, rgba: Uint8Array) {
 if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 768) || rgba.length !== width * height * 4) throw Error('Некорректный размер изображения')
 const header = new Uint8Array(13), view = new DataView(header.buffer)
 view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
 const stride = width * 4, rows = new Uint8Array((stride + 1) * height)
 for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
 const pieces = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())]
 const png = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0)); let offset = 0
 for (const piece of pieces) { png.set(piece, offset); offset += piece.length }
 return png
}
/** Only image/answer failures. Auth, rate limits, outages and cancellation
 * remain queue-level failures, so they cannot silently empty the catalog. */
export function retainedGraphicReason(code?: string) {
 if (['SEMANTIC_VALIDATION', 'QWEN_INVALID_JSON', 'QWEN_INCOMPLETE'].includes(code ?? '')) return 'Ответ распознавания не прошёл проверку; исходная графика сохранена'
 const status = /^QWEN_HTTP_(400|413|422)$/.exec(code ?? '')?.[1]
 return status ? `Провайдер отклонил изображение (HTTP ${status}); исходная графика сохранена, обработка остальных компонентов продолжается` : undefined
}
const withoutImage = (task: StructuredRequest) => ({ ...task, messages: task.messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'image_url' ? { type: 'measured-source-image' } : p) })) })
export async function previousGraphicRecognition(bucket: R2Bucket, prefix: string, run: ModelRun | null, task: StructuredRequest, scope: Record<string, unknown>) {
 if (run?.status !== 'complete' || JSON.stringify(run.scope) !== JSON.stringify(scope)) return
 const file = await bucket.get(`${prefix}/inputs/${run.inputHash}.json`)
 if (!file) return
 const saved = await file.json<{ task: StructuredRequest }>()
 // Same source asset/catalog, prompt, geometry, fonts and schema; only the
 // image transport changed. Revalidate the saved result without a paid call.
 if (JSON.stringify(withoutImage(saved.task)) !== JSON.stringify(withoutImage(task))) return
 const parsed = recognitionSchema.safeParse(run.result)
 return parsed.success ? parsed.data : undefined
}
