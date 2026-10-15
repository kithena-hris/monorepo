import type { PublicListing } from '@kithena/contracts';

/** A listing's facts in words, the same on the results, the job page and the careers page. */

const COUNTRY: Readonly<Record<string, string>> = {
  DE: 'Germany',
  ES: 'Spain',
  GB: 'United Kingdom',
  IN: 'India',
  US: 'United States',
};
export const countryName = (code: string) => COUNTRY[code] ?? code;

const MODE: Readonly<Record<string, string>> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

export function where(l: Pick<PublicListing, 'places' | 'workMode'>): string {
  const place = l.places[0];
  if (l.workMode === 'remote') {
    const from = [
      ...new Set(l.places.flatMap((p) => (p.remoteFrom.length > 0 ? p.remoteFrom : [p.country]))),
    ];
    return `Remote in ${from.map(countryName).join(', ')}`;
  }
  const at = place === undefined ? '' : (place.city ?? countryName(place.country));
  return `${at} · ${MODE[l.workMode] ?? l.workMode}`;
}

export function salary(l: Pick<PublicListing, 'salary'>): string | null {
  if (l.salary === null) return null;
  const f = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: l.salary.currency,
    notation: 'compact',
    maximumFractionDigits: 0,
  });
  const per = l.salary.period === 'year' ? '' : ` a ${l.salary.period}`;
  return `${f.format(l.salary.minMinor / 100)}–${f.format(l.salary.maxMinor / 100)}${per}`;
}

export const hours = (h: string) => (h === 'part_time' ? 'Part time' : 'Full time');

/** "2 d", "1 w": how long ago, for a list. */
export function ago(iso: string, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
  if (days === 0) return 'Today';
  if (days < 7) return `${String(days)} d`;
  return `${String(Math.floor(days / 7))} w`;
}
