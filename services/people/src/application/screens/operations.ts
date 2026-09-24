import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  PersonAttributeCorrected,
  PersonCompensationChanged,
  PersonHired,
  PersonJobChanged,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonProfileCompleted,
  PersonProfileIncomplete,
  PersonProfileUpdated,
  PersonProvisioned,
  PersonStatusChanged,
  PersonTerminated,
  SchemaPublished,
} from '@kithena/contracts';

import type { ListedDelivery, ListedEndpoint } from '../../infrastructure/webhooks/list.js';
import type { EndpointInput, WebhookService } from '../../infrastructure/webhooks/webhooks.js';
import { visibleTo } from '../../domain/access/field-access.js';
import {
  attritionTrend,
  completeness,
  expiries,
  headcountTrend,
  movementWaterfall,
} from '../analytics/queries.js';
import { blockedReport, commitImportRetrying, type CommitDeps } from '../import/commit.js';
import { dryRun, type ClassifiedRow } from '../import/dry-run.js';
import {
  proposeMapping,
  resolveMapping,
  SYSTEM_COLUMNS,
  type AttributeAdvisor,
  type ColumnChoice,
  type ColumnMapping,
} from '../import/mapping.js';
import { parseUpload, type ParsedFile } from '../import/parse.js';
import { exportableColumns } from '../export/export.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { NOBODY, personOfViewer, tenantToday, type ScreenDeps, type Tx } from './record.js';

/**
 * The screens that act on many people at once: integrations, import, the
 * export builder and analytics (PRD §13.3, §14, §15.1, §16; screens 9 to 12).
 */

/* -------------------------------------------------------- integrations -- */

/** Events an endpoint may subscribe to: People's own, as the contracts name them. */
export const SUBSCRIBABLE = [
  PersonProvisioned,
  PersonHired,
  PersonProfileUpdated,
  PersonAttributeCorrected,
  PersonJobChanged,
  PersonOrgChanged,
  PersonManagerChanged,
  PersonCompensationChanged,
  PersonStatusChanged,
  PersonTerminated,
  PersonProfileIncomplete,
  PersonProfileCompleted,
  SchemaPublished,
].map((e) => e.name);

export interface IntegrationDeps extends ScreenDeps {
  readonly webhooks: Pick<
    WebhookService,
    'createEndpoint' | 'updateEndpoint' | 'rotateSecret' | 'replay'
  >;
  readonly listEndpoints: (
    tx: Tx,
    tenantId: string,
    since: Date,
  ) => Promise<{ endpoints: readonly ListedEndpoint[]; deliveries: number }>;
  readonly listDeliveries: (
    tx: Tx,
    tenantId: string,
    endpointId: string,
    after: string | null,
  ) => Promise<{ deliveries: readonly ListedDelivery[]; next: string | null }>;
}

async function admin(deps: ScreenDeps, tx: Tx, asking: Asking): Promise<Result<void>> {
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  return everyone.isAdmin
    ? ok(undefined)
    : err(failure('FORBIDDEN', 'Only a People administrator manages integrations'));
}

export interface IntegrationsView {
  readonly schemaVersion: number;
  readonly deliveries24h: number;
  readonly events: readonly string[];
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly refused: 'special-category' | 'encrypted' | null;
  }[];
  readonly endpoints: readonly ListedEndpoint[];
}

export async function integrationsView(
  deps: IntegrationDeps,
  asking: Asking,
): Promise<Result<IntegrationsView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const allowed = await admin(deps, tx, asking);
    if (!allowed.ok) return allowed;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const since = new Date(Date.parse(deps.clock.instant()) - 24 * 3_600_000);
    const listed = await deps.listEndpoints(tx, asking.tenantId, since);
    return ok({
      schemaVersion: version.version,
      deliveries24h: listed.deliveries,
      events: SUBSCRIBABLE,
      fields: version.document.attributes
        .filter((d) => d.deprecatedAt === null)
        .map((d) => ({
          key: d.key,
          label: d.label.default,
          refused:
            d.classification.classification === 'special-category'
              ? ('special-category' as const)
              : d.encrypted
                ? ('encrypted' as const)
                : null,
        })),
      endpoints: listed.endpoints,
    });
  });
}

export interface DeliveriesView {
  readonly endpoint: { readonly id: string; readonly url: string; readonly enabled: boolean };
  readonly deliveries: readonly ListedDelivery[];
  /** The cursor for the older page; null on the last. */
  readonly next: string | null;
}

