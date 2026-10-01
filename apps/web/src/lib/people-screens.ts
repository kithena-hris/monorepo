import 'server-only';

import { currentTenant } from './branding';
import { people, type PeopleAnswer } from './people';
import type { OperationName } from './people-operations';
import { VIEWS } from './people-views';
import { conditionsOf, directoryQuery } from './url-state';

/**
 * The data each People screen is drawn from, fetched here, on the server,
 * before the page is sent (PEO-098), through the router (PEO-113).
 *
 * The remote draws; the shell fetches (`docs/build-plan.md`, "Remotes are
 * dumb"). One read per route, as the person signed in, and the answer handed
 * to the screen as its `Loadable`. The shell does not look inside beyond
 * putting a record's keyed list back into an object (`people-views.ts`): a
 * field People withheld is absent from what arrives, so it cannot reach the
 * HTML.
 */

export type ScreenLoad =
  | {
      readonly status: 'ready';
      readonly data: unknown;
      /**
       * What the address asked for and People refused, when the screen is shown
       * without it (`orBare`): said above the page, not swallowed.
       */
      readonly notice?: string;
    }
  | {
      readonly status: 'error';
      readonly message: string;
      /** People's code for it: `SCHEMA_NOT_PUBLISHED` is a tenant not set up yet. */
      readonly code?: string;
      /** Nothing answered at the router's address: the VM may be asleep. */
      readonly unreachable?: true;
    }
  /** Nothing to fetch: the screen starts from its own first state. */
  | { readonly status: 'none' };

export interface ScreenQuery {
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
}

