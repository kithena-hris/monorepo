/**
 * What narrows a screen, in its address: a search, a filter, a tab, an
 * order. A link then opens the same view for whoever follows it, a refresh
 * keeps it, and Back undoes it.
 *
 * Values arrive from anybody's address bar, so every read is checked: an
 * unknown or garbled value is the default, never an error. Defaults are left
 * out of the address, so an untouched screen's link is its bare path.
 */

/** `raw` when it is one of `allowed`, else `fallback`. */
export function oneOf<T extends string, F extends T | null | undefined>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: F,
): T | F {
  return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * `path` with `current`'s query and `patch` applied over it. A null or empty
 * value removes its key; everything `patch` does not name is kept. The order
 * of the keys already there is kept too, so a link reads the same after a
 * change as before it.
 */
export function withQuery(
  path: string,
  current: string | URLSearchParams | Readonly<Record<string, string>>,
  patch: Readonly<Record<string, string | null | undefined>>,
): string {
  const q = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') q.delete(key);
    else q.set(key, value);
  }
  const qs = q.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

/** How a change reaches the address: a new entry Back returns from, or this one rewritten. */
export type HistoryMode = 'push' | 'replace';

/**
 * Put what the browser shows into its address without asking the server
 * again: for state a screen applies to what it already has. Next's router
 * follows the History API (`useSearchParams` sees it, Back restores it), so
 * this stays a client-side navigation.
 */
export function noteInAddress(
  patch: Readonly<Record<string, string | null | undefined>>,
  mode: HistoryMode,
): void {
  const { pathname, search, hash } = window.location;
  const to = withQuery(pathname, search, patch) + hash;
  if (to === pathname + search + hash) return;
  if (mode === 'push') window.history.pushState(null, '', to);
  else window.history.replaceState(null, '', to);
}

/**
 * The directory's conditions from `?conditions=`, a JSON list, or null. Only
 * their shape is checked here; People decides what may be asked.
 */
export function conditionsOf(
  raw: string | undefined,
): { key: string; op: string; values: string[] }[] | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ok = parsed.filter(
      (c): c is { key: string; op: string; values: string[] } =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as { key?: unknown }).key === 'string' &&
        typeof (c as { op?: unknown }).op === 'string' &&
        Array.isArray((c as { values?: unknown }).values) &&
        (c as { values: unknown[] }).values.every((v) => typeof v === 'string'),
    );
    return ok.length === 0 ? null : ok.map(({ key, op, values }) => ({ key, op, values }));
  } catch {
    return null;
  }
}

/** What a field's key looks like: the registry's own shape. */
const FIELD_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * `key:value` pairs, comma-separated (`?filter=department:sales`); a pair
 * without both halves is dropped, and so is a key that is not a field's key
 * (`__proto__` names no field, and must never name a property either).
 */
export function filtersOf(raw: string | null | undefined): Record<string, string> {
  return Object.fromEntries(
    (raw ?? '').split(',').flatMap((pair) => {
      const at = pair.indexOf(':');
      const key = pair.slice(0, at);
      return at > 0 && at < pair.length - 1 && FIELD_KEY.test(key)
        ? [[key, pair.slice(at + 1)] as const]
        : [];
    }),
  );
}

/** `?sort=hire_date:desc`, or null for People's own order. */
export function sortOf(raw: string | null | undefined): string | null {
  return raw != null && /^[a-z][a-z0-9_]*:(asc|desc)$/.test(raw) ? raw : null;
}

/** `?top=5`: at most this many people, or null for everybody found. */
export function topOf(raw: string | null | undefined): number | null {
  const n = raw != null && /^\d{1,4}$/.test(raw) ? Number(raw) : 0;
  return n >= 1 && n <= 1000 ? n : null;
}

/** A query-string value, or null for one that was not given. */
const given = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value;

/**
 * The directory's page, as the address asks for it, in People's variables:
 * `q` the search, `filter`, `conditions` (all of them, or `match=any`),
 * `sort`, `top`, `segment`, `incomplete=true`, and `after` a page. Anything garbled
 * is as if it were not there.
 */
export function directoryQuery(search: Readonly<Record<string, string>>): {
  search: string | null;
  filter: string | null;
  after: string | null;
  segment: string | null;
  incomplete: true | null;
  conditions: { key: string; op: string; values: string[] }[] | null;
  match: 'any' | null;
  sort: string | null;
  top: number | null;
} {
  const filter = Object.entries(filtersOf(search['filter']))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  return {
    search: given(search['q']),
    filter: filter === '' ? null : filter,
    after: given(search['after']),
    segment: given(search['segment']),
    incomplete: search['incomplete'] === 'true' ? true : null,
    conditions: conditionsOf(search['conditions']),
    match: search['match'] === 'any' ? ('any' as const) : null,
    sort: sortOf(search['sort']),
    top: topOf(search['top']),
  };
}
