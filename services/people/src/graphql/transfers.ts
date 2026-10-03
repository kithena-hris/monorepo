import type {
  TransferHistoryView,
  TransferView,
} from '../application/screens/transfers.js';
import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * Import & export's history, the import template and an Insights tab as CSV,
 * over GraphQL: each one REST route through `viaRest`, so who may read what
 * stays the application layer's. A CSV arrives as its text, byte order mark
 * and all, for the tenant app's download routes to hand over as a file.
 */

const list = <T>(items: readonly T[]): T[] => [...items];

/** The route's bytes as text, keeping the BOM a spreadsheet reads UTF-8 by. */
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

export function defineTransfers(builder: PeopleBuilder, viaRest: ViaRest): void {
  const By = builder.objectRef<TransferView['by']>('PeopleTransferBy').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
    }),
  });
  const Imported = builder
    .objectRef<NonNullable<TransferView['imported']>>('PeopleTransferImported')
    .implement({
      fields: (t) => ({
        created: t.exposeInt('created'),
        updated: t.exposeInt('updated'),
        blocked: t.exposeInt('blocked', { description: 'Refused rows and duplicates together.' }),
      }),
    });
  const Exported = builder
    .objectRef<NonNullable<TransferView['exported']>>('PeopleTransferExported')
    .implement({
      fields: (t) => ({
        rows: t.exposeInt('rows'),
        format: t.exposeString('format', {
          nullable: true,
          description: 'csv, xlsx or pdf; null on an export from before the ledger kept it.',
        }),
      }),
    });
  const Progress = builder
    .objectRef<NonNullable<TransferView['run']>['people']>('PeopleTransferProgress')
    .implement({
      fields: (t) => ({
        done: t.exposeInt('done'),
        total: t.exposeInt('total', { nullable: true, description: 'Null until the file is read.' }),
      }),
    });
  const Run = builder.objectRef<NonNullable<TransferView['run']>>('PeopleTransferRun').implement({
    description: 'An import’s state: Importing with how many people are in, Imported, or Import failed.',
    fields: (t) => ({
      status: t.exposeString('status', { description: 'importing, imported or failed.' }),
      label: t.exposeString('label', { description: 'Importing, Imported or Import failed.' }),
      people: t.field({ type: Progress, resolve: (v) => v.people }),
    }),
  });
  const Transfer = builder.objectRef<TransferView>('PeopleTransfer').implement({
    description: 'One import or export, as its ledger keeps it. Never a value, never a stored link.',
    fields: (t) => ({
      id: t.exposeID('id'),
      kind: t.exposeString('kind', { description: 'import or export.' }),
      title: t.exposeString('title', {
        nullable: true,
        description: 'An import’s file name; an export’s reason, else the file it made.',
      }),
      by: t.field({ type: By, resolve: (v) => v.by }),
      at: t.exposeString('at'),
      imported: t.field({ type: Imported, nullable: true, resolve: (v) => v.imported }),
      exported: t.field({ type: Exported, nullable: true, resolve: (v) => v.exported }),
      downloadable: t.exposeBoolean('downloadable', {
        description: 'The viewer’s own export, still there: `peopleExport(id)` hands them its files.',
      }),
      reportUrl: t.exposeString('reportUrl', {
        nullable: true,
        description: 'An import’s blocked-row report while it is kept: a link that expires.',
      }),
      run: t.field({
        type: Run,
        nullable: true,
        description: 'An import’s state, and its run’s id is this id; null for an export.',
        resolve: (v) => v.run,
      }),
    }),
  });
  const History = builder.objectRef<TransferHistoryView>('PeopleTransferHistory').implement({
    fields: (t) => ({
      items: t.field({ type: [Transfer], resolve: (v) => list(v.items) }),
      next: t.exposeID('next', { nullable: true }),
    }),
  });

  builder.queryFields((t) => ({
    peopleTransferHistory: t.field({
      type: History,
      description: 'Imports and exports, newest first, 50 at a time; HR and People administrators.',
      args: { before: t.arg.id() },
      resolve: (_root, args, ctx) =>
        viaRest<TransferHistoryView>(
          ctx,
          'GET',
          args.before
            ? `/v1/views/transfers?before=${encodeURIComponent(args.before)}`
            : '/v1/views/transfers',
        ),
    }),
    peopleImportTemplate: t.string({
      description:
        'A header-only CSV of the fields the viewer may import, by label; HR only (`GET /v1/imports/template`).',
      resolve: async (_root, _args, ctx) =>
        text(await viaRest<Uint8Array>(ctx, 'GET', '/v1/imports/template')),
    }),
    peopleAnalyticsExport: t.string({
      description:
        'One Insights tab’s numbers as CSV, for a segment or everybody the viewer may chart.',
      args: { tab: t.arg.string({ required: true }), segment: t.arg.id() },
      resolve: async (_root, args, ctx) => {
        const query = new URLSearchParams({ tab: args.tab });
        if (args.segment) query.set('segment', args.segment);
        return text(
          await viaRest<Uint8Array>(ctx, 'GET', `/v1/views/analytics/export?${query.toString()}`),
        );
      },
    }),
  }));
}
