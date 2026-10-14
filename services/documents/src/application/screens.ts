import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type * as z from 'zod';
import type { DocumentId, PersonId } from '@kithena/contracts';

import {
  canDelete,
  canDownload,
  canEdit,
  canOpen,
  canSetConfidential,
  canShare,
} from '../domain/access/access.js';
import { audienceOf } from '../domain/acknowledge/campaign.js';
import { checklist, progress } from '../domain/checklist/checklist.js';
import { daysUntil } from '../domain/dates.js';
import type { Document } from '../domain/document/document.js';
import { expiring } from '../domain/queues/queues.js';
import type { Envelope } from '../domain/signature/envelope.js';
import { retentionWords, type DocumentType } from '../domain/type/document-type.js';
import { aiSwitches } from './ai.js';
import { contextOf, factsOf, notFound, type Ctx } from './context.js';
import { accessSettings, retentionDue } from './organise.js';
import type { Caller, Deps, Member } from './ports.js';
import type {
  DocumentRow,
  DocumentView,
  LibraryView,
  NeedsYou,
  OpenOrClosed,
  PersonFileView,
  QueueRow,
  SettingsView,
  Tile,
  TypeOption,
} from './views.js';

/**
 * The screens' reads (DOC-021): every list holds only what its viewer may
 * open, decided by the domain's `canOpen` over the store's candidates.
 */

type Types = ReadonlyMap<string, DocumentType & { readonly archived: boolean }>;

interface Directory {
  readonly byPerson: ReadonlyMap<string, Member>;
  readonly byAccount: ReadonlyMap<string, Member>;
}

async function directory(ctx: Ctx): Promise<Directory> {
  const members = await ctx.tx.members.list();
  return {
    byPerson: new Map(members.map((m) => [m.personId as string, m])),
    byAccount: new Map(
      members.filter((m) => m.accountId !== null).map((m) => [m.accountId as string, m]),
    ),
  };
}

const first = (name: string) => name.split(' ')[0] ?? name;
const personRef = (m: Member) => ({
  personId: m.personId as string,
  name: m.displayName,
  teamName: m.teamName,
});

function whoCanSee(ctx: Ctx, doc: Document, type: DocumentType | null, dir: Directory) {
  const people = doc.grants.flatMap((g) => {
    if (g.grantee.kind !== 'member') return [];
    const m = dir.byPerson.get(g.grantee.personId);
    return m === undefined ? [] : [personRef(m)];
  });
  const subject = doc.subjectPersonId === null ? undefined : dir.byPerson.get(doc.subjectPersonId);
  const aboutMe = doc.subjectPersonId !== null && doc.subjectPersonId === ctx.viewer.personId;
  const everyone =
    (type?.audience === 'everyone' && doc.typeKey !== null) ||
    (doc.level === 'shared' && doc.grants.some((g) => g.grantee.kind === 'everyone'));
  let label: string;
  if (everyone) label = 'Everyone';
  else if (doc.level === 'shared' && doc.grants.length > 0) {
    label = doc.grants
      .map((g) =>
        g.grantee.kind === 'member'
          ? first(dir.byPerson.get(g.grantee.personId)?.displayName ?? 'Someone')
          : g.grantee.kind === 'team'
            ? `${g.grantee.teamKey} team`
            : 'Everyone',
      )
      .join(', ');
  } else if (doc.typeKey !== null) {
    label = aboutMe
      ? 'You and HR'
      : subject !== undefined
        ? `${first(subject.displayName)} and HR`
        : 'HR only';
  } else {
    label = doc.ownerAccount === ctx.caller.accountId ? 'Only you' : 'Its owner';
  }
  return { label, people, everyone, aboutMe, subject };
}

function statusOf(ctx: Ctx, doc: Document): DocumentRow['status'] {
  if (doc.deletedAt !== null) return { label: 'Deleted', tone: 'neutral' };
  if (doc.expiresOn !== null) {
    const left = daysUntil(ctx.today, doc.expiresOn);
    if (left < 0) return { label: 'Expired', tone: 'danger' };
    if (left <= 60) return { label: `Expires in ${String(left)} days`, tone: 'warning' };
  }
  return null;
}

