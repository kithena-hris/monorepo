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
import {
  discard,
  finishUpload,
  readUpload,
  startUpload,
  type PresignedPut,
  type UploadDeps,
} from '../import/upload.js';
import { LINK_LIFETIME_MS } from '../export/object-store.js';
import { exportableColumns } from '../export/export.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { NOBODY, tenantToday, type ScreenDeps, type Tx } from './record.js';
import { segmentsFor } from './segments.js';

/**
 * The screens that act on many people at once: integrations, import, the
 * and the export builder (PRD §13.3, §14, §15.1; screens 9 to 11). Analytics
 * is `analytics.ts`.
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
  /** Where the file waits between the steps, and who may put it there (§14.2). */
  readonly uploads: Pick<UploadDeps, 'store' | 'intents'>;
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
        /**
         * National identifiers our checks doubt (PEO-125), per cell: they
         * import, and go to HR's review. The cell is named, never its value.
         */
        readonly findings: readonly {
          readonly row: number;
          readonly cell: string;
          readonly label: string;
          readonly level: 'attention' | 'mismatch';
          readonly message: string;
        }[];
      };
      /**
       * The blocked rows as a file that imports once fixed: a signed link
       * that expires with the upload or in a day, whichever is sooner. Null
       * when nothing is blocked.
       */
      readonly blockedUrl: string | null;
    }
  | {
      readonly step: 'done';
      readonly file: ImportFileView;
      readonly created: number;
      readonly updated: number;
      readonly blocked: number;
      /** The blocked-row report, stored sealed; the link expires in a day. */
      readonly reportUrl: string;
      /** Doubted national identifiers that imported and went to HR's review (PEO-125). */
      readonly forReview: number;
    };

/** A step after the upload: which upload, and the mapping once there is one. */
export interface ImportStep {
  readonly uploadId: string;
  /** Column index → attribute key, or null to ignore it. Absent before mapping. */
  readonly mapping?: Readonly<Record<number, string | null>>;
}

/** Where the browser puts the file, and how (§14.2). */
export type ImportUploadView = PresignedPut & {
  readonly uploadId: string;
  /** When the PUT stops working. */
  readonly expiresAt: string;
};

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

const onlyHr = () => err(failure('FORBIDDEN', 'Only HR imports people'));

async function isHr(deps: ImportDeps, tx: Tx, asking: Asking): Promise<boolean> {
  return (await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY)).isHr;
}