/** One endpoint's delivery log (PEO-121): `people_admin`'s, as the endpoints are. */
export async function deliveriesView(
  deps: IntegrationDeps,
  asking: Asking,
  endpointId: string,
  after: string | null,
): Promise<Result<DeliveriesView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const allowed = await admin(deps, tx, asking);
    if (!allowed.ok) return allowed;
    const since = new Date(Date.parse(deps.clock.instant()) - 24 * 3_600_000);
    const endpoint = (await deps.listEndpoints(tx, asking.tenantId, since)).endpoints.find(
      (e) => e.id === endpointId,
    );
    if (endpoint === undefined) return err(failure('NOT_FOUND', 'No such endpoint'));
    const page = await deps.listDeliveries(tx, asking.tenantId, endpointId, after);
    return ok({
      endpoint: { id: endpoint.id, url: endpoint.url, enabled: endpoint.enabled },
      ...page,
    });
  });
}

/** Every endpoint call is `people_admin`'s; the service itself checks the rest (§13.3). */
async function asAdmin<T>(
  deps: IntegrationDeps,
  asking: Asking,
  then: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const allowed = await run(deps.service, asking.tenantId, (tx) => admin(deps, tx, asking));
  return allowed.ok ? then() : allowed;
}

export const createEndpoint = (
  deps: IntegrationDeps,
  asking: Asking,
  input: EndpointInput,
): Promise<Result<{ id: string; secret: string }>> =>
  asAdmin(deps, asking, () => deps.webhooks.createEndpoint(asking.tenantId, input));

export const updateEndpoint = (
  deps: IntegrationDeps,
  asking: Asking,
  id: string,
  patch: Partial<EndpointInput> & { readonly enabled?: boolean },
): Promise<Result<void>> =>
  asAdmin(deps, asking, () => deps.webhooks.updateEndpoint(asking.tenantId, id, patch));

export const rotateEndpoint = (
  deps: IntegrationDeps,
  asking: Asking,
  id: string,
): Promise<Result<{ secret: string }>> =>
  asAdmin(deps, asking, () => deps.webhooks.rotateSecret(asking.tenantId, id));

export const replayDelivery = (
  deps: IntegrationDeps,
  asking: Asking,
  deliveryId: string,
): Promise<Result<string>> =>
  asAdmin(deps, asking, () => deps.webhooks.replay(asking.tenantId, deliveryId));

/* ------------------------------------------------------------- import -- */

export interface ImportDeps extends ScreenDeps {
  readonly advisor: AttributeAdvisor | null;
  readonly commit: Omit<CommitDeps, 'access' | 'schemas' | 'relations' | 'clock'>;
}

export interface ImportFileView {
  readonly name: string;
  readonly rows: number;
  readonly sheet: string | null;
}

export type ImportStageView =
  | {
      readonly step: 'map';
      readonly file: ImportFileView;
      readonly columns: readonly ColumnMapping[];
      readonly fields: readonly { readonly key: string; readonly label: string }[];
    }
  | {
      readonly step: 'review';
      readonly file: ImportFileView;
      readonly dryRun: {
        readonly counts: Readonly<
          Record<'create' | 'update' | 'unchanged' | 'blocked' | 'duplicate', number>
        >;
        readonly incomplete: {
          readonly count: number;
          readonly byField: readonly { readonly label: string; readonly count: number }[];
        };
        readonly ignoredColumns: readonly string[];
        /** Repeating attributes' sheets; one not imported is listed, never dropped. */
        readonly sheets: readonly {
          readonly sheet: string;
          readonly key: string;
          readonly imported: boolean;
        }[];
        /** Existing people whose hire date the file corrects (§8.5), not overwrites. */
        readonly corrections: readonly {
          readonly row: number;
          readonly from: string | null;
          readonly to: string;
        }[];
        readonly blocked: readonly {
          readonly row: number;
          readonly person: string | null;
          readonly problem: string;
          /** `C14 — “x”` on the people sheet, `Languages!D7 — “x”` on another. */
          readonly cell: string;
        }[];
      };
      /** The blocked rows as a file that imports once fixed, base64 CSV. */
      readonly blockedCsv: string;
    }
  | {
      readonly step: 'done';
      readonly file: ImportFileView;
      readonly created: number;
      readonly updated: number;
      readonly blocked: number;
      readonly blockedCsv: string;
      /** The same report, stored sealed; the link expires in a day. */
      readonly reportUrl: string;
    };

export interface ImportUpload {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Column index → attribute key, or null to ignore it. Absent before mapping. */
  readonly mapping?: Readonly<Record<number, string | null>>;
}

