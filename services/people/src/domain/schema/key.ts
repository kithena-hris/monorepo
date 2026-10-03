/** A key from a label: `Cost centre` → `cost_centre`. */
export function keyFrom(label: string): string {
  const key = label
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 60);
  return /^[a-z]/u.test(key) ? key : `f_${key}`.slice(0, 60);
}