async function prepare(
  deps: ImportDeps,
  tx: Tx,
  asking: Asking,
  bytes: Uint8Array,
): Promise<Result<Prepared>> {
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  if (!relations.isHr) return onlyHr();
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Publish the employee fields first'));
  const file = await parseUpload(bytes);
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

function uploadDeps(deps: ImportDeps): UploadDeps {
  return { ...deps.uploads, clock: deps.clock, newId: deps.commit.newId };
}

const inTx =
  (deps: ImportDeps, asking: Asking) =>
  <T>(fn: (tx: Tx) => Promise<Result<T>>): Promise<Result<T>> =>
    run(deps.service, asking.tenantId, fn);

const who = (asking: Asking) => ({ tenantId: asking.tenantId, actorId: asking.viewer.accountId });

/**
 * Where to put the file (§14.2): a presigned PUT for a key People chose, for
 * exactly this many bytes, once, for five minutes. HR only, as every import.
 */
export async function startImportUpload(
  deps: ImportDeps,
  asking: Asking,
  file: { readonly name: string; readonly size: number },
): Promise<Result<ImportUploadView>> {
  const allowed = await run(deps.service, asking.tenantId, async (tx) =>
    (await isHr(deps, tx, asking)) ? ok(null) : onlyHr(),
  );
  if (!allowed.ok) return allowed;
  return startUpload(uploadDeps(deps), inTx(deps, asking), who(asking), file);
}

/**
 * The file is in storage: check it is the file that was declared, then the
 * proposed mapping (§14.3). Nothing is written but the upload's checksum.
 */
export async function completeImportUpload(
  deps: ImportDeps,
  asking: Asking,
  uploadId: string,
): Promise<Result<ImportStageView>> {
  const allowed = await run(deps.service, asking.tenantId, async (tx) =>
    (await isHr(deps, tx, asking)) ? ok(null) : onlyHr(),
  );
  if (!allowed.ok) return allowed;
  const finished = await finishUpload(uploadDeps(deps), inTx(deps, asking), who(asking), uploadId);
  if (!finished.ok) return finished;
  const { intent, bytes } = finished.value;
  return run(deps.service, asking.tenantId, async (tx) => {
    const prepared = await prepare(deps, tx, asking, bytes);
    if (!prepared.ok) return prepared;
    const { file, proposed, version } = prepared.value;
    const everyone = prepared.value.relations;
    return ok({
      step: 'map' as const,
      file: fileView(intent.name, file),
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

/**
 * Where a dry run's blocked rows are kept: under the upload, in the export's
 * store, sealed. Under `dry-runs/`, not `imports/`, so the export sweep and the
 * bucket's lifecycle rule give it an export file's day rather than a committed
 * report's week (`lifetimeOf`).
 */
export const dryRunReportKey = (tenantId: string, uploadId: string): string =>
  `dry-runs/${tenantId}/${uploadId}/blocked-rows.csv`;

/** How many blocked rows, and blocked items, the review lists (§14.2). */
const SHOWN = 20;

function blockedOf(rows: readonly ClassifiedRow[]) {
  return rows.filter((r) => r.outcome === 'blocked' || r.outcome === 'duplicate');
}

/** The dry run: five counts, the incomplete warning and the blocked rows (§14.4). */
export async function dryRunImport(
  deps: ImportDeps,
  asking: Asking,
  step: ImportStep,
): Promise<Result<ImportStageView>> {
  const read = await readUpload(uploadDeps(deps), inTx(deps, asking), who(asking), step.uploadId);
  if (!read.ok) return read;
  const { intent, bytes } = read.value;
  const reviewed = await run(deps.service, asking.tenantId, async (tx) => {
    const prepared = await prepare(deps, tx, asking, bytes);
    if (!prepared.ok) return prepared;
    const mapping = resolved(prepared.value, step.mapping ?? {});
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
      file: fileView(intent.name, file),
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
        // The first twenty (§14.2); every one is in the blocked-rows file. A
        // list of forty thousand is a response no browser or function needs.
        blocked: [
          ...blocked.slice(0, SHOWN).map((r) => {
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
          ...plan.blockedItems.slice(0, SHOWN).map((item) => ({
            row: item.row,
            person: item.personId,
            problem: item.reason,
            cell: `${item.sheet}!${item.cell} — ${item.value === '' ? 'empty' : `“${item.value}”`}`,
          })),
        ],
        findings: plan.findings.map((f) => {
          const at = indexOf.get(f.column) ?? -1;
          return {
            row: f.row,
            cell: at < 0 ? `row ${String(f.row)}` : `${column(at)}${String(f.row)}`,
            label: byKey.get(f.key)?.label.default ?? f.key,
            level: f.level,
            message: f.message,
          };
        }),
      },
      report:
        blocked.length + plan.blockedItems.length === 0
          ? null
          : blockedReport(
              file,
              blocked.map((r) => ({
                row: r,
                reason: r.problems.map((p) => p.reason).join('; ') || r.outcome,
              })),
              plan.blockedItems,
            ),
    });
  });
  if (!reviewed.ok) return reviewed;
  const { report, ...review } = reviewed.value;
  // Stored after the transaction, as the commit's report is: it holds values,
  // so never in a table, and reached only by a link that expires.
  let blockedUrl: string | null = null;
  if (report !== null) {
    const store = deps.commit.reports.store;
    const key = dryRunReportKey(asking.tenantId, intent.id);
    await store.put(key, report, 'text/csv');
    const until = Math.min(
      Date.parse(deps.clock.instant()) + LINK_LIFETIME_MS,
      Date.parse(intent.expiresAt),
    );
    blockedUrl = await store.sign(key, new Date(until).toISOString());
  }
  return ok({ ...review, blockedUrl });
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
  step: ImportStep,
): Promise<Result<ImportStageView>> {
  const read = await readUpload(uploadDeps(deps), inTx(deps, asking), who(asking), step.uploadId);
  if (!read.ok) return read;
  const { intent, bytes } = read.value;
  const planned = await run(deps.service, asking.tenantId, async (tx) => {
    const prepared = await prepare(deps, tx, asking, bytes);
    if (!prepared.ok) return prepared;
    const mapping = resolved(prepared.value, step.mapping ?? {});
    return mapping.ok ? ok({ file: prepared.value.file, mapping: mapping.value }) : mapping;
  });
  if (!planned.ok) return planned;
  const committed = await commitImportRetrying(deps.service.inTenant, importDeps(deps), {
    ...asking,
    file: planned.value.file,
    mapping: planned.value.mapping,
  });
  if (!committed.ok) return committed;
  // Imported, or found imported already: either way the upload has done its
  // work, and it and its dry run's report go now rather than at expiry.
  await discard(uploadDeps(deps), inTx(deps, asking), intent);
  await deps.commit.reports.store.remove(dryRunReportKey(asking.tenantId, intent.id));
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
  const { counts, reportUrl, findings } = committed.value;
  return ok({
    step: 'done' as const,
    file: fileView(intent.name, planned.value.file),
    created: counts.created,
    updated: counts.updated,
    blocked: counts.blocked + counts.duplicate,
    reportUrl,
    forReview: new Set(findings.map((f) => `${String(f.row)}/${f.key}`)).size,
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
    // A saved segment is an audience too (PEO-068): its people as this
    // requester may list them, counted the way the export will read them.
    const segments: { value: string; label: string; count: number }[] = [];
    for (const s of await segmentsFor(deps, tx, asking)) {
      if (!s.usableIn.directory) continue;
      const where = Object.fromEntries(s.filter.map((c) => [c.key, c.value]));
      // eslint-disable-next-line no-await-in-loop -- a handful of segments, one transaction
      const inSegment = await deps.service.access.count(tx, { ...asking, where });
      if (inSegment.ok) {
        segments.push({ value: `segment:${s.id}`, label: s.name, count: inSegment.value.all });
      }
    }
    return ok({
      today: await tenantToday(deps, tx, asking.tenantId),
      who: [
        {
          value: 'everyone',
          label: 'Everybody you can see',
          count: counted.value.all,
        },
        ...segments,
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
