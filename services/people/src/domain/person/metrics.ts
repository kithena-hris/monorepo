/**
 * What People can compute about a person and order the directory by, beside
 * the fields themselves: how much of their record is missing, how long they
 * have been here, how many people report to them. Each is a key the
 * directory's `?sort=` and conditions take like a field's, worked out in
 * Postgres over everybody, never over one page.
 *
 * `needs` is who may use one: HR (`hr`), or whoever reads every listed field
 * on everybody (a metric over the start date is the start date's to give).
 * `most` and `least` are the order in words, as a chip says it.
 */

export interface Metric {
  readonly key: string;
  readonly label: string;
  readonly kind: 'number' | 'date';
  readonly needs: 'hr' | readonly string[];
  /** Usable as a condition too ("more than 3 missing details"), not only as an order. */
  readonly filter: boolean;
  /** The order when none is said: most missing first, soonest expiry first. */
  readonly natural: 'asc' | 'desc';
  readonly most: string;
  readonly least: string;
}

/** The dated fields a document or a contract runs out on (`analytics/snapshot.ts`'s `EXPIRIES`). */
export const EXPIRY_KEYS = [
  'work_permit_expiry',
  'contract_end',
  'probation_end',
  'certification_expiry',
] as const;

export const METRICS: readonly Metric[] = [
  {
    key: 'missing_count',
    label: 'Missing details',
    kind: 'number',
    needs: 'hr',
    filter: true,
    natural: 'desc',
    most: 'most missing details',
    least: 'fewest missing details',
  },
  {
    // ponytail: ordered as the inverse of the missing count. A true percentage
    // needs each person's required count on the gap row; add it when a
    // screen shows the figure rather than the order.
    key: 'completeness',
    label: 'Completeness',
    kind: 'number',
    needs: 'hr',
    filter: false,
    natural: 'desc',
    most: 'most complete',
    least: 'least complete',
  },
  {
    key: 'tenure_days',
    label: 'Tenure (days)',
    kind: 'number',
    needs: ['hire_date'],
    filter: true,
    natural: 'desc',
    most: 'longest tenure',
    least: 'shortest tenure',
  },
  {
    key: 'direct_reports',
    label: 'Direct reports',
    kind: 'number',
    needs: ['manager_id'],
    filter: true,
    natural: 'desc',
    most: 'most direct reports',
    least: 'fewest direct reports',
  },
  {
    key: 'team_size',
    label: 'Team size',
    kind: 'number',
    needs: ['manager_id'],
    filter: true,
    natural: 'desc',
    most: 'biggest team',
    least: 'smallest team',
  },
  {
    key: 'pending_changes',
    label: 'Pending changes',
    kind: 'number',
    needs: 'hr',
    filter: true,
    natural: 'desc',
    most: 'most pending changes',
    least: 'fewest pending changes',
  },
  {
    key: 'next_expiry',
    label: 'Next expiry',
    kind: 'date',
    needs: EXPIRY_KEYS,
    filter: true,
    natural: 'asc',
    most: 'latest expiry',
    least: 'soonest expiry',
  },
  {
    key: 'updated_at',
    label: 'Last updated',
    kind: 'date',
    needs: 'hr',
    filter: false,
    natural: 'desc',
    most: 'most recently updated',
    least: 'least recently updated',
  },
];

export const metricOf = (key: string): Metric | undefined => METRICS.find((m) => m.key === key);

/**
 * Whether a viewer may order or narrow by a metric: HR's to HR, a field's to
 * whoever reads every one of its fields that exists, and at least one must.
 */
export function metricAllowed(
  metric: Metric,
  isHr: boolean,
  readable: (key: string) => boolean,
  defined: (key: string) => boolean,
): boolean {
  if (metric.needs === 'hr') return isHr;
  const present = metric.needs.filter(defined);
  return present.length > 0 && present.every(readable);
}