function rowOf(
  ctx: Ctx,
  doc: Document,
  types: Types,
  dir: Directory,
  sections: ReadonlyMap<string, readonly string[]>,
  current: Current | null,
  envelope: Envelope | null = null,
): DocumentRow {
  const type = doc.typeKey === null ? null : (types.get(doc.typeKey) ?? null);
  const who = whoCanSee(ctx, doc, type, dir);
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    typeKey: doc.typeKey,
    typeName: type?.name ?? null,
    level: doc.level,
    confidential: doc.confidential,
    everyone: who.everyone,
    who: { label: who.label, people: who.people },
    subject: who.subject === undefined ? null : personRef(who.subject),
    pages: current?.pages ?? null,
    mediaType: current?.mediaType ?? null,
    updatedAt: doc.versionAt,
    expiresOn: doc.expiresOn,
    status: statusOf(ctx, doc),
    mine: doc.ownerAccount === ctx.caller.accountId,
    aboutMe: who.aboutMe,
    deletedAt: doc.deletedAt,
    sectionIds: [...(sections.get(doc.id) ?? [])],
    signing:
      envelope === null
        ? null
        : {
            envelopeId: envelope.id,
            status: envelope.status,
            signed: envelope.signers.filter((s) => s.status === 'signed').length,
            of: envelope.signers.length,
            waitingOn: envelope.signers
              .filter(
                (s) => s.status === 'sent' || s.status === 'opened' || s.status === 'verified',
              )
              .map((s) => s.name),
            canRemind:
              envelope.status === 'sent' &&
              (envelope.senderAccount === ctx.caller.accountId ||
                ctx.viewer.hr ||
                doc.ownerAccount === ctx.caller.accountId),
          },
  };
}

const peopleOf = (dir: Directory) =>
  [...dir.byPerson.values()].filter((m) => m.status !== 'terminated').map(personRef);

async function typesOf(ctx: Ctx): Promise<Types> {
  return new Map((await ctx.tx.types.list()).map((t) => [t.key as string, t]));
}

const typeOptions = (types: Types): z.infer<typeof TypeOption>[] =>
  [...types.values()]
    .filter((t) => !t.archived)
    .map((t) => ({
      key: t.key,
      name: t.name,
      kind: t.kind,
      filedTo: t.filedTo,
      confidential: t.confidential,
    }));

/** Pages of each document's current version, read once per screen. */
type Current = { readonly pages: number | null; readonly mediaType: string | null };

async function pagesOf(ctx: Ctx, docs: readonly Document[]): Promise<Map<string, Current>> {
  const out = new Map<string, Current>();
  // ponytail: one read per document; `pages` and `media_type` columns on `document` when lists grow past hundreds.
  await Promise.all(
    docs.map(async (d) => {
      const v = await ctx.tx.versions.get(d.id, d.currentVersion);
      out.set(d.id, { pages: v?.pages ?? null, mediaType: v?.mediaType ?? null });
    }),
  );
  return out;
}

export interface LibraryParams {
  readonly show: string;
  readonly q: string;
  readonly queue: string | null;
  readonly deleted: boolean;
}