/** One screen's read, and how its answer becomes the view model the remote draws. */
async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
  view: (data: never) => unknown = (data) => data,
): Promise<ScreenLoad> {
  const answer = await people<never>(name, variables);
  return answer.ok
    ? { status: 'ready', data: view(answer.data) }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

/**
 * Nothing published yet. The import's template is the cheapest read that
 * says so: a header row, HR's as importing is, refused until setup is done.
 */
const notSetUp = (load: ScreenLoad): boolean =>
  load.status === 'error' && load.code === 'SCHEMA_NOT_PUBLISHED';

/** Today in UTC, as a calendar date. The tenant's own calendar is People's to apply. */
const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * An answer that crosses as JSON text, read back (or, read as nothing, an
 * object nothing on the screen will draw); under `key` when one is given.
 */
const json =
  (key?: string) =>
  (data: never): unknown => {
    let value: unknown = null;
    try {
      value = JSON.parse(data) as unknown;
    } catch {
      value = null;
    }
    return key === undefined ? value : { [key]: value };
  };

/** A query-string value, or null for one that was not given. */
const given = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** A calendar date from the address, or null for anything else. */
const dateOf = (value: string | undefined): string | null =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

/**
 * A read narrowed by the address, or, where People refuses what the address
 * asked for, the same read without it. A link made by somebody who may see
 * more (a column this viewer cannot read, a segment not shared with them) or
 * a stale cursor opens the screen as its bare address shows it, not an error.
 * Only an unreachable People is left as it came.
 */
async function orBare<V extends Record<string, unknown>>(
  asked: V,
  run: (narrowing: V) => Promise<ScreenLoad>,
): Promise<ScreenLoad> {
  const first = await run(asked);
  const narrowed = Object.values(asked).some((v) => v !== null);
  if (first.status !== 'error' || first.unreachable === true || !narrowed) return first;
  const bare = await run(Object.fromEntries(Object.keys(asked).map((k) => [k, null])) as V);
  return bare.status === 'ready' ? { ...bare, notice: first.message } : first;
}

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  switch (component) {
    case 'Directory':
      return orBare(directoryQuery(query.search), (asked) =>
        read('Directory', asked, VIEWS.Directory),
      );
    case 'OrgChart':
      return orgChart();
    case 'Profile':
      return read('Profile', { personId: query.params['id'] ?? null }, VIEWS.Profile);
    case 'PersonHistory':
      return orBare({ asOf: dateOf(query.search['asOf']) }, (asked) =>
        read('History', { personId: query.params['id'] ?? null, ...asked }, VIEWS.PersonHistory),
      );
    case 'Onboarding':
      return read('Onboarding', {}, VIEWS.Onboarding);
    case 'BulkEdit':
      return read(
        'BulkEdit',
        { personIds: (query.search['people'] ?? '').split(',').filter((id) => id !== '') },
        VIEWS.BulkEdit,
      );
    case 'CompletenessGrid': {
      // Beside the grid, analytics' own figure: complete overall. By section is Insights'.
      const [grid, analytics] = await Promise.all([
        orBare({ after: given(query.search['after']) }, (asked) => read('Completeness', asked)),
        people<{
          complete: {
            percent: number;
            incomplete: number;
            change: number | null;
            trend: { label: string; value: number }[];
          } | null;
        }>('Analytics', {
          segment: null,
        }),
      ]);
      if (grid.status !== 'ready' || !analytics.ok) return grid;
      return {
        status: 'ready',
        data: { ...(grid.data as object), complete: analytics.data.complete },
      };
    }
    case 'ImportExport': {
      // Importing stays HR's, as it was. The history is HR's and People
      // administrators': one People refuses this viewer is left out, not an error.
      const before = given(query.search['before']);
      const [roles, history, template] = await Promise.all([
        read('Home'),
        orBare({ before }, (asked) => read('TransferHistory', asked)),
        read('ImportTemplate'),
      ]);
      if (roles.status !== 'ready') return roles;
      return {
        status: 'ready',
        data: {
          canImport: (roles.data as { hr?: boolean }).hr === true,
          setUp: !notSetUp(template),
          history:
            history.status === 'ready'
              ? { ...(history.data as object), paged: before !== null }
              : null,
          now: new Date().toISOString(),
        },
      };
    }
    case 'ImportFlow': {
      // Whether there is anything to import against yet, and who could set it up.
      const [roles, template] = await Promise.all([read('Home'), read('ImportTemplate')]);
      return {
        status: 'ready',
        data: {
          setUp: !notSetUp(template),
          admin: roles.status === 'ready' && (roles.data as { admin?: boolean }).admin === true,
        },
      };
    }
    case 'FieldRegistry':
      return read('Registry');
    case 'Integrations': {
      // Chat apps beside the rest; a chat service that is down hides its section, not the page.
      const [integrations, chat] = await Promise.all([read('Integrations'), read('Chat')]);
      if (integrations.status !== 'ready') return integrations;
      return {
        status: 'ready',
        data: {
          ...(integrations.data as Record<string, unknown>),
          ...(chat.status === 'ready' ? { chat: chat.data } : {}),
        },
      };
    }
    case 'RoleSettings':
      return read('RoleSettings');
    case 'PeopleHome':
      return overview();
    case 'Organisation':
      return read('Organisation');
    case 'PeopleSettings':
      return settingsOverview();
    case 'ReminderSettings':
      return reminderSettings();
    case 'CountryPacks': {
      const [setup, organisation] = await Promise.all([read('Setup'), read('Organisation')]);
      if (setup.status !== 'ready') return setup;
      const { packs } = setup.data as { packs: unknown[] };
      const entities =
        organisation.status === 'ready'
          ? (organisation.data as { legalEntities: unknown[] }).legalEntities
          : [];
      return { status: 'ready', data: { packs, entities } };
    }
    case 'FullValues':
      return read('FullValues');
    case 'IdentifierReviews':
      return read('IdentifierReviews');
    case 'Approvals':
      return read('Approvals', {}, VIEWS.Approvals);
    case 'Duplicates':
      return orBare({ a: given(query.search['a']), b: given(query.search['b']) }, (asked) =>
        read('Duplicates', asked),
      );
    case 'WebhookLog':
      return orBare({ after: given(query.search['after']) }, (asked) =>
        read('WebhookDeliveries', { endpointId: query.params['id'] ?? '', ...asked }),
      );
    case 'ReportSchedules':
      return read('ReportSchedules');
    case 'ReportRuns':
      return read('ReportRuns', { id: query.params['id'] ?? '' });
    case 'ExportBuilder': {
      // The directory's conditions, from its Export button or an export
      // described in words: one more audience, or the bare builder with a notice.
      const builder = await orBare(
        {
          conditions: conditionsOf(query.search['conditions']),
          match: query.search['match'] === 'any' ? ('any' as const) : null,
        },
        (asked) => read('ExportBuilder', asked),
      );
      // A scheduled report's email links here with its export (PEO-069).
      const id = given(query.search['export']);
      if (builder.status !== 'ready' || id === null) return builder;
      const ready = await people<object>('ScheduledExport', { id });
      return {
        status: 'ready',
        data: {
          ...(builder.data as object),
          // Somebody else's, or gone: said as such, never as an error page.
          ready: ready.ok ? ready.data : { status: 'missing', links: [], expiresAt: null },
        },
      };
    }
    case 'Analytics': {
      // Every tab reads the same answer; the schedules behind its button come
      // beside it, and one People refuses this viewer is left out.
      const [analytics, schedules] = await Promise.all([
        orBare({ segment: given(query.search['segment']) }, (asked) =>
          read('Analytics', asked, VIEWS.Analytics),
        ),
        read('ReportSchedules'),
      ]);
      if (analytics.status !== 'ready') return analytics;
      return {
        status: 'ready',
        data: {
          ...(analytics.data as object),
          schedules: schedules.status === 'ready' ? schedules.data : null,
        },
      };
    }
    case 'WhatChanged': {
      // A summary somebody sent: theirs to open, and nothing else on the page.
      const shared = given(query.search['shared']);
      if (shared !== null) return read('SharedSummary', { id: shared }, json('shared'));
      const [summary, schedules] = await Promise.all([
        orBare(
          {
            period: given(query.search['period']),
            from: dateOf(query.search['from']),
            to: dateOf(query.search['to']),
            segment: given(query.search['segment']),
          },
          (asked) => read('WhatChanged', asked, json()),
        ),
        read('ReportSchedules'),
      ]);
      if (summary.status !== 'ready') return summary;
      return {
        ...summary,
        data: {
          ...(summary.data as object),
          schedules: schedules.status === 'ready' ? schedules.data : null,
        },
      };
    }
    case 'PeopleSetup': {
      const loaded = await read('Setup', {}, VIEWS.PeopleSetup);
      if (loaded.status !== 'ready') return loaded;
      const data = loaded.data as { legalEntity?: { name: string; country: string } };
      if (data.legalEntity !== undefined) return loaded;
      // No legal entity in People yet: suggest the company as the back office
      // recorded it, for the admin to confirm.
      const tenant = await currentTenant();
      const country = tenant?.location?.country ?? '';
      return {
        status: 'ready',
        data: {
          ...data,
          legalEntity: {
            name: tenant?.branding.displayName ?? tenant?.slug ?? '',
            // A code, or nothing for the administrator to pick: never a guess.
            country: /^[A-Z]{2}$/.test(country) ? country : '',
          },
        },
      };
    }
    default:
      return { status: 'none' };
  }
}

