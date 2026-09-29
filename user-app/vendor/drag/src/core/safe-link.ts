/** URL data only: no navigation, fetch, filesystem access, or platform URL global needed. */
export function isSafeLink(value: unknown, media = false): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  const web = /^https?:\/\/([^/?#]+)(?:[/?#].*)?$/i.exec(value);
  if (web) return !/[@%]/.test(web[1]!) && /^(?:\[[0-9a-f:]+\]|[a-z0-9\u0080-\uffff.-]+)(?::\d{1,5})?$/iu.test(web[1]!);
  return !media && /^mailto:[^?@<>]+@[^?@<>]+(?:\?[^<>]*)?$/i.test(value);
}
