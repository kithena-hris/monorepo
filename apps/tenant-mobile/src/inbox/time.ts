import { t } from '../i18n';

/** The calendar day of an instant in a zone, `YYYY-MM-DD`: pure, for the screens and their tests. */
export function dayIn(instant: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instant));
  } catch {
    return instant.slice(0, 10);
  }
}

const MONTHS = () => [
  t('inbox.time.jan', 'Jan'),
  t('inbox.time.feb', 'Feb'),
  t('inbox.time.mar', 'Mar'),
  t('inbox.time.apr', 'Apr'),
  t('inbox.time.may', 'May'),
  t('inbox.time.jun', 'Jun'),
  t('inbox.time.jul', 'Jul'),
  t('inbox.time.aug', 'Aug'),
  t('inbox.time.sep', 'Sep'),
  t('inbox.time.oct', 'Oct'),
  t('inbox.time.nov', 'Nov'),
  t('inbox.time.dec', 'Dec'),
];
export const shortDay = (day: string): string =>
  `${String(Number(day.slice(8, 10)))} ${MONTHS()[Number(day.slice(5, 7)) - 1] ?? ''}`;

/** A task's due date as its row says it, and how loudly (C9). */
export function dueOf(
  item: { readonly due: string | null; readonly dueVerb: 'due' | 'decide' },
  now: string,
  zone: string,
): { readonly label: string; readonly tone: 'danger' | 'warning' | 'neutral' } | null {
  if (item.due === null) return null;
  const today = dayIn(now, zone);
  const days = Math.round(
    (Date.parse(`${item.due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  const decide = item.dueVerb === 'decide';
  if (days < 0)
    return {
      label: t('inbox.time.overdue_d', 'Overdue {{String}}d', { String: String(-days) }),
      tone: 'danger',
    };
  if (days === 0)
    return {
      label: decide
        ? t('inbox.time.decide_today', 'Decide today')
        : t('inbox.time.due_today', 'Due today'),
      tone: 'warning',
    };
  if (days === 1)
    return {
      label: decide
        ? t('inbox.time.decide_by_tomorrow', 'Decide by tomorrow')
        : t('inbox.time.due_tomorrow', 'Due tomorrow'),
      tone: 'warning',
    };
  return { label: `${decide ? 'Decide by' : 'Due'} ${shortDay(item.due)}`, tone: 'neutral' };
}
