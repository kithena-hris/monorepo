import { t } from './t';

/**
 * Settings › Activity, the company's central activity log (`docs/audit.md`):
 * what its address means, and what it asks the router for.
 *
 * Every filter is in the address, so a link opens the same view for whoever
 * follows it, and Back undoes a filter. Values come from anybody's address
 * bar, so each is checked here: anything garbled is as if it were not there.
 */

export const AREAS = [
  {
    value: 'fields',
    get label() {
      return t('lib.activity.employee_fields', 'Employee fields');
    },
  },
  {
    value: 'organisation',
    get label() {
      return t('lib.activity.organisation', 'Organisation');
    },
  },
  {
    value: 'roles',
    get label() {
      return t('lib.activity.roles', 'Roles');
    },
  },
  {
    value: 'integrations',
    get label() {
      return t('lib.activity.integrations', 'Integrations');
    },
  },
  {
    value: 'imports_exports',
    get label() {
      return t('lib.activity.imports_and_exports', 'Imports and exports');
    },
  },
  {
    value: 'sensitive_access',
    get label() {
      return t('lib.activity.sensitive_access', 'Sensitive access');
    },
  },
  {
    value: 'sign_in',
    get label() {
      return t('lib.activity.sign_in_and_support', 'Sign-in and support');
    },
  },
  {
    value: 'settings',
    get label() {
      return t('lib.activity.settings', 'Settings');
    },
  },
  {
    value: 'records',
    get label() {
      return t('lib.activity.records', 'Records');
    },
  },
  {
    value: 'access',
    get label() {
      return t('lib.activity.reads_and_exports', 'Reads and exports');
    },
  },
  {
    value: 'ai',
    get label(): string {
      return t('lib.activity.ai', 'AI');
    },
  },
] as const;
export type Area = (typeof AREAS)[number]['value'];

/** The areas a module's own activity falls in (`<module>.activity.recorded`). */
export const MODULE_AREAS: readonly Area[] = [
  'settings',
  'records',
  'access',
  'ai',
  'integrations',
];

/** Whose activity: every module that keeps a log, and identity's sign-ins. */
export const MODULES = [
  {
    value: 'people',
    get label() {
      return t('lib.activity.people', 'People');
    },
  },
  {
    value: 'identity',
    get label() {
      return t('lib.activity.sign_in', 'Sign-in');
    },
  },
  {
    value: 'timeoff',
    get label() {
      return t('lib.activity.time_off', 'Time Off');
    },
  },
  {
    value: 'documents',
    get label() {
      return t('lib.activity.documents', 'Documents');
    },
  },
  {
    value: 'recruiting',
    get label() {
      return t('lib.activity.recruiting', 'Recruiting');
    },
  },
  {
    value: 'onboarding',
    get label() {
      return t('lib.activity.onboarding', 'Onboarding');
    },
  },
  {
    value: 'performance',
    get label() {
      return t('lib.activity.performance', 'Performance');
    },
  },
] as const;
export type Module = (typeof MODULES)[number]['value'];

/** A module's name as a sentence says it. */
export const moduleName = (module: string): string =>
  MODULES.find((m) => m.value === module)?.label ?? module;

export const WHO = [
  {
    value: 'person',
    get label() {
      return t('lib.activity.people', 'People');
    },
  },
  {
    value: 'support',
    get label() {
      return t('lib.activity.kithena_support', 'Kithena support');
    },
  },
  {
    value: 'system',
    get label() {
      return t('lib.activity.system', 'System');
    },
  },
  {
    value: 'integration',
    get label() {
      return t('lib.activity.integrations', 'Integrations');
    },
  },
] as const;
export type Who = (typeof WHO)[number]['value'];

export interface ActivityFilters {
  /** One module's activity (`?module=`), as that module's own Activity log shows it. */
  readonly module: Module | null;
  readonly areas: readonly Area[];
  readonly by: Who | null;
  readonly actor: string | null;
  readonly subject: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly zone: string | null;
  readonly search: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/;

const text = (v: string | undefined): string | null =>
  v === undefined || v.trim() === '' ? null : v.trim().slice(0, 200);
const matching = (v: string | undefined, shape: RegExp): string | null =>
  v !== undefined && shape.test(v) ? v : null;

/**
 * The address's filters: `module`, `area` (comma-separated), `by`, `actor`, `subject`,
 * `from`, `to`, `tz` (the reader's zone, which the page adds with a date)
 * and `q`. Which page is not among them: the address opens the newest, and
 * older entries load as the reader scrolls.
 */
export function activityFilters(search: Readonly<Record<string, string>>): ActivityFilters {
  const known = new Set<string>(AREAS.map((a) => a.value));
  const areas = [...new Set((search['area'] ?? '').split(','))].filter((a): a is Area =>
    known.has(a),
  );
  const by = WHO.find((w) => w.value === search['by'])?.value ?? null;
  return {
    module: MODULES.find((m) => m.value === search['module'])?.value ?? null,
    areas,
    by,
    actor: matching(search['actor'], UUID),
    subject: text(search['subject'])?.slice(0, 64) ?? null,
    from: matching(search['from'], DAY),
    to: matching(search['to'], DAY),
    zone: matching(search['tz'], ZONE),
    search: text(search['q']),
  };
}

/** A cursor into the log (the last entry's id), or null for a garbled one. */
export const cursorOf = (before: string | null | undefined): string | null =>
  matching(before ?? undefined, UUID);

/** The router's variables for them, from `before`: an absent filter is left out, never sent empty. */
export function activityVariables(
  f: ActivityFilters,
  before: string | null = null,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      module: f.module,
      areas: f.areas.length === 0 ? null : f.areas,
      by: f.by,
      actor: f.actor,
      subject: f.subject,
      from: f.from,
      to: f.to,
      zone: f.zone,
      search: f.search,
      before: cursorOf(before),
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
  /** `refused` for an attempt the module turned down. */
  readonly outcome: string;
  /** The surface a module's act came from: Web, Phone, API, Slack, Ask Kithena. */
  readonly via: string | null;
  /** Proposed by AI and confirmed by the person. */
  readonly ai: boolean;
  readonly supportSignIn: {
    readonly entryId: string;
    readonly at: string;
    readonly reason: string | null;
  } | null;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  readonly next: string | null;
  /** How many entries the filters find over every page, on the first. Absent from an older log. */
  readonly total?: number | null;
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
  // Split by hand, not with one regular expression: a sentence boundary, then
  // ": " and " → " inside it, each found once, in time linear in the text.
  const found: { what: string; from: string; to: string }[] = [];
  for (const sentence of text.split(/\.(?=\s|$)/)) {
    const colon = sentence.indexOf(': ');
    if (colon === -1) continue;
    const arrow = sentence.indexOf(' → ', colon + 2);
    if (arrow === -1) continue;
    const what = sentence.slice(0, colon);
    if (/[.→]/.test(what)) continue;
    found.push({
      what: what.trim(),
      from: sentence.slice(colon + 2, arrow),
      to: sentence.slice(arrow + 3),
    });
  }
  return found.length === 0 ? null : found;
}
