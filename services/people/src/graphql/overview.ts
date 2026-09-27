import type { OverviewView } from '../application/screens/overview.js';
import type { PhotoView } from '../application/screens/photo.js';
import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * Where People starts, and a person's photo, over GraphQL: each one REST
 * view through `viaRest`, so every rule is the application layer's — what the
 * viewer may read of each person, and whose inbox is whose.
 */

const list = <T>(items: readonly T[]): T[] => [...items];

type Me = NonNullable<OverviewView['me']>;
type Line = NonNullable<OverviewView['reportingLine']>;
type Approvals = NonNullable<OverviewView['approvals']>;

export function defineOverview(builder: PeopleBuilder, viaRest: ViaRest): void {
  const Roles = builder.objectRef<OverviewView['roles']>('PeopleOverviewRoles').implement({
    fields: (t) => ({
      hr: t.exposeBoolean('hr'),
      admin: t.exposeBoolean('admin'),
      finance: t.exposeBoolean('finance'),
    }),
  });

  const MeRef = builder.objectRef<Me>('PeopleOverviewMe').implement({
    description: 'The viewer’s own record, as they may read it.',
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
      title: t.exposeString('title', { nullable: true }),
      department: t.exposeString('department', { nullable: true }),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      location: t.exposeString('location', { nullable: true }),
      timeZone: t.exposeString('timeZone'),
      startedOn: t.exposeString('startedOn', { nullable: true }),
      today: t.exposeString('today', { description: 'Today on their calendar.' }),
      status: t.exposeString('status', { nullable: true }),
      missing: t.exposeInt('missing', { nullable: true }),
      required: t.exposeInt('required'),
    }),
  });

  const Person = builder.objectRef<Line['managers'][number]>('PeopleOverviewPerson').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      title: t.exposeString('title', { nullable: true }),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
    }),
  });

  const LineRef = builder.objectRef<Line>('PeopleReportingLine').implement({
    fields: (t) => ({
      managers: t.field({
        type: [Person],
        description: 'Nearest first.',
        resolve: (l) => list(l.managers),
      }),
      moreAbove: t.exposeBoolean('moreAbove'),
      peers: t.exposeInt('peers', { nullable: true }),
      reports: t.field({ type: [Person], resolve: (l) => list(l.reports) }),
      reportsTotal: t.exposeInt('reportsTotal'),
      reportsFilter: t.exposeString('reportsFilter', {
        nullable: true,
        description: 'The directory filter for all of them.',
      }),
    }),
  });

  const ApprovalRef = builder
    .objectRef<Approvals['items'][number]>('PeopleOverviewApproval')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        personId: t.exposeID('personId'),
        name: t.exposeString('name'),
        avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
        label: t.exposeString('label'),
        requestedAt: t.exposeString('requestedAt'),
        requestedBy: t.exposeString('requestedBy'),
      }),
    });
  const ApprovalsRef = builder.objectRef<Approvals>('PeopleOverviewApprovals').implement({
    fields: (t) => ({
      isHr: t.exposeBoolean('isHr'),
      total: t.exposeInt('total'),
      items: t.field({ type: [ApprovalRef], resolve: (a) => list(a.items) }),
    }),
  });

  const MissingRef = builder
    .objectRef<OverviewView['missing'][number]>('PeopleOverviewMissing')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        sectionKey: t.exposeString('sectionKey'),
        section: t.exposeString('section'),
        ownedBy: t.exposeString('ownedBy', {
          nullable: true,
          description: 'Who fills it in; null when the viewer does.',
        }),
      }),
    });

  const Team = builder
    .objectRef<NonNullable<OverviewView['team']>>('PeopleOverviewTeam')
    .implement({
      fields: (t) => ({ waiting: t.exposeInt('waiting'), toFill: t.exposeInt('toFill') }),
    });

  const Overview = builder.objectRef<OverviewView>('PeopleOverview').implement({
    description: 'Where People starts: the viewer, their reporting line, and what waits for them.',
    fields: (t) => ({
      roles: t.field({ type: Roles, resolve: (o) => o.roles }),
      now: t.exposeString('now', {
        description: 'When the page was drawn: what a local time and an age are read against.',
      }),
      me: t.field({ type: MeRef, nullable: true, resolve: (o) => o.me }),
      reportingLine: t.field({ type: LineRef, nullable: true, resolve: (o) => o.reportingLine }),
      approvals: t.field({ type: ApprovalsRef, nullable: true, resolve: (o) => o.approvals }),
      missing: t.field({ type: [MissingRef], resolve: (o) => list(o.missing) }),
      team: t.field({ type: Team, nullable: true, resolve: (o) => o.team }),
    }),
  });

  const Photo = builder.objectRef<PhotoView>('PeoplePhoto').implement({
    description: 'A person’s photo, to somebody who may read the person.',
    fields: (t) => ({
      mediaType: t.exposeString('mediaType'),
      data: t.exposeString('data', { description: 'The file, base64.' }),
      checksum: t.exposeString('checksum'),
    }),
  });

  builder.queryFields((t) => ({
    peopleOverview: t.field({
      type: Overview,
      resolve: (_root, _args, ctx) => viaRest<OverviewView>(ctx, 'GET', '/v1/views/overview'),
    }),
    peoplePhoto: t.field({
      type: Photo,
      args: { personId: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<PhotoView>(ctx, 'GET', `/v1/views/photos/${encodeURIComponent(args.personId)}`),
    }),
  }));
}
