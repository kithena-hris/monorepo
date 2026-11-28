'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A choice kept in this browser for the next visit: the default on the
 * server and until the browser has been read, so the two agree.
 *
 * `read` turns whatever was stored (or `null`, nothing) into a value the
 * caller can trust: storage is the reader's, and an old version's shape or a
 * hand-edited one must not reach the screen as it is.
 *
 * ponytail: per browser, not per account; a preference that should follow a
 * person between devices belongs with their account, not here.
 */
export function useKept<T>(key: string, read: (raw: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState(() => read(null));
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(read(JSON.parse(raw)));
    } catch {
      // No storage, or not ours: the default stands.
    }
    // `read` is pure and the same every draw: only the key says what to read.
  }, [key]);
  return [
    value,
    (next) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not kept: it still holds for this visit.
      }
    },
  ];
}

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
