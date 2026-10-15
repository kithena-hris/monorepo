export type Search = Promise<Record<string, string | string[] | undefined>>;

/** The address as the API takes it: repeated checkboxes joined, "any" and empty dropped. */
export function queryOf(params: Awaited<Search>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v): v is string => v !== undefined && v !== '' && v !== 'any',
    );
    if (values.length > 0) out.set(key, values.join(','));
  }
  return out;
}
