import { looksLikeId, normalName } from './identifiers.js';

/**
 * The work locations a file names, decided inside the import (the user: "Set
 * up workplaces inline"). For each distinct value HR maps it to a work
 * location here, adds it as a new one, or leaves it empty, and the people it
 * leaves empty are listed by name. Pure: the dry run reads the file and the
 * company, the plan says it in words, and the run adds through the settings'
 * own use case.
 */

export type PlaceChoice =
  | { readonly kind: 'map'; readonly locationId: string }
  | {
      readonly kind: 'add';
      readonly name: string;
      readonly country: string;
      readonly timeZone: string;
      /** The legal entity it belongs to; absent, the row's own. */
      readonly legalEntityId?: string;
    }
  | { readonly kind: 'leave' };

export interface PlaceHere {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
}

/** One distinct value of the file's work location column, and what happens to it. */
export interface WorkplaceValue {
  /** How choices are keyed: the value as any spelling of it reads. */
  readonly key: string;
  /** As the file first writes it. */
  readonly value: string;
  readonly rows: number;
  /** Who, by name: the first twenty. */
  readonly people: readonly string[];
  /** The work location here it already is, by id or by name. */
  readonly found: { readonly id: string; readonly name: string } | null;
  /** A work location here with a close name, when it is none. */
  readonly suggestion: { readonly id: string; readonly name: string } | null;
  /** An id from another system: nothing to add it by. */
  readonly looksLikeId: boolean;
  readonly proposed: PlaceChoice;
}

export const placeKey = (value: string): string => normalName(value);

const SHOWN = 20;

/** Edits from one name to another: a typo, a missing letter. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/**
 * A live work location whose name is close to a value: one contains the other
 * ("Scranton Branch", "Scranton"), or they differ by a typo or two. An
 * abbreviation ("NYC") is not guessed at.
 */
export function closestPlace(value: string, places: readonly PlaceHere[]): PlaceHere | null {
  const wanted = normalName(value);
  if (wanted.length < 3) return null;
  let best: { readonly place: PlaceHere; readonly score: number } | null = null;
  for (const place of places) {
    if (place.archived === true) continue;
    const name = normalName(place.name);
    const shorter = Math.min(name.length, wanted.length);
    const contains = shorter >= 4 && (name.includes(wanted) || wanted.includes(name));
    const edits = distance(wanted, name);
    const close = edits <= Math.floor(Math.max(name.length, wanted.length) / 4);
    if (!contains && !close) continue;
    const score = contains ? 0 : edits;
    if (best === null || score < best.score) best = { place, score };
  }
  return best?.place ?? null;
}

function foundHere(value: string, places: readonly PlaceHere[]): PlaceHere | null {
  const wanted = value.trim();
  const live = places.filter((p) => p.archived !== true);
  const byId = live.find((p) => p.id === wanted);
  if (byId) return byId;
  const named = live.filter((p) => normalName(p.name) === normalName(wanted));
  return named.length === 1 ? (named[0] ?? null) : null;
}

/**
 * Each distinct value of the column, with its rows, its people and what is
 * proposed: the one it already is; else a close name; else a new one by the
 * file's name, prefilled from `defaults` (the legal entity's country and
 * zone); else, for another system's id or with nowhere to add one, empty.
 */
export function workplacesIn(
  cells: readonly { readonly value: string; readonly row: number; readonly name: string | null }[],
  places: readonly PlaceHere[],
  defaults: {
    readonly country: string;
    readonly timeZone: string;
    readonly legalEntityId: string;
  } | null,
): WorkplaceValue[] {
  const byKey = new Map<string, { value: string; rows: number; people: string[] }>();
  for (const c of cells) {
    const value = c.value.trim().replaceAll(/\s+/gu, ' ');
    if (value === '') continue;
    const key = placeKey(value);
    const held = byKey.get(key) ?? { value, rows: 0, people: [] };
    held.rows += 1;
    if (c.name !== null && held.people.length < SHOWN) held.people.push(c.name);
    byKey.set(key, held);
  }
  return [...byKey].map(([key, { value, rows, people }]) => {
    const found = foundHere(value, places);
    const id = looksLikeId(value);
    const close = found === null && !id ? closestPlace(value, places) : null;
    const proposed: PlaceChoice =
      found !== null
        ? { kind: 'map', locationId: found.id }
        : close !== null
          ? { kind: 'map', locationId: close.id }
          : id || defaults === null
            ? { kind: 'leave' }
            : { kind: 'add', name: value, ...defaults };
    return {
      key,
      value,
      rows,
      people,
      found: found === null ? null : { id: found.id, name: found.name },
      suggestion: close === null ? null : { id: close.id, name: close.name },
      looksLikeId: id,
      proposed,
    };
  });
}

export type PlaceChoiceRef =
  | { readonly kind: 'id'; readonly id: string }
  | ({ readonly kind: 'new' } & Omit<Extract<PlaceChoice, { kind: 'add' }>, 'kind'>)
  | { readonly kind: 'none'; readonly reason: string };

/**
 * What HR's choice for a value means for a row naming it: the work location
 * mapped to; one to add (or, once added by this run, found by its name); or
 * left empty, and said so.
 */
export function placeChoiceRef(choice: PlaceChoice, places: readonly PlaceHere[]): PlaceChoiceRef {
  if (choice.kind === 'leave') {
    return { kind: 'none', reason: 'left empty, as chosen in the import' };
  }
  if (choice.kind === 'map') {
    const place = places.find((p) => p.id === choice.locationId);
    if (place === undefined) {
      return { kind: 'none', reason: 'the work location chosen for it is not here' };
    }
    return place.archived === true
      ? { kind: 'none', reason: `“${place.name}” is archived` }
      : { kind: 'id', id: place.id };
  }
  const { kind: _kind, ...add } = choice;
  const added = foundHere(choice.name, places);
  return added === null ? { kind: 'new', ...add } : { kind: 'id', id: added.id };
}