/** B1, B2, B6, H1, H3, MD1, MH1, MH6: one screen, filtered in place. */
export async function library(
  deps: Deps,
  caller: Caller,
  params: LibraryParams,
): Promise<Result<LibraryView>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const [types, dir, candidates, sections] = await Promise.all([
      typesOf(ctx),
      directory(ctx),
      tx.documents.candidates(ctx.viewer),
      tx.sections.visibleTo(caller.accountId),
    ]);
    const open = candidates.filter((d) =>
      canOpen(
        factsOf(d, d.typeKey === null ? null : (types.get(d.typeKey) ?? null)),
        ctx.viewer,
        ctx.today,
      ),
    );
    const entries = await tx.sections.entries(sections.map((s) => s.id));
    const inSection = new Map<string, string[]>();
    for (const e of entries)
      inSection.set(e.documentId, [...(inSection.get(e.documentId) ?? []), e.sectionId]);

    const live = open.filter((d) => d.deletedAt === null);
    let list = params.deleted ? open.filter((d) => d.deletedAt !== null) : live;
    const show = params.show || 'all';
    if (show === 'about-me')
      list = list.filter(
        (d) => d.subjectPersonId === ctx.viewer.personId && d.subjectPersonId !== null,
      );
    else if (show === 'shared')
      list = list.filter(
        (d) => d.ownerAccount !== caller.accountId && d.subjectPersonId !== ctx.viewer.personId,
      );
    else if (show === 'mine')
      list = list.filter((d) => d.ownerAccount === caller.accountId && d.typeKey === null);
    else if (show === 'company')
      list = list.filter((d) => d.typeKey !== null && d.subjectPersonId === null);
    else if (show === 'people') list = list.filter((d) => d.subjectPersonId !== null);
    else if (show.startsWith('section:')) {
      const id = show.slice('section:'.length);
      list = list.filter((d) => (inSection.get(d.id) ?? []).includes(id));
    }
    const q = params.q.trim().toLowerCase();
    if (q !== '') {
      list = list.filter((d) => {
        const subject =
          d.subjectPersonId === null
            ? ''
            : (dir.byPerson.get(d.subjectPersonId)?.displayName ?? '');
        const type = d.typeKey === null ? '' : (types.get(d.typeKey)?.name ?? '');
        return `${d.title} ${subject} ${type}`.toLowerCase().includes(q);
      });
    }
    list = list.toSorted((a, b) => b.versionAt.localeCompare(a.versionAt));
    const pages = await pagesOf(ctx, list);
    const signings = await ctx.tx.envelopes.latestFor(list.map((d) => d.id));
    const rows = list.map((d) =>
      rowOf(ctx, d, types, dir, inSection, pages.get(d.id) ?? null, signings.get(d.id) ?? null),
    );

    const counts = new Map<string, number>();
    for (const d of live)
      for (const s of inSection.get(d.id) ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);

    // What needs this person: HR's requests of them, and access requests on what they own.
    const needsYou: z.infer<typeof NeedsYou>[] = [];
    if (ctx.viewer.personId !== null) {
      for (const r of await tx.docRequests.forPerson(ctx.viewer.personId)) {
        if (r.status !== 'open') continue;
        const type = types.get(r.typeKey);
        needsYou.push({
          id: r.id,
          kind: 'request',
          title: `Add your ${type?.name ?? 'document'}`,
          detail: r.message || 'HR asked for it',
          dueOn: r.dueOn,
          documentId: null,
          typeKey: r.typeKey,
        });
      }
    }
    if (ctx.viewer.personId !== null) {
      for (const env of await tx.envelopes.forPerson(ctx.viewer.personId)) {
        const me = env.signers.find((x) => x.personId === ctx.viewer.personId);
        if (
          env.status !== 'sent' ||
          me === undefined ||
          ['waiting', 'signed', 'declined'].includes(me.status)
        )
          continue;
        const doc = (await tx.documents.get(env.documentId))?.title ?? 'A document';
        needsYou.push({
          id: env.id,
          kind: 'sign',
          title: `Sign ${doc}`,
          detail: env.message || 'Waiting for your signature',
          dueOn: env.dueOn,
          documentId: env.documentId,
          typeKey: null,
        });
      }
      const members = await tx.members.list();
      const acked = await tx.campaigns.mine(ctx.viewer.personId);
      for (const c of await tx.campaigns.list()) {
        if (c.closedAt !== null || acked.has(c.id)) continue;
        if (!audienceOf(c.audience, members).includes(ctx.viewer.personId)) continue;
        const doc = open.find((d) => d.id === c.documentId);
        if (doc === undefined) continue;
        needsYou.push({
          id: c.id,
          kind: 'acknowledge',
          title: `Read and acknowledge ${doc.title}`,
          detail: `Version ${String(c.version)}`,
          dueOn: c.dueOn,
          documentId: doc.id,
          typeKey: null,
        });
      }
    }
    for (const r of await tx.accessRequests.open()) {
      const doc = open.find((d) => d.id === r.documentId);
      if (doc === undefined || !canShare(factsOf(doc, null), ctx.viewer).ok) continue;
      const who = dir.byAccount.get(r.requesterAccount)?.displayName ?? 'Someone';
      needsYou.push({
        id: r.id,
        kind: 'access_request',
        title: `${who} asked to open ${doc.title}`,
        detail: r.reason,
        dueOn: null,
        documentId: doc.id,
        typeKey: null,
      });
    }

    let tiles: z.infer<typeof Tile>[] = [];
    let queueRows: z.infer<typeof QueueRow>[] = [];
    if (ctx.viewer.hr) {
      const queues = await hrQueues(ctx, types, dir, live);
      tiles = queues.tiles;
      queueRows = params.queue === null ? [] : (queues.rows.get(params.queue) ?? []);
    }
    const ask = await tx.settings.get(`ask:${caller.accountId}`);
    const settings = await accessSettings(ctx);
    return ok({
      viewer: {
        hr: ctx.viewer.hr,
        name: ctx.member?.displayName ?? null,
        personId: ctx.viewer.personId,
        askAfterUpload: settings.askAfterUpload && ask !== false,
      },
      show,
      q: params.q,
      queue: params.queue,
      deleted: params.deleted,
      sections: sections
        .map((s) => ({ id: s.id, kind: s.kind, name: s.name, count: counts.get(s.id) ?? 0 }))
        .toSorted((a, b) =>
          a.kind === b.kind ? b.count - a.count : a.kind === 'company' ? -1 : 1,
        ),
      needsYou,
      tiles,
      queueRows,
      rows,
      total: live.length,
      types: typeOptions(types),
      // Names and teams only: who a document could be shared with or filed to.
      people: peopleOf(dir),
    });
  });
}

