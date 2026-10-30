import { dateFormat } from '@reach/ui';

/**
 * A CV's dates as picked values (`cv-writer.tsx`): `2023-03`, `2023`, or
 * `now` for what they still do.
 */
export const NOW = 'now';

/** A month's name in the page's language: 1 is January. */
export const monthName = (m: number, style: 'long' | 'short'): string =>
  dateFormat({ month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 1)));

const ENGLISH_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** What the AI wrote ("2021", "Mar 2023", "now"), as a picked value; '' when it says no date. */
export function toMonthYear(raw: string): string {
  const v = raw.trim();
  if (v === '') return '';
  if (/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/u.test(v)) return v;
  const year = /\b(19|20)\d{2}\b/u.exec(v)?.[0];
  if (year === undefined) return /^\p{L}+$/u.test(v) ? NOW : '';
  const lower = v.toLocaleLowerCase();
  const month = Array.from({ length: 12 }, (_, i) => i + 1).find((m) =>
    [monthName(m, 'long'), monthName(m, 'short'), ENGLISH_MONTHS[m - 1] ?? ''].some(
      (n) => n !== '' && lower.includes(n.toLocaleLowerCase().replace('.', '')),
    ),
  );
  return month === undefined ? year : `${year}-${String(month).padStart(2, '0')}`;
}
