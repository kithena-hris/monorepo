import type { PublicListing } from '@kithena/contracts';
import { locale } from '@reach/ui/intl';

import { t } from './i18n';

/** A listing's facts in words, the same on the results, the job page and the careers page. */

/** A country in the reader's language, from its ISO code: `DE` is Germany, Allemagne, Германия. */
export const countryName = (code: string): string => {
  try {
    return new Intl.DisplayNames([locale()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

const MODE = (): Readonly<Record<string, string>> => ({
  onsite: t('lib.format.on_site', 'On site'),
  hybrid: t('lib.format.hybrid', 'Hybrid'),
  remote: t('lib.format.remote', 'Remote'),
});

export function where(l: Pick<PublicListing, 'places' | 'workMode'>): string {
  const place = l.places[0];
  if (l.workMode === 'remote') {
    const from = [
      ...new Set(l.places.flatMap((p) => (p.remoteFrom.length > 0 ? p.remoteFrom : [p.country]))),
    ];
    return t('lib.format.remote_in', 'Remote in {{join}}', {
      join: from.map(countryName).join(', '),
    });
  }
  const at = place === undefined ? '' : (place.city ?? countryName(place.country));
  return `${at} · ${MODE()[l.workMode] ?? l.workMode}`;
}

export function salary(l: Pick<PublicListing, 'salary'>): string | null {
  if (l.salary === null) return null;
  const f = new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: l.salary.currency,
    notation: 'compact',
    maximumFractionDigits: 0,
  });
  // A fixed salary is one figure, never a range from a number to itself.
  const amount =
    l.salary.minMinor === l.salary.maxMinor
      ? f.format(l.salary.minMinor / 100)
      : `${f.format(l.salary.minMinor / 100)}–${f.format(l.salary.maxMinor / 100)}`;
  if (l.salary.period === 'month') return t('lib.format.a_month', '{{amount}} a month', { amount });
  if (l.salary.period === 'hour') return t('lib.format.an_hour', '{{amount}} an hour', { amount });
  return amount;
}

export const hours = (h: string): string =>
  h === 'part_time'
    ? t('lib.format.part_time', 'Part time')
    : t('lib.format.full_time', 'Full time');

/** "2 d", "1 w": how long ago, for a list. */
export function ago(iso: string, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
  if (days === 0) return t('lib.format.today', 'Today');
  if (days < 7) return t('lib.format.days_ago', '{{days}} d', { days });
  return t('lib.format.weeks_ago', '{{weeks}} w', { weeks: Math.floor(days / 7) });
}