/** HR's four tiles and the rows each filters to (H1). */
async function hrQueues(ctx: Ctx, types: Types, dir: Directory, live: readonly Document[]) {
  const rows = new Map<string, z.infer<typeof QueueRow>[]>();
  const nameOf = (p: PersonId | null) => (p === null ? undefined : dir.byPerson.get(p));

  const exp = expiring(
    live.filter((d) => d.typeKey !== null).map((d) => ({ ...d, held: false })),
    ctx.today,
  );
  rows.set(
    'expiring',
    exp.map((d) => {
      const left = daysUntil(ctx.today, d.expiresOn ?? ctx.today);
      const person = nameOf(d.subjectPersonId);
      return {
        id: d.id,
        title: `${types.get(d.typeKey ?? '')?.name ?? d.title}${person ? ` · ${first(person.displayName)}` : ''}`,
        kind: d.kind,
        person: person ? personRef(person) : null,
        detail:
          left < 0
            ? `Expired ${d.expiresOn ?? ''}`
            : `In ${String(left)} days · ${d.expiresOn ?? ''}`,
        dueOn: d.expiresOn,
        tone: left < 0 ? 'danger' : 'warning',
        documentId: d.id,
        requestId: null,
        typeKey: d.typeKey,
        action: 'ask',
      };
    }),
  );

  const typeList = [...types.values()].filter((t) => !t.archived);
  const missing: z.infer<typeof QueueRow>[] = [];
  const requests = await ctx.tx.docRequests.open();
  for (const m of dir.byPerson.values()) {
    if (m.status === 'terminated') continue;
    const held = live
      .filter((d) => d.subjectPersonId === m.personId)
      .map((d) => ({ id: d.id, typeKey: d.typeKey, expiresOn: d.expiresOn }));
    const asked = requests
      .filter((r) => r.personId === m.personId)
      .map((r) => ({
        id: r.id,
        typeKey: r.typeKey,
        dueOn: r.dueOn,
        askedOn: r.createdAt.slice(0, 10) as never,
      }));
    for (const row of checklist(m, typeList, held, asked, ctx.today)) {
      if (row.state === 'have') continue;
      const type = types.get(row.typeKey);
      missing.push({
        id: `${m.personId}:${row.typeKey}`,
        title: `${row.name} · ${first(m.displayName)}`,
        kind: type?.kind ?? 'Form',
        person: personRef(m),
        detail:
          row.state === 'asked'
            ? `Asked ${row.askedOn ?? ''}`
            : row.dueOn
              ? `Needed by ${row.dueOn}`
              : 'Not asked yet',
        dueOn: row.dueOn,
        tone: row.state === 'asked' ? 'info' : 'warning',
        documentId: row.documentId,
        requestId: row.requestId,
        typeKey: row.typeKey,
        action: row.action === 'view' ? 'view' : row.action,
      });
    }
  }
  rows.set(
    'missing',
    missing.toSorted((a, b) => (a.dueOn ?? '9').localeCompare(b.dueOn ?? '9')),
  );

  const due = await retentionDue(ctx);
  rows.set(
    'to_delete',
    due.map((d) => {
      const person = nameOf(d.subjectPersonId);
      return {
        id: d.id,
        title: d.title,
        kind: d.kind,
        person: person ? personRef(person) : null,
        detail: `Retention ended ${d.retentionEnded}`,
        dueOn: d.retentionEnded,
        tone: 'neutral',
        documentId: d.id,
        requestId: null,
        typeKey: d.typeKey,
        action: 'confirm_delete',
      };
    }),
  );
  const openEnvelopes = await ctx.tx.envelopes.open();
  rows.set(
    'to_sign',
    openEnvelopes.map((env) => {
      const doc = live.find((d) => d.id === env.documentId);
      const waiting = env.signers.find(
        (s) => !['waiting', 'signed', 'declined'].includes(s.status),
      );
      const yours = waiting?.personId != null && waiting.personId === ctx.viewer.personId;
      const person = doc?.subjectPersonId == null ? undefined : nameOf(doc.subjectPersonId);
      return {
        id: env.id,
        title: doc?.title ?? 'A document',
        kind: doc?.kind ?? 'Contract',
        person: person ? personRef(person) : null,
        detail: `${String(env.signers.filter((s) => s.status === 'signed').length)} of ${String(env.signers.length)} signed${waiting ? ` · waiting for ${yours ? 'you' : first(waiting.name)}` : ''}`,
        dueOn: env.dueOn,
        tone: yours ? 'accent' : 'info',
        documentId: env.documentId,
        requestId: env.id,
        typeKey: doc?.typeKey ?? null,
        action: yours ? 'sign' : 'view',
      };
    }),
  );

  const firstExpiring = rows.get('expiring')?.[0];
  const missingPeople = [...new Set(missing.map((r) => r.person?.name ?? ''))].filter(Boolean);
  const tiles: z.infer<typeof Tile>[] = [
    {
      key: 'to_sign',
      label: 'To sign',
      count: rows.get('to_sign')?.length ?? 0,
      detail: (() => {
        const yours = (rows.get('to_sign') ?? []).filter((r) => r.action === 'sign').length;
        return (rows.get('to_sign')?.length ?? 0) === 0
          ? 'Nothing waiting'
          : yours > 0
            ? `${String(yours)} need yours`
            : 'Waiting on others';
      })(),
    },
    {
      key: 'expiring',
      label: 'Expiring',
      count: rows.get('expiring')?.length ?? 0,
      detail: firstExpiring ? `${firstExpiring.title} first` : 'Nothing in 60 days',
    },
    {
      key: 'missing',
      label: 'Missing',
      count: missing.length,
      detail:
        missingPeople.length === 0
          ? 'Every file complete'
          : missingPeople.slice(0, 2).map(first).join(' and ') +
            (missingPeople.length > 2 ? ` and ${String(missingPeople.length - 2)} more` : ''),
    },
    {
      key: 'to_delete',
      label: 'To delete',
      count: due.length,
      detail: due.length === 0 ? 'Nothing due' : 'Retention ended',
    },
  ];
  return { tiles, rows };
}

