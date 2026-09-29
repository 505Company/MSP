import type { ComponentRules } from './contract'

/** A conservative category fallback, never a claim of identical typography.
 * Symbols and pictograms need their original glyph mapping. */
export function googleFontAlternative(source: string): NonNullable<ComponentRules['fontReplacements']>[number]['family'] | undefined {
  if (/symbol|dingbat|wingding|webding|icon|emoji/i.test(source)) return undefined
  if (/mono|courier|consolas|menlo/i.test(source)) return 'Roboto Mono'
  if (!/sans/i.test(source) && /serif|times|georgia|cambria|garamond|baskerville/i.test(source)) return 'Noto Serif'
  return 'Noto Sans'
}