export { today };

/** How many directory pages the org chart reads: 40 of 50, two thousand people. */
const CHART_PAGES = 40;

type ChartRow = DirectoryRow & {
  readonly people?: readonly { readonly key: string; readonly id: string; readonly name: string }[];
};

/**
 * Everybody this viewer may see, with their manager, for the org chart: the
 * directory, page after page, as People answers it (PEO-117). The manager is
 * the person column People resolves; a viewer who may not read it gets a
 * chart of roots, which says so by being flat rather than guessing.
 */
async function orgChart(): Promise<ScreenLoad> {
  const found: unknown[] = [];
  let after: string | null = null;
  for (let page = 0; page < CHART_PAGES; page += 1) {
    // Each page needs the cursor of the one before.
    const answer: PeopleAnswer<{ people: ChartRow[]; next: string | null }> = await people(
      'Directory',
      {
        after,
        sort: 'name:asc',
      },
    );
    if (!answer.ok) {
      if (page > 0) return { status: 'ready', data: { people: found, truncated: true } };
      return answer.code === 'UNREACHABLE'
        ? { status: 'error', message: answer.message, unreachable: true }
        : { status: 'error', message: answer.message, code: answer.code };
    }
    const value = (p: ChartRow, key: string) => {
      const v = p.values.find((x) => x.key === key)?.value;
      return v === undefined || v === '' ? null : v;
    };
    for (const p of answer.data.people) {
      const manager = p.people?.find((r) => r.key === 'manager_id');
      found.push({
        id: p.id,
        name: p.name,
        title: value(p, 'job_title'),
        managerId: manager?.id ?? null,
        managerName: manager?.name ?? null,
        avatarUrl: p.avatarUrl,
        status: value(p, 'status'),
        team: value(p, 'department'),
        location: value(p, 'location_id'),
      });
    }
    after = answer.data.next;
    if (after === null) return { status: 'ready', data: { people: found, truncated: false } };
  }
  return { status: 'ready', data: { people: found, truncated: true } };
}

/** A person on a directory page, as People answers one. */
interface DirectoryRow {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly values: readonly { readonly key: string; readonly value: string }[];
  readonly missing: number | null;
}