const column = (index: number): string => {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const fileView = (name: string, file: ParsedFile): ImportFileView => ({
  name,
  rows: file.rows.length,
  sheet: file.sheet,
});

interface Prepared {
  readonly file: ParsedFile;
  readonly proposed: readonly ColumnMapping[];
  readonly version: NonNullable<Awaited<ReturnType<ScreenDeps['service']['schemas']['current']>>>;
  readonly relations: Awaited<ReturnType<ScreenDeps['relations']['relations']>>;
}

async function prepare(
  deps: ImportDeps,
  tx: Tx,
  asking: Asking,
  upload: ImportUpload,
): Promise<Result<Prepared>> {
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR imports people'));
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Publish the employee fields first'));
  const file = await parseUpload(upload.bytes);
  if (!file.ok) return file;
  const proposed = await proposeMapping({
    file: file.value,
    version,
    relations,
    advisor: deps.advisor,
  });
  return ok({ file: file.value, proposed, version, relations });
}

function resolved(prepared: Prepared, mapping: Readonly<Record<number, string | null>>) {
  const choices: Record<number, ColumnChoice> = {};
  for (const [index, key] of Object.entries(mapping)) {
    choices[Number(index)] = key === null ? { kind: 'ignore' } : { kind: 'map', key };
  }
  return resolveMapping(prepared.proposed, choices, prepared.version, prepared.relations);
}

/** Upload → the proposed mapping (§14.3). Nothing is kept: every step sends the file again. */
export async function proposeImport(
  deps: ImportDeps,
  asking: Asking,
  upload: ImportUpload,
): Promise<Result<ImportStageView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const prepared = await prepare(deps, tx, asking, upload);
    if (!prepared.ok) return prepared;
    const { file, proposed, version } = prepared.value;
    const everyone = prepared.value.relations;
    return ok({
      step: 'map' as const,
      file: fileView(upload.name, file),
      columns: proposed,
      fields: [
        ...Object.keys(SYSTEM_COLUMNS)
          .filter((k) => !k.startsWith('_'))
          .map((key) => ({ key, label: key.replaceAll('_', ' ') })),
        ...version.document.attributes
          .filter((d) => d.deprecatedAt === null && visibleTo(d, everyone))
          .map((d) => ({ key: d.key, label: d.label.default })),
      ],
    });
  });
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function blockedOf(rows: readonly ClassifiedRow[]) {
  return rows.filter((r) => r.outcome === 'blocked' || r.outcome === 'duplicate');
}

/** The dry run: five counts, the incomplete warning and the blocked rows (§14.4). */
export async function dryRunImport(
  deps: ImportDeps,
  asking: Asking,
  upload: ImportUpload,
): Promise<Result<ImportStageView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const prepared = await prepare(deps, tx, asking, upload);
    if (!prepared.ok) return prepared;
    const mapping = resolved(prepared.value, upload.mapping ?? {});
    if (!mapping.ok) return mapping;
    const { file, version } = prepared.value;
    const planned = await dryRun(tx, importDeps(deps), {
      ...asking,
      file,
      mapping: mapping.value,
    });
    if (!planned.ok) return planned;
    const plan = planned.value;
    const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
    const indexOf = new Map(file.headers.map((h, i) => [h, i]));
    const blocked = blockedOf(plan.rows);
    return ok({
      step: 'review' as const,
      file: fileView(upload.name, file),
      dryRun: {
        counts: plan.counts,
        incomplete: {
          count: plan.incomplete.count,
          byField: Object.entries(plan.incomplete.byKey).map(([key, count]) => ({
            label: byKey.get(key)?.label.default ?? key,
            count,
          })),
        },
        ignoredColumns: plan.ignoredColumns,
        sheets: plan.sheets,
        corrections: plan.rows.flatMap((r) =>
          r.outcome === 'update' && r.hireDateCorrection
            ? [{ row: r.row, ...r.hireDateCorrection }]
            : [],
        ),
        blocked: [
          ...blocked.map((r) => {
          const problem = r.problems[0];
          const at = problem === undefined ? -1 : (indexOf.get(problem.column) ?? -1);
          const value = at < 0 ? '' : (r.cells[at] ?? '');
          return {
            row: r.row,
            person: null,
            problem:
              problem?.reason ??
              (r.outcome === 'duplicate' ? 'A duplicate of an earlier row' : 'Blocked'),
            cell:
              at < 0
                ? `row ${String(r.row)}`
                : `${column(at)}${String(r.row)} — ${value === '' ? 'empty' : `“${value}”`}`,
          };
          }),
          ...plan.blockedItems.map((item) => ({
            row: item.row,
            person: item.personId,
            problem: item.reason,
            cell: `${item.sheet}!${item.cell} — ${item.value === '' ? 'empty' : `“${item.value}”`}`,
          })),
        ],
      },
      blockedCsv: b64(
        blockedReport(
          file,
          blocked.map((r) => ({
            row: r,
            reason: r.problems.map((p) => p.reason).join('; ') || r.outcome,
          })),
          plan.blockedItems,
        ),
      ),
    });
  });
}

