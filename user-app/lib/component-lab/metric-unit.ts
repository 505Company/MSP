import type { TextElementIR } from '../../vendor/drag/src/core/model'

/** Keep every character, including spacing, when the value/unit change. More
 * ratios keep their complete numeric expression before the unit suffix. */
export function metricParts(text: string) {
  const match = /^([+−–-]?[ \u00a0\u202f]*\d(?:[\d .,\u00a0\u202f]*\d)?(?:[ \u00a0\u202f]*(?:из|of|\/)[ \u00a0\u202f]*\d(?:[\d .,\u00a0\u202f]*\d)?)?)([^\d\r\n]*)$/u.exec(text)
  return match ? match[2].trim() ? [match[1], match[2]] : [match[1] + match[2]] : undefined
}
export function sourceUnitScale(e: TextElementIR) {
  const parts = metricParts(e.text), runs = e.styleRuns
  if (parts?.length !== 2 || !parts[1].trim() || runs?.length !== 2) return undefined
  const [value, unit] = runs
  if (value.start !== 0 || value.end !== parts[0].length || unit.start !== value.end || unit.end !== e.text.length) return undefined
  if (value.fontFamily !== unit.fontFamily || value.fontStyle !== unit.fontStyle || (value.letterSpacing ?? 0) !== (unit.letterSpacing ?? 0)) return undefined
  const ratio = unit.fontSize / value.fontSize
  return Number.isFinite(ratio) && ratio >= .35 && ratio <= 1.5 ? ratio : undefined
}
