/**
 * NYC Local Law 144 (PRD §22.8): in New York City the evidence matrix is an
 * automated employment decision tool. It may be used only with an
 * independent bias audit from the last year, and only on an application whose
 * candidate saw the notice at least ten business days before. Pure.
 */

const BOROUGHS = new Set([
  'new york',
  'new york city',
  'nyc',
  'manhattan',
  'brooklyn',
  'queens',
  'bronx',
  'the bronx',
  'staten island',
]);

export interface Place {
  readonly country: string;
  readonly region: string | null;
  readonly city: string | null;
}

export function inNewYorkCity(places: readonly Place[]): boolean {
  return places.some(
    (p) =>
      p.country === 'US' &&
      p.region === 'NY' &&
      p.city !== null &&
      BOROUGHS.has(p.city.trim().toLowerCase()),
  );
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

function addBusinessDays(from: string, n: number): string {
  const d = day(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export function nycGate(
  places: readonly Place[],
  auditOn: string | null,
  appliedOn: string,
  today: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'audit' | 'notice' } {
  if (!inNewYorkCity(places)) return { ok: true };
  const yearAgo = day(today);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  if (auditOn === null || day(auditOn) <= yearAgo) return { ok: false, reason: 'audit' };
  if (addBusinessDays(appliedOn, 10) > today.slice(0, 10)) return { ok: false, reason: 'notice' };
  return { ok: true };
}