function importDeps(deps: ImportDeps): CommitDeps {
  return {
    ...deps.commit,
    access: deps.service.access,
    schemas: deps.service.schemas,
    relations: deps.relations,
    clock: deps.clock,
  };
}

/**
 * Commit: the dry run again, never taken from the client, then the writes
 * (§14.5). Through `commitImportRetrying` (PEO-106), in its own transaction:
 * two imports claiming the same unique values can deadlock, and the loser is
 * run again rather than failed.
 */
export async function commitImportView(
  deps: ImportDeps,
  asking: Asking,
  upload: ImportUpload,
): Promise<Result<ImportStageView>> {
  const planned = await run(deps.service, asking.tenantId, async (tx) => {
    const prepared = await prepare(deps, tx, asking, upload);
    if (!prepared.ok) return prepared;
    const mapping = resolved(prepared.value, upload.mapping ?? {});
    return mapping.ok ? ok({ file: prepared.value.file, mapping: mapping.value }) : mapping;
  });
  if (!planned.ok) return planned;
  const committed = await commitImportRetrying(deps.service.inTenant, importDeps(deps), {
    ...asking,
    file: planned.value.file,
    mapping: planned.value.mapping,
  });
  if (!committed.ok) return committed;
  if (committed.value.status === 'already_imported') {
    // The report that import stored, for the HR user `prepare` let this far;
    // after its 7 days, or once somebody in it was erased, there is none.
    const link = committed.value.reportUrl;
    return err(
      link === null
        ? failure(
            'ALREADY_IMPORTED',
            'This exact file has already been imported. Its blocked-row report has expired: reports are kept 7 days.',
          )
        : { ...failure('ALREADY_IMPORTED', 'This exact file has already been imported'), link },
    );
  }
  const { counts, report, reportUrl } = committed.value;
  return ok({
    step: 'done' as const,
    file: fileView(upload.name, planned.value.file),
    created: counts.created,
    updated: counts.updated,
    blocked: counts.blocked + counts.duplicate,
    blockedCsv: b64(report),
    reportUrl,
  });
}

/* ------------------------------------------------------------- export -- */

export interface ExportBuilderView {
  readonly today: string;
  readonly who: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly { readonly key: string; readonly label: string }[];
  }[];
}

/**
 * The builder offers only what the requester can read (§15.1): a field
 * withheld from them on everybody is not offered, so there is no "export
 * everything" to press. The export itself checks again, person by person.
 *
 * Decided from the published schema and the relations the viewer can hold
 * to anybody — their tenant roles, and self, manager and chain where `reach`
 * says they have somebody to hold them to — never from a sample of people,
 * so the 201st person's fields are offered as readily as the first's.
 */
export async function exportBuilderView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<ExportBuilderView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published to export'));
    const counted = await deps.service.access.count(tx, asking);
    if (!counted.ok) return counted;
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    const reach = await deps.relations.reach?.(tx, asking.tenantId, asking.viewer);
    const isSelf =
      reach === undefined
        ? (await deps.personOf(tx, asking.tenantId, asking.viewer.accountId)) !== null
        : reach.self.size > 0;
    const manages = reach !== undefined && reach.direct.size > 0;
    const inChain = reach !== undefined && (reach.chain.size > 0 || manages);
    const held = [
      everyone,
      ...(isSelf ? [{ ...everyone, isSelf: true }] : []),
      ...(manages ? [{ ...everyone, isManager: true, isInManagerChain: true }] : []),
      ...(inChain ? [{ ...everyone, isInManagerChain: true }] : []),
    ];
    const readable = new Set(
      version.document.attributes
        .filter((d) => held.some((relations) => visibleTo(d, relations)))
        .map((d) => d.key as string),
    );
    const columns = exportableColumns(version).filter((d) => readable.has(d.key));
    return ok({
      today: await tenantToday(deps, tx, asking.tenantId),
      who: [
        {
          value: 'everyone',
          label: 'Everybody you can see',
          count: counted.value.all,
        },
      ],
      sections: version.document.sections
        .toSorted((a, b) => a.order - b.order)
        .flatMap((s) => {
          const fields = columns
            .filter((d) => d.sectionKey === s.key)
            .map((d) => ({ key: d.key, label: d.label.default }));
          return fields.length === 0 ? [] : [{ key: s.key, label: s.label.default, fields }];
        }),
    });
  });
}

