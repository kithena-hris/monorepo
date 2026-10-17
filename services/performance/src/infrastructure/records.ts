import type { Tx, Where } from '../application/ports.js';

/**
 * Every aggregate is a row of `performance.record` (PRF-035): its kind, its
 * id, the few columns a query filters or constrains on, and its JSON. The
 * columns each kind fills are here, once, for the Postgres and the memory
 * stores alike; `key` is unique per kind, which is what makes creating a
 * review idempotent under a race (§8.7).
 */

export type Kind =
  | 'template'
  | 'cycle'
  | 'review'
  | 'nomination'
  | 'feedback'
  | 'request'
  | 'note'
  | 'goal'
  | 'item'
  | 'assignment'
  | 'automation'
  | 'calibration'
  | 'ai'
  | 'grant'
  | 'org_unit'
  | 'chart'
  | 'webhook'
  | 'chat_plan';

export interface Columns {
  readonly cycleId: string | null;
  readonly subjectId: string | null;
  readonly ownerId: string | null;
  readonly state: string | null;
  readonly key: string | null;
  readonly revision: number;
}

type V = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const none: Columns = {
  cycleId: null,
  subjectId: null,
  ownerId: null,
  state: null,
  key: null,
  revision: 0,
};

export const COLUMNS: Readonly<Record<Kind, (v: V) => Columns>> = {
  template: () => none,
  cycle: (v) => ({ ...none, state: s(v['state']) }),
  review: (v) => ({
    cycleId: s(v['cycleId']),
    subjectId: s(v['subjectId']),
    ownerId: s(v['authorId']),
    state: s(v['status']),
    key:
      v['cycleId'] === null
        ? null
        : `${s(v['cycleId']) ?? ''}:${s(v['kind']) ?? ''}:${s(v['subjectId']) ?? ''}:${s(v['authorId']) ?? ''}`,
    revision: typeof v['revision'] === 'number' ? v['revision'] : 0,
  }),
  nomination: (v) => ({
    ...none,
    cycleId: s(v['cycleId']),
    subjectId: s(v['subjectId']),
    ownerId: s(v['by']),
    state: s(v['state']),
  }),
  feedback: (v) => ({ ...none, subjectId: s(v['to']), ownerId: s(v['from']) }),
  request: (v) => ({ ...none, subjectId: s(v['about']), ownerId: s(v['from']) }),
  note: (v) => ({ ...none, subjectId: s(v['about']), ownerId: s(v['author']) }),
  goal: (v) => ({ ...none, ownerId: s(v['ownerId']), state: s(v['status']) }),
  item: () => none,
  assignment: (v) => ({
    ...none,
    ownerId: s(v['personId']),
    subjectId: s(v['itemId']),
    cycleId: s(v['cycleId']),
  }),
  automation: () => none,
  calibration: (v) => ({ ...none, cycleId: s(v['cycleId']), state: s(v['state']) }),
  ai: (v) => ({ ...none, ownerId: s(v['forPerson']) }),
  grant: () => none,
  org_unit: () => none,
  chart: (v) => ({ ...none, ownerId: s(v['owner']) }),
  webhook: (v) => ({ ...none, state: v['disabled'] === null ? 'on' : 'off' }),
  chat_plan: (v) => ({ ...none, ownerId: s(v['accountId']) }),
};

/** Which store on `Tx` holds which kind. */
export const STORES = {
  templates: 'template',
  cycles: 'cycle',
  reviews: 'review',
  nominations: 'nomination',
  feedback: 'feedback',
  requests: 'request',
  notes: 'note',
  goals: 'goal',
  items: 'item',
  assignments: 'assignment',
  automations: 'automation',
  calibrations: 'calibration',
  aiLog: 'ai',
  grants: 'grant',
  orgUnits: 'org_unit',
  charts: 'chart',
  webhooks: 'webhook',
  chatPlans: 'chat_plan',
} as const satisfies Partial<Record<keyof Tx, Kind>>;

/** Whether a row's columns satisfy a filter. */
export function fits(c: Columns, where: Where | undefined): boolean {
  if (where === undefined) return true;
  return (
    (where.cycleId === undefined || c.cycleId === where.cycleId) &&
    (where.subjectId === undefined || c.subjectId === where.subjectId) &&
    (where.ownerId === undefined || c.ownerId === where.ownerId) &&
    (where.state === undefined || c.state === where.state) &&
    (where.key === undefined || c.key === where.key)
  );
}
