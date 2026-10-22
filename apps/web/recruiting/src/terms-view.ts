import { createContext, use, useSyncExternalStore } from 'react';

import type { Done, JobData, JobTerms, TermsCatalogue, TermsOptions } from './types';

/**
 * What makes the setup's terms instant (R4).
 *
 * **A catalogue per country.** All of a country's kinds of work, contracts,
 * fixed-term reasons, leave and legal weeks come in one read, kept here by
 * country: two German entities share one fetch. The setup asks for every
 * entity's country as it opens, so by the time an entity is chosen its
 * choices are already here.
 *
 * **Picks shown before they are saved.** A pick goes into one overlay the
 * whole setup reads, so the part that depends on it unfolds, and its choices
 * list, the moment it is made; Recruiting's answer replaces it when it comes,
 * and a refused pick is taken back.
 */

type Call = (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;

const catalogues = new Map<string, TermsCatalogue>();
const fetching = new Set<string>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Ask for a country's catalogue once; a second ask, or one for the same country, waits on the first. */
export function prefetchCatalogue(call: Call, country: string): void {
  if (catalogues.has(country) || fetching.has(country)) return;
  fetching.add(country);
  void call('RecruitingTermsCatalogue', { country })
    .then((done) => {
      if (done.ok) {
        catalogues.set(country, done.data as TermsCatalogue);
        for (const listener of listeners) listener();
      }
    })
    .finally(() => {
      fetching.delete(country);
    });
}

/** Every country the company employs in, asked for at once. */
export function prefetchCatalogues(call: Call, data: JobData): void {
  for (const country of new Set(data.options.entities.map((e) => e.country)))
    prefetchCatalogue(call, country);
}

/** A country's catalogue, from the cache, keyed by the country; null until it arrives. */
export function useCatalogue(country: string | null): TermsCatalogue | null {
  return useSyncExternalStore(
    subscribe,
    () => (country === null ? null : (catalogues.get(country) ?? null)),
    () => null,
  );
}

/** The picks on their way to Recruiting, which the whole setup reads. */
export interface Picks {
  readonly picks: Partial<JobTerms>;
  readonly add: (patch: Partial<JobTerms>) => void;
  /** A refused pick, taken back. */
  readonly drop: (keys: readonly string[]) => void;
}

export const TermsPicks = createContext<Picks | null>(null);

export const usePicks = (): Picks | null => use(TermsPicks);

/** The picks Recruiting has not answered yet: the ones it now agrees with fall away. */
export function stillPending(picks: Partial<JobTerms>, server: JobTerms): Partial<JobTerms> {
  return Object.fromEntries(
    Object.entries(picks).filter(
      ([k, v]) => JSON.stringify(server[k as keyof JobTerms]) !== JSON.stringify(v),
    ),
  );
}

/**
 * The job as the setup shows it: the server's terms with the picks on top,
 * and the choices each part offers worked out here from the country's
 * catalogue, so nothing waits on a round trip. Where the catalogue has not
 * come yet, Recruiting's own options stand.
 */
export function viewOf(
  data: JobData,
  picks: Partial<JobTerms>,
  catalogue: TermsCatalogue | null,
): JobData {
  const terms: JobTerms = { ...data.terms, ...picks };
  if (Object.keys(picks).length === 0 && catalogue === null) return data;
  const server = data.options;
  const entity = server.entities.find((e) => e.id === terms.entityId) ?? null;
  if (entity === null)
    return {
      ...data,
      terms,
      options: {
        ...server,
        country: null,
        currency: null,
        locations: [],
        relationships: [],
        contractTypes: [],
        fixedTermReasons: [],
        leave: null,
      },
    };
  const locations = server.places
    .filter(
      (p) => p.country === entity.country && (p.entityId === null || p.entityId === entity.id),
    )
    .map(({ id, name, city, country }) => ({ id, name, city, country }));
  // As Recruiting asks: the kinds of work once the place and the way of working are known.
  const ready =
    terms.locationId !== null &&
    terms.workMode !== null &&
    locations.some((l) => l.id === terms.locationId);
  const relationships = ready ? (catalogue?.relationships ?? server.relationships) : [];
  const contracts =
    ready && terms.relationship !== null
      ? (catalogue?.contracts[terms.relationship] ??
        server.contractTypes.map((t) => ({ ...t, maxWeeklyMinutes: server.maxWeeklyMinutes ?? 0 })))
      : [];
  const contract = contracts.find((t) => t.key === terms.contractType);
  const weekly =
    terms.dayStart === null || terms.dayEnd === null || terms.workDays.length === 0
      ? null
      : terms.workDays.length * Math.max(0, terms.dayEnd - terms.dayStart - terms.breakMinutes);
  const days = Math.min(7, Math.max(1, terms.workDays.length || 5));
  const leave =
    ready && terms.relationship !== null
      ? (catalogue?.leave[terms.relationship]?.[days - 1] ?? server.leave)
      : null;
  const options: TermsOptions = {
    ...server,
    country: entity.country,
    currency: entity.currency,
    locations,
    relationships,
    contractTypes: contracts.map(({ maxWeeklyMinutes: _max, ...t }) => t),
    fixedTermReasons:
      contract?.fixedTerm === true
        ? (catalogue?.reasons[contract.key] ?? server.fixedTermReasons)
        : [],
    maxWeeklyMinutes:
      contract === undefined ? null : contract.maxWeeklyMinutes || server.maxWeeklyMinutes,
    fullTimeWeeklyMinutes: entity.fullTimeWeeklyMinutes,
    weeklyMinutes: weekly,
    hours:
      weekly === null ? null : weekly >= entity.fullTimeWeeklyMinutes ? 'full_time' : 'part_time',
    leave,
    reviewed: catalogue?.reviewed ?? server.reviewed,
  };
  return { ...data, terms, options };
}