/** D1, E2, E3, MR1, MR4, MA2: the document, or who owns it when it is closed. */
export async function documentScreen(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
): Promise<Result<z.infer<typeof OpenOrClosed>>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const doc = await tx.documents.get(id);
    if (doc === null) return err(notFound());
    const [types, dir] = await Promise.all([typesOf(ctx), directory(ctx)]);
    const type = doc.typeKey === null ? null : (types.get(doc.typeKey) ?? null);
    const facts = factsOf(doc, type);
    const ownerName =
      dir.byAccount.get(doc.ownerAccount)?.displayName ??
      (doc.typeKey === null ? 'Its owner' : 'HR');
    if (!canOpen(facts, ctx.viewer, ctx.today)) {
      if (doc.deletedAt !== null) return err(notFound());
      const requested = (await tx.accessRequests.open()).some(
        (r) => r.documentId === id && r.requesterAccount === caller.accountId,
      );
      return ok({ document: null, closed: { owner: ownerName, requested } });
    }
    const [versions, sections, views, activity, held] = await Promise.all([
      tx.versions.list(id),
      tx.sections.visibleTo(caller.accountId),
      tx.views.list(id, 50),
      tx.activity.list({ documentId: id, limit: 50 }),
      tx.holds.held(),
    ]);
    const entries = await tx.sections.entries(sections.map((s) => s.id));
    const inSection = new Map([
      [id, entries.filter((e) => e.documentId === id).map((e) => e.sectionId)],
    ]);
    const versionViews = versions
      .toSorted((a, b) => b.n - a.n)
      .map((v) => ({
        n: v.n,
        fileName: v.fileName,
        mediaType: v.mediaType,
        size: v.size,
        pages: v.pages,
        note: v.note,
        uploadedAt: v.uploadedAt,
        uploadedBy: dir.byAccount.get(v.uploadedBy)?.displayName ?? null,
      }));
    const current = versionViews.find((v) => v.n === doc.currentVersion);
    if (current === undefined) return err(failure('NOT_FOUND', 'No such version'));
    const controls = canShare(facts, ctx.viewer).ok;
    const accountName = (a: string) => dir.byAccount.get(a)?.displayName ?? 'Someone';
    const view: DocumentView = {
      row: rowOf(
        ctx,
        doc,
        types,
        dir,
        inSection,
        current,
        (await tx.envelopes.latestFor([doc.id])).get(doc.id) ?? null,
      ),
      owner: ownerName,
      versions: versionViews,
      current,
      grants: doc.grants.map((g) => ({
        kind: g.grantee.kind,
        id:
          g.grantee.kind === 'member'
            ? g.grantee.personId
            : g.grantee.kind === 'team'
              ? g.grantee.teamKey
              : '*',
        label:
          g.grantee.kind === 'member'
            ? (dir.byPerson.get(g.grantee.personId)?.displayName ?? 'Someone')
            : g.grantee.kind === 'team'
              ? `${g.grantee.teamKey} team`
              : 'Everyone',
        permission: g.permission,
        endsOn: g.endsOn,
      })),
      may: {
        edit: canEdit(facts, ctx.viewer, ctx.today),
        share: controls,
        download: canDownload(facts, ctx.viewer, ctx.today),
        delete: canDelete(facts, ctx.viewer).ok,
        protect: !doc.confidential && canSetConfidential(facts, ctx.viewer, true).ok,
        unprotect: doc.confidential && canSetConfidential(facts, ctx.viewer, false).ok,
      },
      confidentialBy: doc.confidentialBy,
      // The view log is the owner's and HR's (PRD §9.2).
      views:
        controls || ctx.viewer.hr
          ? views.map((v) => ({ who: accountName(v.accountId), action: v.action, at: v.at }))
          : [],
      activity:
        controls || ctx.viewer.hr
          ? activity.map((a) => ({
              who: a.accountId ? accountName(a.accountId) : 'Kithena',
              action: a.action,
              at: a.at,
            }))
          : [],
      accessRequests: controls
        ? (await tx.accessRequests.open())
            .filter((r) => r.documentId === id)
            .map((r) => ({
              id: r.id,
              who: accountName(r.requesterAccount),
              reason: r.reason,
              at: r.createdAt,
            }))
        : [],
      held: held.has(id),
      people: controls ? peopleOf(dir) : [],
      signing: await (async () => {
        const env = (await tx.envelopes.forDocument(id))[0];
        if (env === undefined) return null;
        return {
          id: env.id,
          status: env.status,
          signed: env.signers.filter((s) => s.status === 'signed').length,
          of: env.signers.length,
          mine: env.signers.some((s) => s.personId !== null && s.personId === ctx.viewer.personId),
        };
      })(),
      campaigns: await (async () => {
        const members = [...dir.byPerson.values()];
        const mine =
          ctx.viewer.personId === null
            ? new Set<string>()
            : await tx.campaigns.mine(ctx.viewer.personId);
        const out = [];
        for (const c of (await tx.campaigns.list()).filter((x) => x.documentId === id)) {
          const asked = audienceOf(c.audience, members);
          const isAsked = ctx.viewer.personId !== null && asked.includes(ctx.viewer.personId);
          if (!ctx.viewer.hr && !isAsked) continue;
          const acked = await tx.campaigns.acknowledged(c.id);
          out.push({
            id: c.id,
            done: asked.filter((p) => acked.has(p)).length,
            of: asked.length,
            dueOn: c.dueOn,
            acknowledged: mine.has(c.id),
            asked: isAsked,
          });
        }
        return out;
      })(),
      pdf: current.mediaType === 'application/pdf',
    };
    return ok({ document: view, closed: null });
  });
}

