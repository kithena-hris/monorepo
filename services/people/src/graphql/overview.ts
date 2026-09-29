import type { OverviewView } from '../application/screens/overview.js';
import type { PhotoView } from '../application/screens/photo.js';
import type { FileView } from '../application/screens/files.js';
import type { ActivityView } from '../application/settings/activity.js';
import type { NamesView } from '../application/screens/names.js';
import type { AssistantAnswer } from '../application/assistant/ask.js';
import type { ChatView } from '../application/settings/chat.js';
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

  type Setup = NonNullable<OverviewView['setup']>;
  const SetupOption = builder
    .objectRef<{ readonly value: string; readonly label: string }>('PeopleSetupOption')
    .implement({
      fields: (t) => ({ value: t.exposeString('value'), label: t.exposeString('label') }),
    });
  const SetupField = builder.objectRef<Setup['fields'][number]>('PeopleSetupField').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      sectionKey: t.exposeString('sectionKey'),
      label: t.exposeString('label'),
      description: t.exposeString('description', { nullable: true }),
      dataType: t.exposeString('dataType'),
      options: t.field({
        type: [SetupOption],
        resolve: (f) => list(f.options),
      }),
      required: t.exposeBoolean('required'),
    }),
  });
  const SetupRef = builder.objectRef<Setup>('PeopleOverviewSetup').implement({
    description:
      'What signing up still asks of the viewer: a photo, and the image and document fields collected at sign-up.',
    fields: (t) => ({
      photo: t.exposeString('photo', {
        nullable: true,
        description: 'optional or required; null when no photo is asked for.',
      }),
      fields: t.field({ type: [SetupField], resolve: (s) => list(s.fields) }),
    }),
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
      setup: t.field({ type: SetupRef, nullable: true, resolve: (o) => o.setup }),
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

  const File = builder.objectRef<FileView>('PeopleFile').implement({
    description: 'A file an image or document field holds, to somebody who may read that field.',
    fields: (t) => ({
      name: t.exposeString('name'),
      mediaType: t.exposeString('mediaType'),
      data: t.exposeString('data', { description: 'The file, base64.' }),
    }),
  });

  const ActivityEntry = builder
    .objectRef<ActivityView['entries'][number]>('PeopleSettingsActivityEntry')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        at: t.exposeString('at'),
        action: t.exposeString('action'),
        subject: t.exposeString('subject', { nullable: true }),
        detail: t.exposeString('detail', {
          nullable: true,
          description: 'What it did, in one plain sentence.',
        }),
        area: t.exposeString('area', {
          description: 'fields, organisation, roles or integrations.',
        }),
        by: t.exposeString('by'),
        name: t.exposeString('name', { description: 'Who did it, by name, "You" included.' }),
        avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
        kind: t.exposeString('kind', {
          description:
            'person; support for Kithena support, signed in from the back office; or system for an account nobody in People holds.',
        }),
        reason: t.exposeString('reason', {
          nullable: true,
          description: 'Why Kithena support was signed in, as the operator said. Null otherwise.',
        }),
      }),
    });
  const Activity = builder.objectRef<ActivityView>('PeopleSettingsActivity').implement({
    description: 'Every change to People’s settings, newest first: who, when and what.',
    fields: (t) => ({
      entries: t.field({ type: [ActivityEntry], resolve: (v) => list(v.entries) }),
      next: t.exposeString('next', { nullable: true }),
    }),
  });

  const Named = builder.objectRef<NamesView['people'][number]>('PeopleNamed').implement({
    fields: (t) => ({
      accountId: t.exposeID('accountId', { nullable: true }),
      personId: t.exposeID('personId'),
      name: t.exposeString('name'),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
    }),
  });
  const Names = builder.objectRef<NamesView>('PeopleNames').implement({
    fields: (t) => ({ people: t.field({ type: [Named], resolve: (v) => list(v.people) }) }),
  });

  const AnswerPerson = builder
    .objectRef<AssistantAnswer['people'][number]>('PeopleAnswerPerson')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        name: t.exposeString('name'),
        title: t.exposeString('title', { nullable: true }),
      }),
    });
  const Answer = builder.objectRef<AssistantAnswer>('PeopleAnswer').implement({
    description:
      'A question in words, answered as the asker: the model reads only the question and field names; People runs the query.',
    fields: (t) => ({
      text: t.exposeString('text'),
      understood: t.exposeString('understood', { description: 'How the question was read.' }),
      answered: t.exposeBoolean('answered', {
        description:
          'People understood the question and answered it: how an answer is chosen when several modules are asked.',
      }),
      people: t.field({ type: [AnswerPerson], resolve: (a) => list(a.people) }),
    }),
  });

  const ChatConnectionRef = builder
    .objectRef<NonNullable<ChatView['apps'][number]['connection']>>('PeopleChatConnection')
    .implement({
      fields: (t) => ({
        workspace: t.exposeString('workspace'),
        connectedAt: t.exposeString('connectedAt'),
      }),
    });
  const ChatAppRef = builder.objectRef<ChatView['apps'][number]>('PeopleChatApp').implement({
    description: 'A chat app the company may connect (Slack today).',
    fields: (t) => ({
      key: t.exposeString('key'),
      name: t.exposeString('name'),
      canConnect: t.exposeBoolean('canConnect'),
      connection: t.field({
        type: ChatConnectionRef,
        nullable: true,
        resolve: (a) => a.connection,
      }),
    }),
  });
  const ChatNoticeRef = builder
    .objectRef<ChatView['notices'][number]>('PeopleChatNotice')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        description: t.exposeString('description'),
        to: t.exposeString('to'),
        action: t.exposeString('action', { nullable: true }),
        on: t.exposeBoolean('on'),
      }),
    });
  const ChatFieldRef = builder
    .objectRef<ChatView['fields']['on'][number]>('PeopleChatField')
    .implement({ fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label') }) });
  const ChatFieldsRef = builder.objectRef<ChatView['fields']>('PeopleChatFields').implement({
    fields: (t) => ({
      on: t.field({ type: [ChatFieldRef], resolve: (f) => list(f.on) }),
      shareable: t.exposeInt('shareable'),
    }),
  });
  const Chat = builder.objectRef<ChatView>('PeopleChat').implement({
    description:
      'People in the company’s chat apps: connections, notices, and what the assistant may answer.',
    fields: (t) => ({
      apps: t.field({ type: [ChatAppRef], resolve: (v) => list(v.apps) }),
      notices: t.field({ type: [ChatNoticeRef], resolve: (v) => list(v.notices) }),
      fields: t.field({ type: ChatFieldsRef, resolve: (v) => v.fields }),
    }),
  });
  const chat = (ctx: Parameters<ViaRest>[0]) => viaRest<ChatView>(ctx, 'GET', '/v1/views/chat');

  builder.mutationFields((t) => ({
    connectChatApp: t.string({
      description:
        'Where to send the administrator to connect a chat app; they come back to `origin`.',
      args: { app: t.arg.string({ required: true }), origin: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) =>
        (
          await viaRest<{ url: string }>(
            ctx,
            'POST',
            `/v1/chat/apps/${encodeURIComponent(args.app)}/connect`,
            { body: { origin: args.origin } },
          )
        ).url,
    }),
    completeChatApp: t.field({
      type: Chat,
      description: 'Finish connecting a chat app with what it sent back.',
      args: {
        app: t.arg.string({ required: true }),
        code: t.arg.string({ required: true }),
        state: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', `/v1/chat/apps/${encodeURIComponent(args.app)}/complete`, {
          body: { code: args.code, state: args.state },
          key: args.idempotencyKey,
        });
        return chat(ctx);
      },
    }),
    disconnectChatApp: t.field({
      type: Chat,
      args: {
        app: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', `/v1/chat/apps/${encodeURIComponent(args.app)}/disconnect`, {
          body: {},
          key: args.idempotencyKey,
        });
        return chat(ctx);
      },
    }),
    setChatNotice: t.field({
      type: Chat,
      description: 'Send one of People’s notices to chat apps, or stop.',
      args: {
        key: t.arg.string({ required: true }),
        on: t.arg.boolean({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'PUT', `/v1/chat/notices/${encodeURIComponent(args.key)}`, {
          body: { on: args.on },
          key: args.idempotencyKey,
        });
        return chat(ctx);
      },
    }),
  }));

  builder.queryFields((t) => ({
    peopleChat: t.field({ type: Chat, resolve: (_root, _args, ctx) => chat(ctx) }),
    peopleAsk: t.field({
      type: Answer,
      args: {
        question: t.arg.string({ required: true }),
        earlier: t.arg.stringList({
          description: 'Earlier questions in the same conversation, oldest first, for a follow-up.',
        }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<AssistantAnswer>(ctx, 'POST', '/v1/assistant/ask', {
          body: { question: args.question, earlier: args.earlier ?? [] },
        }),
    }),
    peopleSettingsActivity: t.field({
      type: Activity,
      args: { before: t.arg.id(), area: t.arg.string() },
      resolve: (_root, args, ctx) => {
        const query = new URLSearchParams();
        if (args.before) query.set('before', args.before);
        if (args.area) query.set('area', args.area);
        const qs = query.toString();
        return viaRest<ActivityView>(
          ctx,
          'GET',
          `/v1/views/settings/activity${qs === '' ? '' : `?${qs}`}`,
        );
      },
    }),
    peopleNames: t.field({
      type: Names,
      description:
        'Names and faces for account and person ids another service holds (the activity log), as the viewer may read them.',
      args: { accountIds: t.arg.idList(), personIds: t.arg.idList() },
      resolve: (_root, args, ctx) => {
        const query = new URLSearchParams();
        if (args.accountIds) query.set('accounts', args.accountIds.join(','));
        if (args.personIds) query.set('people', args.personIds.join(','));
        return viaRest<NamesView>(ctx, 'GET', `/v1/views/names?${query.toString()}`);
      },
    }),
    peopleFile: t.field({
      type: File,
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<FileView>(ctx, 'GET', `/v1/views/files/${encodeURIComponent(args.id)}`),
    }),
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