/* ---------------------------------------------------------- analytics -- */

export interface AnalyticsView {
  readonly asOf: string;
  readonly source: 'snapshot' | 'history';
  readonly sourceNote: string;
  readonly headcount: {
    readonly value: number;
    readonly change: number | null;
    readonly trend: readonly { readonly label: string; readonly value: number }[];
  };
  readonly attrition: {
    readonly percent: number;
    readonly leavers: number;
    readonly formula: string;
  } | null;
  readonly complete: { readonly percent: number; readonly incomplete: number } | null;
  readonly expiringIn90Days: number | null;
  readonly movement: {
    readonly period: string;
    readonly opening: number;
    readonly joiners: number;
    readonly moves: number;
    readonly leavers: number;
    readonly closing: number;
  } | null;
  readonly completenessBySection:
    readonly { readonly label: string; readonly value: number }[] | null;
  readonly expiries: null;
  readonly funnel: null;
}

const minusMonths = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * The analytics landing (§16.2): headcount, attrition, completeness,
 * expiries and the movement of the last month, from the snapshots.
 *
 * HR sees the tenant; a manager sees their chain; anybody else is refused.
 * The cohort minimum and field authorization are the queries' own.
 */
export async function analyticsView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<AnalyticsView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    let viewer: { kind: 'hr' } | { kind: 'manager'; personId: string };
    if (everyone.isHr) viewer = { kind: 'hr' };
    else {
      const own = await personOfViewer(deps, tx, asking);
      if (!own.ok) return err(failure('FORBIDDEN', 'Analytics is for HR and managers'));
      viewer = { kind: 'manager', personId: own.value };
    }
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const ctx = { tx, tenantId: asking.tenantId, viewer, definitions: version.document.attributes };
    const today = await tenantToday(deps, tx, asking.tenantId);

    const trend = await headcountTrend(ctx, { from: minusMonths(today, 12), to: today });
    if (!trend.ok) return trend;
    const points = trend.value.points;
    const last = points.at(-1);
    const before = points.at(-2);
    const attrition = await attritionTrend(ctx, { from: minusMonths(today, 1), to: today });
    const latest = attrition.ok ? attrition.value.points.at(-1) : undefined;
    const states = await completeness(ctx, { asOf: today });
    const expiring = await expiries(ctx, { asOf: today });
    const moved = await movementWaterfall(ctx, { from: minusMonths(today, 1), to: today });

    const total = states.ok ? states.value.states.complete + states.value.states.incomplete : 0;
    const bySection = new Map<string, number>();
    if (states.ok && states.value.byField !== null) {
      for (const f of states.value.byField) {
        bySection.set(f.sectionKey, (bySection.get(f.sectionKey) ?? 0) + f.missing);
      }
    }
    const sectionLabel = new Map(
      version.document.sections.map((s) => [s.key as string, s.label.default]),
    );
    const source = states.ok ? states.value.source : 'snapshot';

    return ok({
      asOf: today,
      source,
      sourceNote:
        source === 'snapshot'
          ? 'From the daily snapshot.'
          : 'Computed from history for this date, which is slower.',
      headcount: {
        value: last?.headcount ?? 0,
        change:
          last !== undefined && before !== undefined ? last.headcount - before.headcount : null,
        trend: points.map((p) => ({ label: p.month, value: p.headcount })),
      },
      attrition:
        latest?.rate === null || latest === undefined
          ? null
          : {
              percent: Math.round(latest.rate * 1000) / 10,
              leavers: latest.leavers,
              formula: attrition.ok ? attrition.value.formula : '',
            },
      complete:
        states.ok && total > 0
          ? {
              percent: Math.round((states.value.states.complete / total) * 100),
              incomplete: states.value.states.incomplete,
            }
          : null,
      expiringIn90Days: expiring.ok
        ? expiring.value.expiries.reduce((n, e) => n + e.count, 0)
        : null,
      movement: moved.ok
        ? {
            period: `${minusMonths(today, 1)} to ${today}`,
            opening: moved.value.opening,
            joiners: moved.value.joiners,
            moves: moved.value.internalMoves,
            leavers: moved.value.leavers,
            closing: moved.value.closing,
          }
        : null,
      completenessBySection:
        bySection.size === 0
          ? null
          : [...bySection].map(([key, value]) => ({ label: sectionLabel.get(key) ?? key, value })),
      // ponytail: the expiry timeline and the onboarding funnel are drawn by
      // the screen but have no query shaped for them yet; absent, not empty.
      expiries: null,
      funnel: null,
    });
  });
}