/** B3, MH2: a person's file. Theirs, and HR's. */
export async function personFile(
  deps: Deps,
  caller: Caller,
  personId: PersonId,
): Promise<Result<z.infer<typeof PersonFileView>>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    if (!ctx.viewer.hr && ctx.viewer.personId !== personId) {
      return err(failure('NOT_FOUND', 'No such person'));
    }
    const member = await tx.members.get(personId);
    if (member === null) return err(failure('NOT_FOUND', 'No such person'));
    const [types, dir, docs, requests] = await Promise.all([
      typesOf(ctx),
      directory(ctx),
      tx.documents.about(personId),
      tx.docRequests.forPerson(personId),
    ]);
    const live = docs.filter(
      (d) =>
        d.deletedAt === null &&
        canOpen(
          factsOf(d, d.typeKey === null ? null : (types.get(d.typeKey) ?? null)),
          ctx.viewer,
          ctx.today,
        ),
    );
    const rows = checklist(
      member,
      [...types.values()].filter((t) => !t.archived),
      live.map((d) => ({ id: d.id, typeKey: d.typeKey, expiresOn: d.expiresOn })),
      requests
        .filter((r) => r.status === 'open')
        .map((r) => ({
          id: r.id,
          typeKey: r.typeKey,
          dueOn: r.dueOn,
          askedOn: r.createdAt.slice(0, 10) as never,
        })),
      ctx.today,
    );
    const pages = await pagesOf(ctx, live);
    const p = progress(rows);
    const fileSignings = await tx.envelopes.latestFor(live.map((d) => d.id));
    return ok({
      person: personRef(member),
      jobLine: [member.teamName, member.hireDate ? `starts ${member.hireDate}` : null]
        .filter(Boolean)
        .join(' · '),
      hireDate: member.hireDate,
      checklist: rows.map((r) => ({
        typeKey: r.typeKey,
        name: r.name,
        kind: types.get(r.typeKey)?.kind ?? 'Form',
        state: r.state,
        detail:
          r.state === 'have'
            ? r.expiresOn
              ? `Expires ${r.expiresOn}`
              : 'In their file'
            : r.state === 'asked'
              ? `Asked ${r.askedOn ?? ''}`
              : r.state === 'expired'
                ? `Expired ${r.expiresOn ?? ''}`
                : 'Not asked yet',
        documentId: r.documentId,
        requestId: r.requestId,
        dueOn: r.dueOn,
        action: r.action,
      })),
      have: p.have,
      of: p.of,
      rows: live
        .toSorted((a, b) => b.versionAt.localeCompare(a.versionAt))
        .map((d) =>
          rowOf(
            ctx,
            d,
            types,
            dir,
            new Map(),
            pages.get(d.id) ?? null,
            fileSignings.get(d.id) ?? null,
          ),
        ),
      hr: ctx.viewer.hr,
      types: typeOptions(types),
    });
  });
}

