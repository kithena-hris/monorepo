'use client';

import { useEffect, useRef } from 'react';

/** The keys put back this page load: once each, so Back to the bare address stays there. */
const restored = new Set<string>();

/**
 * Filters the address holds, remembered between visits.
 *
 * A list's filter and sort live in the address so a link opens the same list;
 * that also means a fresh visit forgets them. This keeps the last choice in
 * the browser as it is made, and on a visit whose address names none of them
 * puts it back, once: `apply` is the caller's own way of changing the address.
 * An address that names any of them wins, so a shared link is never overridden.
 *
 * Returns the function to call in place of `apply`: it remembers, then applies.
 *
 * Kept beside the screen that uses it, as each remote keeps its own helpers:
 * Reach is on every page, and this is not presentation.
 */
export function useKeptFilters(
  key: string,
  current: Readonly<Record<string, string | null | undefined>>,
  apply: ((patch: Readonly<Record<string, string | null>>) => void) | undefined,
): (patch: Readonly<Record<string, string | null>>) => void {
  const now = useRef(current);
  now.current = current;
  const act = useRef(apply);
  act.current = apply;
  useEffect(() => {
    if (restored.has(key) || act.current === undefined) return;
    restored.add(key);
    if (Object.values(now.current).some((v) => v != null && v !== '')) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      const kept = JSON.parse(raw) as unknown;
      if (typeof kept !== 'object' || kept === null) return;
      // Only the filters this list has, and only words: storage is not trusted.
      const patch = Object.fromEntries(
        Object.entries(kept).filter(
          ([name, v]) => name in now.current && typeof v === 'string' && v !== '',
        ),
      ) as Record<string, string>;
      if (Object.keys(patch).length > 0) act.current(patch);
    } catch {
      // No storage, or not ours: the address stands.
    }
  }, [key]);
  return (patch) => {
    try {
      const raw = window.localStorage.getItem(key);
      const kept = (raw === null ? {} : JSON.parse(raw)) as Record<string, unknown>;
      const next = Object.fromEntries(
        Object.entries({ ...kept, ...patch }).filter(([, v]) => typeof v === 'string' && v !== ''),
      );
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Not kept: the address still changes.
    }
    act.current?.(patch);
  };
}
