import { conditionsOf, oneOf } from './url-state';

/**
 * The export page's state, in its address (design AI13): the sentence, what
 * it was read as, whom it goes to, and how. A link opens the same export, a
 * refresh keeps it, Back undoes a change. Every value comes from somebody's
 * address bar, so each is checked and a garbled one is its default; People
 * checks everything again.
 */

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';
export type SendMode = 'download' | 'send' | 'schedule';

export interface ExportAddress {
  /** The sentence the export was described in. */
  readonly q: string | null;
  /** Who read it: the assistant, or People's own rules. */
  readonly read: 'assistant' | 'rules' | null;
  /** `everyone`, `segment:<id>` or `conditions`. */
  readonly who: string | null;
  readonly fields: readonly string[] | null;
  readonly asOf: string | null;
  readonly format: ExportFormat | null;
  readonly photos: boolean;
  readonly reason: string | null;
  /** The recipient's account. */
  readonly to: string | null;
  readonly send: SendMode | null;
  /** The builder by hand, open. */
  readonly hand: boolean;
}

const READERS = ['assistant', 'rules'] as const;
const FORMATS = ['xlsx', 'csv', 'pdf'] as const;
const MODES = ['download', 'send', 'schedule'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

const text = (raw: string | undefined, max: number): string | null => {
  const v = raw?.trim() ?? '';
  return v === '' ? null : v.slice(0, max);
};

export function exportAddressOf(
  search: Readonly<Record<string, string | undefined>>,
): ExportAddress {
  const fields = (search['fields'] ?? '').split(',').filter((k) => KEY.test(k));
  const to = search['to'] ?? '';
  return {
    q: text(search['q'], 300),
    read: oneOf(search['read'], READERS, null),
    who: text(search['who'], 80),
    fields: fields.length === 0 ? null : fields,
    asOf: DATE.test(search['asOf'] ?? '') ? (search['asOf'] ?? null) : null,
    format: oneOf(search['format'], FORMATS, null),
    photos: search['photos'] === 'true',
    reason: text(search['reason'], 500),
    to: UUID.test(to) ? to : null,
    send: oneOf(search['send'], MODES, null),
    hand: search['hand'] === '1',
  };
}

/** What People's share routes take: the builder's choices (`application/export/share.ts`). */
export interface ShareChoice {
  readonly format: ExportFormat;
  readonly fields: readonly string[];
  readonly asOf?: string;
  readonly segmentId?: string;
  readonly conditions?: readonly { key: string; op: string; values: string[] }[];
  readonly match?: 'all' | 'any';
  readonly filter?: string;
  readonly reason?: string;
}

/**
 * The choice the address describes, of what the builder offers: the fields
 * asked for that are offered (all of them when none are), the audience, the
 * date and the format. `audience` is the builder's own words for who.
 */
export function shareChoiceOf(
  search: Readonly<Record<string, string | undefined>>,
  offered: readonly string[],
  audience: string | undefined,
): ShareChoice {
  const a = exportAddressOf(search);
  const asked = offered.filter((k) => a.fields?.includes(k) === true);
  const conditions = a.who === 'conditions' ? conditionsOf(search['conditions']) : null;
  const segment = a.who?.startsWith('segment:') === true ? a.who.slice('segment:'.length) : '';
  return {
    format: a.format ?? 'xlsx',
    fields: asked.length > 0 ? asked : offered,
    ...(a.asOf === null ? {} : { asOf: a.asOf }),
    ...(UUID.test(segment) ? { segmentId: segment } : {}),
    ...(conditions === null
      ? {}
      : { conditions, match: search['match'] === 'any' ? ('any' as const) : ('all' as const) }),
    ...(audience === undefined ? {} : { filter: audience }),
    ...(a.reason === null ? {} : { reason: a.reason }),
  };
}

/**
 * A scheduled report's audience from a choice: a saved view, everybody, or
 * conditions that are each one field equal to one value — the only filter a
 * schedule takes (PEO-069). Null when the conditions say more than that.
 */
export function scheduleAudienceOf(
  choice: ShareChoice,
): { segmentId: string | null; filter: { key: string; value: string }[] } | null {
  if (choice.segmentId !== undefined) return { segmentId: choice.segmentId, filter: [] };
  const conditions = choice.conditions ?? [];
  if (conditions.length > 1 && choice.match === 'any') return null;
  const filter: { key: string; value: string }[] = [];
  for (const c of conditions) {
    const value = c.values[0];
    if (!(c.op === 'is' || c.op === 'in') || c.values.length !== 1 || value === undefined) {
      return null;
    }
    filter.push({ key: c.key, value });
  }
  return { segmentId: null, filter };
}
