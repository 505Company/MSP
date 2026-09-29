// Source/archive budgets match the browser reader. Individual HTTP requests stay small.
export const TRANSFER_LIMITS = Object.freeze({
  sourceBytes: 400 * 1024 * 1024,
  partBytes: 8 * 1024 * 1024,
  resourceBytes: 16 * 1024 * 1024,
  previewBytes: 3 * 1024 * 1024,
  totalResourceBytes: 512 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
})
export const SOURCE_SIZE_LABEL = '400 МБ'