/** S1–S3, S5, S6: settings, readable by anyone, changed by HR. */
export async function settingsScreen(
  deps: Deps,
  caller: Caller,
): Promise<Result<z.infer<typeof SettingsView>>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const [types, docs, sections, holds] = await Promise.all([
      tx.types.list(),
      tx.documents.filed(),
      tx.sections.visibleTo(caller.accountId),
      tx.holds.list(),
    ]);
    const used = new Map<string, number>();
    for (const d of docs)
      if (d.typeKey !== null) used.set(d.typeKey, (used.get(d.typeKey) ?? 0) + 1);
    const dir = await directory(ctx);
    return ok({
      types: types.map((t) => ({
        ...t,
        used: used.get(t.key) ?? 0,
        retentionWords: retentionWords(t.retention),
      })),
      sections: sections
        .filter((s) => s.kind === 'company')
        .map((s) => ({ id: s.id, kind: s.kind, name: s.name, count: 0 })),
      access: await accessSettings(ctx),
      ai: await aiSwitches(ctx),
      holds: holds
        .filter((h) => h.liftedAt === null)
        .map((h) => ({
          id: h.id,
          name: h.name,
          setBy: dir.byAccount.get(h.setBy)?.displayName ?? 'HR',
          setAt: h.setAt,
          count: h.documentIds.length,
        })),
      hr: ctx.viewer.hr,
    });
  });
}
