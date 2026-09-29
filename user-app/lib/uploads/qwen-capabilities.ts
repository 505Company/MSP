import { z } from 'zod'
import { contentHash } from '../design-system/catalog'
import { beginModelRun, readModelRun } from './model-run'
import { modelIdentity, type StructuredRequest } from './qwen-structured'
import { QwenAnalysisError, type QwenConfig } from './qwen-analysis'

export const CAPABILITY_VERSION = 'web-qwen-capability-1'
// Synthetic 64×64 PNG, four coloured quadrants; no user material.
const image = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbUlEQVR4nO3PwQkAUQhDQftv2q3hH9wQGHhnzczOnHZ7/YfyCwDKyy8AKC+/AKC8/AKA8vILAMrLLwAoL78AoLz8AoDy8gsAyssvACjv/sHxh905DQAAAAAAAAAAAAAAAAAAAAAAAAAAAADguQ/7Be0ehXGAqQAAAABJRU5ErkJggg=='
const colors = ['red', 'green', 'blue', 'yellow'] as const
const responseSchema = z.object({ marker: z.string(), topLeft: z.enum(colors), topRight: z.enum(colors), bottomLeft: z.enum(colors), bottomRight: z.enum(colors) }).strict()
const properties = { marker: { type: 'string' }, ...Object.fromEntries(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map(k => [k, { type: 'string', enum: colors }])) }
export const capabilityTask: StructuredRequest = {
  schemaName: 'web_qwen_capabilities', maxTokens: 256,
  schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
  messages: [{ role: 'system', content: 'Return JSON according to the schema. Inspect the image, do not infer its colours from the field names.' },
    { role: 'user', content: [{ type: 'text', text: 'Copy marker MSP-7K into marker. Name the colour of each of the four quadrants of this image.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } }] }],
}
export function validateCapabilities(raw: unknown) {
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success || parsed.data.marker !== 'MSP-7K' || parsed.data.topLeft !== 'red' || parsed.data.topRight !== 'green' || parsed.data.bottomLeft !== 'blue' || parsed.data.bottomRight !== 'yellow') throw new QwenAnalysisError('QWEN_CAPABILITY_CHECK_FAILED', 'Модель не прошла проверку текста и изображения.')
  return { textInput: 'verified', imageInput: 'verified', strictJsonSchema: 'accepted_and_validated', observation: parsed.data }
}
async function prefix(config: QwenConfig) {
  // Key changes invalidate the access check. Neither the key nor its fingerprint
  // is returned to clients, included in prompts or written to job metadata.
  return `qwen-capabilities/${await contentHash([CAPABILITY_VERSION, modelIdentity(config), config.apiKey ?? null])}`
}
export async function startCapabilities(bucket: R2Bucket, config: QwenConfig) {
  return beginModelRun({ bucket, prefix: await prefix(config), config, version: CAPABILITY_VERSION, scope: { synthetic: true }, task: capabilityTask, validate: validateCapabilities })
}
export async function readCapabilities(bucket: R2Bucket, config: QwenConfig) {
  const run = await readModelRun(bucket, await prefix(config))
  const original = run?.cacheHit && run.sourceRunId ? await readModelRun(bucket, await prefix(config), run.sourceRunId) : run
  return { configured: Boolean(config.apiKey?.trim()), region: 'rus', model: modelIdentity(config).model,
    textInput: run?.status === 'complete' ? 'verified' : 'not_tested',
    imageInput: run?.status === 'complete' ? 'verified' : 'not_tested',
    strictJsonSchema: run?.status === 'complete' ? 'accepted_and_validated' : 'not_tested',
    checkedAt: run?.status === 'complete' ? original?.finishedAt ?? null : null,
    checkStatus: run?.status ?? 'not_tested', error: run?.error ?? null,
  }
}