/**
 * The overview, and for HR the figures beside it (W2): headcount and complete
 * records from analytics, how many identifiers, duplicates and access
 * requests wait, and who is starting. Each read is People's own, as the
 * person signed in; one People refuses is left out of the figures rather
 * than failing the page.
 */
async function overview(): Promise<ScreenLoad> {
  const base = await read('Overview');
  if (base.status !== 'ready') return base;
  const data = base.data as { roles?: { hr?: boolean } };
  if (data.roles?.hr !== true) return base;
  const [analytics, ids, dupes, access, starting] = await Promise.all([
    people<{
      headcount: {
        value: number;
        change: number | null;
        trend: { label: string; value: number }[];
      };
      complete: { percent: number; incomplete: number } | null;
      expiringIn90Days: number | null;
      joiners: { months: string[]; cells: { row: string; column: string; value: number }[] } | null;
    }>('Analytics', { segment: null }),
    people<{ items: unknown[] }>('IdentifierReviews'),
    people<{ items: unknown[] }>('Duplicates', { a: null, b: null }),
    people<{ requests: { state: string }[] }>('FullValues'),
    people<{ people: DirectoryRow[] }>('Directory', {
      conditions: [{ key: 'status', op: 'is', values: ['pre_hire'] }],
      sort: 'hire_date:asc',
    }),
  ]);
  const a = analytics.ok ? analytics.data : null;
  const joiners =
    a?.joiners == null
      ? []
      : a.joiners.months.map((month) => ({
          label: month,
          value:
            a.joiners?.cells.filter((c) => c.column === month).reduce((n, c) => n + c.value, 0) ??
            0,
        }));
  const value = (p: DirectoryRow, key: string) => p.values.find((v) => v.key === key)?.value;
  return {
    status: 'ready',
    data: {
      ...(base.data as object),
      hr: {
        headcount: a?.headcount ?? null,
        complete: a?.complete ?? null,
        expiring: a?.expiringIn90Days ?? null,
        identifiers: ids.ok ? ids.data.items.length : null,
        duplicates: dupes.ok ? dupes.data.items.length : null,
        accessRequests: access.ok
          ? access.data.requests.filter((r) => r.state === 'pending').length
          : null,
        joiners,
        starting: (starting.ok ? starting.data.people : []).slice(0, 5).map((p) => ({
          id: p.id,
          name: p.name,
          avatarUrl: p.avatarUrl,
          detail: [value(p, 'job_title'), value(p, 'hire_date')]
            .filter((x) => x !== undefined && x !== '')
            .join(' · '),
          missing: p.missing,
        })),
      },
    },
  };
}

/**
 * Completeness and reminders (S20): the reminder rule People runs today
 * (the day a detail goes missing, then weekly, in working hours), whether the
 * chat notice for it is on, and the reporting floor from the organisation.
 * The HR digest and the directory policy have no source yet and are left out.
 */
async function reminderSettings(): Promise<ScreenLoad> {
  const [organisation, chat] = await Promise.all([read('Organisation'), read('Chat')]);
  if (organisation.status !== 'ready') return organisation;
  const org = organisation.data as { canManage: boolean; settings: { cohortMinimum: number } };
  const chatData =
    chat.status === 'ready'
      ? (chat.data as {
          apps: { connection: unknown }[];
          notices: { key: string; on: boolean }[];
        })
      : null;
  const inChat =
    chatData !== null &&
    chatData.apps.some((a) => a.connection !== null) &&
    chatData.notices.some((n) => n.key === 'profile_reminder' && n.on);
  return {
    status: 'ready',
    data: {
      canManage: org.canManage,
      cohortMinimum: org.settings.cohortMinimum,
      reminders: {
        cadence: 'The day a detail goes missing, then once a week',
        window: '09:00 to 18:00, on their own clock',
        inChat,
      },
    },
  };
}

/**
 * People's settings read back for the Settings page: the four screens' own
 * queries, side by side. Each one People refuses this viewer (Employee fields
 * and Integrations are its administrators', Roles HR's) is left out rather
 * than failing the page; only an unreachable People is an error.
 */
export async function settingsOverview(): Promise<ScreenLoad> {
  const parts = await Promise.all([
    read('Registry'),
    read('Organisation'),
    read('RoleSettings'),
    read('Integrations'),
  ]);
  const down = parts.find((p) => p.status === 'error' && p.unreachable === true);
  if (down !== undefined) return down;
  const [fields, organisation, roles, integrations] = parts.map((p) =>
    p.status === 'ready' ? p.data : null,
  );
  return { status: 'ready', data: { fields, organisation, roles, integrations } };
}
