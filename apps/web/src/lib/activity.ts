/**
 * Settings › Activity, the company's central activity log (`docs/audit.md`):
 * what its address means, and what it asks the router for.
 *
 * Every filter is in the address, so a link opens the same view for whoever
 * follows it, and Back undoes a filter. Values come from anybody's address
 * bar, so each is checked here: anything garbled is as if it were not there.
 */

export const AREAS = [
  { value: 'fields', label: 'Employee fields' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'roles', label: 'Roles' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'imports_exports', label: 'Imports and exports' },
  { value: 'sensitive_access', label: 'Sensitive access' },
  { value: 'sign_in', label: 'Sign-in and support' },
] as const;
export type Area = (typeof AREAS)[number]['value'];

/** People's settings: what its own "Activity log" opens filtered to. */
export const PEOPLE_SETTINGS: readonly Area[] = ['fields', 'organisation', 'roles', 'integrations'];

export const WHO = [
  { value: 'person', label: 'People' },
  { value: 'support', label: 'Kithena support' },
  { value: 'system', label: 'System' },
  { value: 'integration', label: 'Integrations' },
] as const;
export type Who = (typeof WHO)[number]['value'];

export interface ActivityFilters {
  readonly areas: readonly Area[];
  readonly by: Who | null;
  readonly actor: string | null;
  readonly subject: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly zone: string | null;
  readonly search: string | null;
  readonly before: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/;

const text = (v: string | undefined): string | null =>
  v === undefined || v.trim() === '' ? null : v.trim().slice(0, 200);
const matching = (v: string | undefined, shape: RegExp): string | null =>
  v !== undefined && shape.test(v) ? v : null;

/**
 * The address's filters: `area` (comma-separated), `by`, `actor`, `subject`,
 * `from`, `to`, `tz` (the reader's zone, which the page adds with a date),
 * `q` and `before`.
 */
export function activityFilters(search: Readonly<Record<string, string>>): ActivityFilters {
  const known = new Set<string>(AREAS.map((a) => a.value));
  const areas = [...new Set((search['area'] ?? '').split(','))].filter((a): a is Area =>
    known.has(a),
  );
  const by = WHO.find((w) => w.value === search['by'])?.value ?? null;
  return {
    areas,
    by,
    actor: matching(search['actor'], UUID),
    subject: text(search['subject'])?.slice(0, 64) ?? null,
    from: matching(search['from'], DAY),
    to: matching(search['to'], DAY),
    zone: matching(search['tz'], ZONE),
    search: text(search['q']),
    before: matching(search['before'], UUID),
  };
}

/** The router's variables for them: an absent filter is left out, never sent empty. */
export function activityVariables(f: ActivityFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      areas: f.areas.length === 0 ? null : f.areas,
      by: f.by,
      actor: f.actor,
      subject: f.subject,
      from: f.from,
      to: f.to,
      zone: f.zone,
      search: f.search,
      before: f.before,
    }).filter(([, v]) => v !== null),
  );
}

/** One entry, as the audit subgraph answers it. */
export interface ActivityEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly module: string;
  readonly area: string;
  readonly action: string;
  readonly detail: string | null;
  readonly actorKind: string;
  readonly actorAccountId: string | null;
  readonly onBehalfOf: string | null;
  /** The support operator's work address, from their sign-in. */
  readonly operatorLabel: string | null;
  readonly subjectKind: string | null;
  readonly subjectId: string | null;
  readonly subjectLabel: string | null;
  readonly reason: string | null;
  readonly supportSignIn: {
    readonly entryId: string;
    readonly at: string;
    readonly reason: string | null;
  } | null;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  readonly next: string | null;
}

/** The ids on a page that People can put a name and a face to. */
export function idsToName(page: ActivityPage): { accountIds: string[]; personIds: string[] } {
  const accounts = new Set<string>();
  const people = new Set<string>();
  for (const e of page.entries) {
    if (e.actorKind === 'person' && e.actorAccountId !== null) accounts.add(e.actorAccountId);
    if (e.subjectKind === 'account' && e.subjectId !== null) accounts.add(e.subjectId);
    if (e.subjectKind === 'person' && e.subjectId !== null) people.add(e.subjectId);
  }
  return { accountIds: [...accounts], personIds: [...people] };
}

/** "Seen by: HR → HR and their manager." as its parts; null for a plain sentence. */
export function changesIn(
  text: string,
): readonly { readonly what: string; readonly from: string; readonly to: string }[] | null {
  const found = [...text.matchAll(/([^:.→]+): (.*?) → (.*?)\.(?=\s|$)/g)].map((m) => ({
    what: (m[1] ?? '').trim(),
    from: m[2] ?? '',
    to: m[3] ?? '',
  }));
  return found.length === 0 ? null : found;
}
