import { countryRules } from '@kithena/contracts';
import { isTimeZone } from '@kithena/domain-kit';

import { looksLikeId, normalName } from './identifiers.js';
import { countryOfZone, placeIn, zoneOfCountry } from './place-hints.js';

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
  /**
   * Why the country or zone proposed for a new one wants a look: the file
   * disagrees with itself, or says nothing of where it is. Null otherwise.
   */
  readonly note: string | null;
}

/** One row naming a work location, and what the row says of that workplace (never of a home). */
export interface WorkplaceCell {
  readonly value: string;
  readonly row: number;
  readonly name: string | null;
  /** The file's time zone column. */
  readonly timeZone?: string | null;
  /** The workplace's address, city or postcode columns, as one text. */
  readonly address?: string | null;
  /** The file's legal entity, as it names it. */
  readonly entity?: string | null;
}

export interface EntityHere {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
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

/** The value most rows give, first seen first on a tie; null when none gives one. */
function commonest(values: readonly (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = v?.trim() ?? '';
    if (t !== '') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

const countryName = (code: string): string => countryRules(code)?.name ?? code;

/**
 * Where a new one is and whose it is: the country and zone the file gives
 * (its time zone, else its address, else a city in its name), the legal
 * entity it names here, else the one entity in that country, else the
 * first. When the place's own words and the file's zone disagree, the
 * place's words win and the note says so; when nothing says where it is,
 * the entity's country and zone, and the note says that.
 */
function newPlace(
  value: string,
  rows: readonly WorkplaceCell[],
  entities: readonly EntityHere[],
): { readonly add: Extract<PlaceChoice, { kind: 'add' }>; readonly note: string | null } | null {
  const [first] = entities;
  if (first === undefined) return null;
  const fileZone = commonest(rows.map((r) => r.timeZone));
  const zone = fileZone !== null && isTimeZone(fileZone) ? fileZone : null;
  const address = commonest(rows.map((r) => r.address));
  const own = [...(address === null ? [] : [placeIn(address)]), placeIn(value)].find(
    (p) => p.country !== null,
  );
  const zoneCountry = zone === null ? null : countryOfZone(zone);
  const disagree = own !== undefined && zoneCountry !== null && own.country !== zoneCountry;
  const named = commonest(rows.map((r) => r.entity));
  const byName =
    named === null ? undefined : entities.find((e) => normalName(e.name) === normalName(named));
  const country = disagree ? own.country : (zoneCountry ?? own?.country ?? byName?.country ?? null);
  const inCountry = entities.filter((e) => e.country === country);
  const entity = byName ?? (inCountry.length === 1 ? inCountry[0] : undefined) ?? first;
  if (country === null) {
    return {
      add: {
        kind: 'add',
        name: value,
        country: entity.country,
        timeZone: zone ?? entity.timeZone,
        legalEntityId: entity.id,
      },
      note: `Nothing in the file says where “${value}” is, so ${entity.name}’s country and time zone are suggested: check them.`,
    };
  }
  const timeZone = disagree
    ? (own.timeZone ?? zoneOfCountry(country))
    : (zone ?? own?.timeZone ?? zoneOfCountry(country));
  const where = own?.city ?? `“${value}”`;
  return {
    add: {
      kind: 'add',
      name: value,
      country,
      timeZone: timeZone ?? (entity.country === country ? entity.timeZone : ''),
      legalEntityId: entity.id,
    },
    note: disagree
      ? `${where} is in ${countryName(country)} but the file’s time zone is ${String(zone)}: check the time zone.`
      : null,
  };
}

/**
 * Each distinct value of the column, with its rows, its people and what is
 * proposed: the one it already is; else a close name; else a new one by the
 * file's name, its country, zone and legal entity read from the file
 * (`newPlace`); else, for another system's id or with no legal entity to
 * add one to, empty.
 */
export function workplacesIn(
  cells: readonly WorkplaceCell[],
  places: readonly PlaceHere[],
  entities: readonly EntityHere[],
): WorkplaceValue[] {
  const byKey = new Map<string, { value: string; people: string[]; rows: WorkplaceCell[] }>();
  for (const c of cells) {
    const value = c.value.trim().replaceAll(/\s+/gu, ' ');
    if (value === '') continue;
    const key = placeKey(value);
    const held = byKey.get(key) ?? { value, people: [], rows: [] };
    held.rows.push(c);
    if (c.name !== null && held.people.length < SHOWN) held.people.push(c.name);
    byKey.set(key, held);
  }
  return [...byKey].map(([key, { value, rows, people }]) => {
    const found = foundHere(value, places);
    const id = looksLikeId(value);
    const close = found === null && !id ? closestPlace(value, places) : null;
    const fresh = found === null && close === null && !id ? newPlace(value, rows, entities) : null;
    const proposed: PlaceChoice =
      found !== null
        ? { kind: 'map', locationId: found.id }
        : close !== null
          ? { kind: 'map', locationId: close.id }
          : (fresh?.add ?? { kind: 'leave' });
    return {
      key,
      value,
      rows: rows.length,
      people,
      found: found === null ? null : { id: found.id, name: found.name },
      suggestion: close === null ? null : { id: close.id, name: close.name },
      looksLikeId: id,
      proposed,
      note: fresh?.note ?? null,
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
