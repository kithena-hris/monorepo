import 'server-only';

import { currentTenant } from './branding';
import { people, type PeopleAnswer } from './people';
import type { OperationName } from './people-operations';
import { VIEWS } from './people-views';
import { exportAddressOf, shareChoiceOf } from './export-address';
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

/**
 * The company's import running now, or null: none, not this viewer's to
 * see, or a People that cannot say. Import waits while there is one.
 */
async function activeImport(): Promise<unknown> {
  const answer = await read('ActiveImportRun', {}, json());
  return answer.status === 'ready' ? answer.data : null;
}

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
    case 'Directory': {
      // Beside the people, the import running now: Import waits for it.
      const [directory, running] = await Promise.all([
        orBare(directoryQuery(query.search), (asked) => read('Directory', asked, VIEWS.Directory)),
        activeImport(),
      ]);
      return directory.status === 'ready' && running !== null
        ? { ...directory, data: { ...(directory.data as object), activeImport: running } }
        : directory;
    }
    case 'OrgChart':
      // Everybody, with their manager, in one read: People's, not forty directory pages.
      return read('OrgChart');
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
    case 'ImportExport': {
      // Importing stays HR's, as it was. The history is HR's and People
      // administrators', read beside the rest so the first HTML holds it:
      // the page is drawn once, whole, with no rows still to come. One
      // People refuses this viewer is left out, not an error.
      const before = given(query.search['before']);
      // `Home` is the shell's own read of the roles (`shellData`), shared.
      const [roles, template, running, history] = await Promise.all([
        read('Home'),
        read('ImportTemplate'),
        activeImport(),
        orBare({ before }, (asked) => read('TransferHistory', asked)).then((answer) =>
          answer.status === 'ready' ? { ...(answer.data as object), paged: before !== null } : null,
        ),
      ]);
      if (roles.status !== 'ready') return roles;
      const { hr = false, admin = false } = roles.data as { hr?: boolean; admin?: boolean };
      return {
        status: 'ready',
        data: {
          canImport: hr,
          setUp: !notSetUp(template),
          history: hr || admin ? history : null,
          now: new Date().toISOString(),
          activeImport: running,
        },
      };
    }
    case 'ImportFlow': {
      // Whether there is anything to import against yet, and who could set it up;
      // and the run the address names (`?run=`), else the one that keeps a new upload waiting.
      const runId = given(query.search['run']);
      const [roles, template, run, running] = await Promise.all([
        read('Home'),
        read('ImportTemplate'),
        runId === null ? null : read('ImportRun', { id: runId }, json()),
        runId === null ? activeImport() : null,
      ]);
      if (run !== null && run.status !== 'ready') return run;
      return {
        status: 'ready',
        data: {
          setUp: !notSetUp(template),
          admin: roles.status === 'ready' && (roles.data as { admin?: boolean }).admin === true,
          ...(run === null ? { activeImport: running } : { run: run.data }),
        },
      };
    }
    case 'FieldRegistry':
      return read('Registry');
    case 'FieldChange':
      return read(
        'FieldChange',
        { field: query.params['key'] ?? '', to: given(query.search['to']) },
        json(),
      );
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
      return organisation();
    case 'PeopleSettings':
      return settingsOverview();
    case 'Review':
      return review(query.search);
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
      if (builder.status !== 'ready') return builder;
      return { status: 'ready', data: await exportExtras(builder.data, query.search) };
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
      if (shared !== null) {
        const found = await read('SharedSummary', { id: shared }, json('shared'));
        // Gone, or not theirs: the page says so, rather than an error to retry.
        return found.status === 'error' && found.code === 'NOT_FOUND'
          ? { status: 'ready', data: { shared: null } }
          : found;
      }
      const period = {
        period: given(query.search['period']),
        from: dateOf(query.search['from']),
        to: dateOf(query.search['to']),
        segment: given(query.search['segment']),
      };
      // The period as the screen asks it, without what the address left out.
      const ask = Object.fromEntries(Object.entries(period).filter(([, v]) => v !== null));
      // The follow-up and the export dialog in the address are answered here,
      // so the first HTML shows the answer and the draft, not a wait for them.
      const question = given(query.search['ask']);
      const share = query.search['share'];
      const exporting =
        share === 'pdf' || share === 'email'
          ? {
              recipient: given(query.search['for']),
              tone: query.search['tone'] === 'detailed' ? 'detailed' : 'short',
              charts: query.search['charts'] !== 'off',
              madeLine: query.search['made'] !== 'off',
            }
          : null;
      const answered = (answer: PeopleAnswer<string>) =>
        answer.ok ? (jsonOf(answer) ?? 'People could not be asked') : answer.message;
      const [summary, schedules, followUp, draft] = await Promise.all([
        orBare(period, (asked) => read('WhatChanged', asked, json())),
        read('ReportSchedules'),
        question === null
          ? null
          : people<string>('WhatChangedAsk', { input: JSON.stringify({ ...ask, question }) }),
        exporting === null
          ? null
          : people<string>('SummaryDraft', {
              input: JSON.stringify({
                ...ask,
                tone: exporting.tone,
                charts: exporting.charts,
                madeLine: exporting.madeLine,
                ...(exporting.recipient === null ? {} : { recipient: exporting.recipient }),
                edits: [],
              }),
            }),
      ]);
      if (summary.status !== 'ready') return summary;
      return {
        ...summary,
        data: {
          ...(summary.data as object),
          schedules: schedules.status === 'ready' ? schedules.data : null,
          ...(followUp === null || question === null
            ? {}
            : { answered: { question, result: answered(followUp) } }),
          ...(draft === null || exporting === null
            ? {}
            : { drafted: { ...exporting, result: answered(draft) } }),
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

/** JSON text from People, read back; null for an answer that is not JSON. */
const jsonOf = (answer: PeopleAnswer<string>): unknown => {
  if (!answer.ok) return null;
  try {
    return JSON.parse(answer.data) as unknown;
  } catch {
    return null;
  }
};

/**
 * The export page beside the builder (design AI13, AI14): whom the export in
 * the address would go to and what they could not read, the finished export
 * a link opened it with (a sent file's email, a scheduled report's, the
 * history), and a request to send one waiting for approval. Somebody else's
 * or gone is said as such, never as an error page.
 */
async function exportExtras(
  data: unknown,
  search: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
  const builder = data as {
    who: readonly { value: string; label: string }[];
    sections: readonly { fields: readonly { key: string }[] }[];
  };
  const offered = builder.sections.flatMap((s) => s.fields.map((f) => f.key));
  const address = exportAddressOf(search);
  const audience = builder.who.find((w) => w.value === (address.who ?? 'everyone'))?.label;
  const choice = shareChoiceOf(search, offered, audience);
  const exportId = given(search['export']);
  const shareId = given(search['share']);
  const [preview, record, share] = await Promise.all([
    offered.length === 0
      ? null
      : people<string>('ExportSharePreview', {
          input: JSON.stringify({
            choice,
            ...(address.to === null ? {} : { recipient: address.to }),
            ...(address.q === null ? {} : { sentence: address.q }),
          }),
        }),
    exportId === null ? null : people<string>('ExportRecord', { id: exportId }),
    shareId === null ? null : people<string>('ExportShare', { id: shareId }),
  ]);
  return {
    ...(data as object),
    preview: preview === null ? null : jsonOf(preview),
    ...(record === null ? {} : { record: jsonOf(record) ?? { status: 'missing' } }),
    ...(share === null ? {} : { share: jsonOf(share) ?? { state: 'missing' } }),
  };
}

/**
 * Review (design E1–E13): every queue a decision waits in, read at once as
 * the viewer, so the page arrives whole with the item the address names
 * already open. HR's queues only for HR (and finance's requests for
 * finance); one People refuses this viewer is null on the page rather than
 * failing it. Only an unreachable People is the page's error.
 *
 * The address chooses what else is read: a pair to compare (`?item=dup-a~b`),
 * the request to send an export an email linked to (`?item=export-…`, when it
 * is not one this viewer decides), and the page of missing details (`?after=`).
 */
async function review(search: Readonly<Record<string, string>>): Promise<ScreenLoad> {
  const item = given(search['item']);
  const pair = item?.startsWith('dup-') === true ? item.slice(4).split('~') : null;
  const shareId = item?.startsWith('export-') === true ? item.slice(7) : null;
  const approvals = read('Approvals', {}, VIEWS.Approvals);
  const roles = await people<{ hr?: boolean; admin?: boolean; finance?: boolean }>('Home');
  if (!roles.ok) {
    return roles.code === 'UNREACHABLE'
      ? { status: 'error', message: roles.message, unreachable: true }
      : { status: 'error', message: roles.message, code: roles.code };
  }
  const hr = roles.data.hr === true;
  const finance = roles.data.finance === true;
  const ready = (load: ScreenLoad | null): unknown => (load?.status === 'ready' ? load.data : null);
  const admin = roles.data.admin === true;
  const [changes, identifiers, duplicates, fullValues, completeness, analytics, share, shares] =
    await Promise.all([
      approvals,
      hr ? read('IdentifierReviews') : null,
      hr
        ? orBare({ a: pair?.[0] ?? null, b: pair?.[1] ?? null }, (asked) =>
            read('Duplicates', asked),
          )
        : null,
      hr || finance ? read('FullValues') : null,
      hr ? orBare({ after: given(search['after']) }, (asked) => read('Completeness', asked)) : null,
      // Complete records overall, analytics' own figure, beside the missing details.
      hr ? people<{ complete: unknown }>('Analytics', { segment: null }) : null,
      shareId === null ? null : people<string>('ExportShare', { id: shareId }),
      // The requests to send an export waiting for this administrator (E5).
      admin ? people<string>('ExportSharesToDecide') : null,
    ]);
  const down = [changes, identifiers, duplicates, fullValues, completeness].find(
    (l) => l?.status === 'error' && l.unreachable === true,
  );
  if (down != null) return down;
  const missing = ready(completeness);
  return {
    status: 'ready',
    data: {
      now: new Date().toISOString(),
      roles: { hr, finance, admin },
      approvals: ready(changes),
      identifiers: ready(identifiers),
      duplicates: ready(duplicates),
      fullValues: ready(fullValues),
      completeness:
        missing === null
          ? null
          : {
              ...(missing as object),
              complete: analytics?.ok === true ? analytics.data.complete : null,
            },
      shares: shares === null ? null : ((jsonOf(shares) as unknown[] | null) ?? null),
      // Somebody else's or gone: said as such in its pane, never as an error page.
      share:
        share === null
          ? null
          : ((jsonOf(share) as object | null) ?? { state: 'missing', id: shareId }),
    },
  };
}

/** A person on a directory page, as People answers one. */
interface DirectoryRow {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly values: readonly { readonly key: string; readonly value: string }[];
  readonly missing: number | null;
}

/** The reads beside HR's overview, all at once. */
function hrFigures() {
  return Promise.all([
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
    // The shell's own count of them (`shellData`), shared.
    people<{
      identifiers: number | null;
      duplicates: number | null;
      accessRequests: number | null;
    }>('Waiting'),
    people<{ people: DirectoryRow[] }>('Directory', {
      conditions: [{ key: 'status', op: 'is', values: ['pre_hire'] }],
      sort: 'hire_date:asc',
    }),
  ]);
}

/**
 * The overview, and for HR the figures beside it (W2): headcount and complete
 * records from analytics, how many identifiers, duplicates and access
 * requests wait, and who is starting. Each read is People's own, as the
 * person signed in; one People refuses is left out of the figures rather
 * than failing the page.
 */
async function overview(): Promise<ScreenLoad> {
  // HR's figures are asked as soon as the roles say HR (the shell asks for
  // them too, and one answer serves both), not after the slower overview.
  const early = people<{ hr?: boolean }>('Home').then((home) =>
    home.ok && home.data.hr === true ? hrFigures() : null,
  );
  const base = await read('Overview');
  if (base.status !== 'ready') return base;
  const data = base.data as { roles?: { hr?: boolean } };
  if (data.roles?.hr !== true) return base;
  const [analytics, waiting, starting] = (await early) ?? (await hrFigures());
  const counted = waiting.ok ? waiting.data : null;
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
        identifiers: counted?.identifiers ?? null,
        duplicates: counted?.duplicates ?? null,
        accessRequests: counted?.accessRequests ?? null,
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
 * Organisation, every tab of it in one read (so moving between tabs fetches
 * nothing new): the organisation itself; the country packs, which are People
 * administrators' (`Setup` refuses anybody else, and the tab is left out);
 * and the reminder rule People runs today (the day a detail goes missing,
 * then weekly, in working hours), with whether its chat notice is on, beside
 * the reporting floor it shares a card with.
 */
async function organisation(): Promise<ScreenLoad> {
  const [org, setup, chat] = await Promise.all([read('Organisation'), read('Setup'), read('Chat')]);
  if (org.status !== 'ready') return org;
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
      ...(org.data as object),
      packs: setup.status === 'ready' ? (setup.data as { packs: unknown[] }).packs : null,
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
