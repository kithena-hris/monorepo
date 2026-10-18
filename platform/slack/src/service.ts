import { ASSISTANT_LIMITS } from '@kithena/contracts';

import {
  approvalsMessage,
  fillView,
  noticeMessage,
  performanceMessage,
  recruitingMessage,
  savedView,
  textMessage,
  timeOffApprovalMessage,
  valuesOf,
  type Approval,
  type Form,
  type Notice,
} from './blocks.js';
import { answerText, helpText, type Question } from './events.js';
import { signState, verifyState } from './secrets.js';
import type { FoundMessage } from './slack-api.js';
import type { Store } from './store.js';

/**
 * What the Slack service does, with Slack, People and its tables as ports:
 * answer a question, send a notice, handle a button or a form, and connect or
 * disconnect a company's workspace.
 *
 * It holds no Kithena data. Everything a message shows is read from People as
 * the person reading it, when it is drawn; every button is People's own route,
 * called as whoever pressed it, except Time Off's, whose signed value is passed
 * to Time Off as it came. What it keeps is which workspace is which
 * company, and that workspace's token; and in memory, for half an hour, the
 * last few questions of a conversation, so a follow-up can be read. Which notices are sent is each
 * module's setting; a notice that arrives here was switched on there.
 */

/** What "Add to Slack" asks a workspace for. `manifest.json` lists the same. */
export const BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'commands',
  'im:history',
  'im:read',
  'im:write',
  'users:read',
  'users:read.email',
] as const;

export type Outcome<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly message: string; readonly field?: string };

/** People, over internal HTTP: what a button or a form does, as whoever pressed it. */
export interface People {
  act<T>(tenantId: string, email: string, action: Record<string, unknown>): Promise<Outcome<T>>;
}

/**
 * The assistant (`platform/assistant`), over internal HTTP: a question in
 * words, answered across every module the company has, as the asker.
 */
export interface Assistant {
  ask(
    tenantId: string,
    email: string,
    question: string,
    /** Earlier questions in the same conversation, oldest first: never their answers. */
    earlier: readonly string[],
  ): Promise<{ readonly text: string; readonly understood: string; readonly answered?: boolean }>;
}

/**
 * Performance, over internal HTTP (PRF-164): a press on one of its buttons,
 * passed on as it came; and a request the assistant could not answer as a
 * question, which Performance may plan as actions for the person to confirm.
 */
export interface Performance {
  relay(tenantId: string, value: string): Promise<{ text: string }>;
  plan(
    tenantId: string,
    email: string,
    text: string,
  ): Promise<{
    readonly reply: string;
    readonly steps: readonly string[];
    /** Do it's value, signed by Performance; absent when there is nothing to do. */
    readonly run?: string;
  } | null>;
}

/** What Performance sends: to a person by address, with its buttons. */
export interface PerformanceMessage {
  readonly email: string;
  readonly text: string;
  readonly buttons?: readonly {
    readonly label: string;
    readonly value: string;
    readonly style?: 'primary' | 'danger';
  }[];
}

/*
 * Follow-ups (assistant PRD §4, §17). People's `EARLIER`
 * (`services/people/src/application/assistant/ask.ts`), copied because a
 * platform service cannot import a module: the last five questions, never
 * their answers. Change both together.
 */
export const EARLIER = 5;
const EARLIER_MS = 30 * 60_000;

/**
 * The last questions asked in each conversation, in this process's memory
 * and nowhere else (§12.4), so "and tomorrow?" can be read as a follow-up.
 * A question is kept for 30 minutes; a conversation asked nothing for that
 * long is forgotten, and beyond `max` the one asked in longest ago goes first.
 * ponytail: one process; a restart forgets every conversation, which costs a
 * follow-up its context and nothing else.
 */
export interface Conversations {
  /** The questions asked here in the last 30 minutes, oldest first; this one is kept after them. */
  remember(key: string, question: string): readonly string[];
  /** Conversations held now. */
  size(): number;
}

export function conversations(now: () => number, max = 1_000): Conversations {
  // Insertion order is last-asked order: each question moves its conversation to the end.
  const held = new Map<string, readonly { readonly text: string; readonly at: number }[]>();
  return {
    remember(key, question) {
      const at = now();
      for (const [k, asked] of held) {
        if (at - (asked.at(-1)?.at ?? 0) < EARLIER_MS) break;
        held.delete(k);
      }
      const recent = (held.get(key) ?? []).filter((q) => at - q.at < EARLIER_MS);
      held.delete(key);
      const text = question.slice(0, ASSISTANT_LIMITS.question);
      held.set(key, [...recent, { text, at }].slice(-EARLIER));
      const oldest = held.keys().next();
      if (held.size > max && oldest.done !== true) held.delete(oldest.value);
      return recent.map((q) => q.text);
    },
    size: () => held.size,
  };
}

/** A direct message, or a thread, for one person; a slash command is no conversation. */
function conversationOf(q: Question): string | null {
  const to = q.reply;
  if (to.via === 'channel') return `${q.team}:${q.user}:${to.channel}`;
  if (to.via === 'thread') return `${q.team}:${q.user}:${to.channel}:${to.threadTs}`;
  return null;
}

/** Time Off, over internal HTTP: a press on one of its buttons, answered with what the message becomes. */
export interface TimeOff {
  relay(tenantId: string, value: string): Promise<{ text: string }>;
}

/** Recruiting, over internal HTTP: a press on its Approve, answered with what the message becomes. */
export interface Recruiting {
  relay(tenantId: string, value: string): Promise<{ text: string }>;
}

/** What Recruiting sends: to a person by address, or into a channel Kithena was invited to. */
export interface RecruitingMessage {
  readonly to: { readonly email: string } | { readonly channel: string };
  readonly text: string;
  readonly approve?: string;
  readonly links?: readonly { readonly label: string; readonly url: string }[];
}

export interface Slack {
  emailOf(token: string, user: string): Promise<string | null>;
  userByEmail(token: string, email: string): Promise<string | null>;
  postBlocks(
    token: string,
    m: { channel: string; text: string; blocks: readonly unknown[] },
  ): Promise<void>;
  postMessage(
    token: string,
    m: { channel: string; text: string; threadTs?: string },
  ): Promise<void>;
  /** Seen by `user` alone, in `channel` (and its thread). */
  postEphemeral(
    token: string,
    m: { channel: string; user: string; text: string; threadTs: string },
  ): Promise<void>;
  respond(url: string, text: string): Promise<void>;
  replaceMessage(url: string, m: { text: string; blocks: readonly unknown[] }): Promise<void>;
  openView(token: string, triggerId: string, view: unknown): Promise<string>;
  updateView(token: string, viewId: string, view: unknown): Promise<void>;
  exchangeCode(c: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{
    botToken: string;
    teamId: string;
    teamName: string;
    botUserId: string;
  }>;
  revoke(token: string): Promise<void>;
  exchangeUserCode(c: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{ userToken: string; userId: string; teamId: string }>;
  searchMessages(userToken: string, query: string, count: number): Promise<readonly FoundMessage[]>;
}

/** What a person's own token may do: search what they can see, nothing else. */
export const USER_SCOPES = ['search:read'] as const;

/** One message found for a person's draft: never stored, discarded after the request. */
export interface Evidence {
  readonly link: string;
  readonly date: string;
  readonly kind: 'message';
  readonly text: string;
}

export interface OAuth {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Registered with Slack: the auth origin's `/chat/slack/done`. */
  readonly redirectUri: string;
  /** Registered with Slack too: the auth origin's `/tools/slack/done`, for a person's own grant. */
  readonly toolRedirectUri: string;
  readonly stateSecret: Buffer;
}

export interface Deps {
  readonly store: Store;
  readonly people: People;
  readonly assistant: Assistant;
  readonly timeOff: TimeOff;
  readonly recruiting?: Recruiting;
  readonly performance?: Performance;
  readonly slack: Slack;
  readonly command: string;
  readonly oauth: OAuth | null;
  readonly now: () => number;
  /**
   * Off production only: a test workspace's people are not the company's, so
   * every Slack user is answered as this Kithena email, and a notice for it is
   * delivered to `devInbox`, a real Slack user's email.
   */
  readonly dev?: { readonly actAs: string; readonly inbox: string | null };
  /** A token that is the environment's own, never revoked on disconnect. */
  readonly keepToken?: string;
}

export interface Connection {
  readonly teamName: string;
  readonly installedAt: string;
}

const SORRY = 'Kithena could not do that just now. Try again in a moment.';

export interface SlackService {
  question(q: Question): Promise<void>;
  notify(
    tenantId: string,
    notice: Notice & { readonly email: string },
  ): Promise<'sent' | 'not_connected' | 'not_in_slack'>;
  askTimeOff(
    tenantId: string,
    ask: {
      readonly email: string;
      readonly text: string;
      readonly approve: string;
      readonly decline: string;
    },
  ): Promise<'sent' | 'not_connected' | 'not_in_slack'>;
  tellRecruiting(
    tenantId: string,
    message: RecruitingMessage,
  ): Promise<'sent' | 'not_connected' | 'not_in_slack' | 'not_in_channel'>;
  tellPerformance(
    tenantId: string,
    message: PerformanceMessage,
  ): Promise<'sent' | 'not_connected' | 'not_in_slack'>;
  interact(payload: Interaction): Promise<unknown>;
  status(
    tenantId: string,
  ): Promise<{ readonly canConnect: boolean; readonly connection: Connection | null }>;
  authorizeUrl(tenantId: string, accountId: string, origin: string): string | null;
  complete(tenantId: string, code: string, state: string): Promise<Outcome<Connection>>;
  disconnect(tenantId: string): Promise<void>;
  /** Where a person approves Kithena reading what they can see (Performance §22.3). */
  toolAuthorizeUrl(
    tenantId: string,
    personId: string,
    origin: string,
  ): Promise<Outcome<{ readonly url: string }>>;
  toolComplete(
    tenantId: string,
    personId: string,
    code: string,
    state: string,
  ): Promise<Outcome<{ readonly account: string }>>;
  /** What `subjectEmail` wrote in the period, as `personId` can see it in Slack. */
  toolSearch(
    tenantId: string,
    personId: string,
    q: { readonly subjectEmail: string; readonly from: string; readonly to: string },
  ): Promise<Outcome<{ readonly items: readonly Evidence[] }>>;
  toolRevoke(tenantId: string, personId: string): Promise<void>;
}

export function slackService(deps: Deps): SlackService {
  const kept = conversations(deps.now);
  /** The company and token a workspace's message is for, or null when it is not connected. */
  const workspace = async (teamId: string) => {
    const tenantId = await deps.store.companyOf(teamId);
    if (tenantId === null) return null;
    const installation = await deps.store.installation(tenantId);
    return installation === null ? null : { tenantId, token: installation.botToken };
  };

  const emailOf = async (token: string, user: string) =>
    deps.dev?.actAs ?? (await deps.slack.emailOf(token, user));

  /** The person's direct message in the company's workspace, or why there is none. */
  const recipient = async (
    tenantId: string,
    email: string,
  ): Promise<{ token: string; user: string } | 'not_connected' | 'not_in_slack'> => {
    const installation = await deps.store.installation(tenantId);
    if (installation === null) return 'not_connected';
    const token = installation.botToken;
    const address = deps.dev !== undefined && email === deps.dev.actAs ? deps.dev.inbox : email;
    const user = address === null ? null : await deps.slack.userByEmail(token, address);
    return user === null ? 'not_in_slack' : { token, user };
  };

  const approvalsFor = async (
    tenantId: string,
    email: string,
    url: string,
    said: string | null,
  ) => {
    const found = await deps.people.act<{ items: Approval[] }>(tenantId, email, {
      action: 'approvals',
    });
    return found.ok ? approvalsMessage(found.body.items, url, said) : null;
  };

  return {
    /** A question, answered where it was asked, as whoever asked it. */
    async question(q: Question): Promise<void> {
      const where = await workspace(q.team);
      if (where === null) return;
      let text: string;
      if (q.text === '') text = helpText(deps.command);
      else {
        const email = await emailOf(where.token, q.user);
        const key = conversationOf(q);
        const answer =
          email === null
            ? null
            : await deps.assistant
                .ask(where.tenantId, email, q.text, key === null ? [] : kept.remember(key, q.text))
                .catch(() => null);
        // Not a question the assistant can answer: perhaps something to do in
        // Performance, planned there and shown with Do it for the asker to confirm.
        if (email !== null && answer?.answered === false && deps.performance !== undefined) {
          const planned = await deps.performance
            .plan(where.tenantId, email, q.text)
            .catch(() => null);
          if (planned !== null && planned.run !== undefined && planned.steps.length > 0) {
            const message = performanceMessage({
              text: [planned.reply, ...planned.steps.map((s) => `• ${s}`)].join('\n'),
              buttons: [{ label: 'Do it', value: planned.run, style: 'primary' }],
            });
            // To the asker alone: a direct message, with a word where they asked.
            const to = q.reply;
            const sent = 'I’ve sent you what I would do, to confirm, in a direct message.';
            await deps.slack.postBlocks(where.token, {
              channel: to.via === 'channel' ? to.channel : q.user,
              ...message,
            });
            if (to.via === 'response_url') await deps.slack.respond(to.url, sent);
            else if (to.via === 'thread')
              await deps.slack.postEphemeral(where.token, {
                channel: to.channel,
                user: q.user,
                text: sent,
                threadTs: to.threadTs,
              });
            return;
          }
        }
        text =
          email === null
            ? 'I could not read your email from Slack, so I cannot tell who you are in Kithena.'
            : answer === null
              ? SORRY
              : answerText(answer);
      }
      const to = q.reply;
      if (to.via === 'response_url') await deps.slack.respond(to.url, text);
      // A mention's answer is for the asker, not the channel (assistant PRD §5).
      else if (to.via === 'thread')
        await deps.slack.postEphemeral(where.token, {
          channel: to.channel,
          user: q.user,
          text,
          threadTs: to.threadTs,
        });
      else await deps.slack.postMessage(where.token, { channel: to.channel, text });
    },

    /** A module's notice, to the person in the company's workspace. Says why when it is not sent. */
    async notify(
      tenantId: string,
      notice: Notice & { readonly email: string },
    ): Promise<'sent' | 'not_connected' | 'not_in_slack'> {
      const to = await recipient(tenantId, notice.email);
      if (typeof to === 'string') return to;
      const message =
        (notice.event === 'approval_requested'
          ? await approvalsFor(tenantId, notice.email, notice.url, null)
          : null) ?? noticeMessage(notice);
      await deps.slack.postBlocks(to.token, { channel: to.user, ...message });
      return 'sent';
    },

    /** Time Off asking an approver, with its two signed buttons. Says why when it is not sent. */
    async askTimeOff(tenantId, ask) {
      const to = await recipient(tenantId, ask.email);
      if (typeof to === 'string') return to;
      await deps.slack.postBlocks(to.token, { channel: to.user, ...timeOffApprovalMessage(ask) });
      return 'sent';
    },

    /** Recruiting's digest, reminder, approval or interview. Says why when it is not sent. */
    async tellRecruiting(tenantId, message) {
      const blocks = recruitingMessage(message);
      if ('channel' in message.to) {
        const installation = await deps.store.installation(tenantId);
        if (installation === null) return 'not_connected';
        try {
          await deps.slack.postBlocks(installation.botToken, {
            channel: message.to.channel,
            ...blocks,
          });
        } catch (e) {
          if (/not_in_channel|channel_not_found/u.test(String(e))) return 'not_in_channel';
          throw e;
        }
        return 'sent';
      }
      const to = await recipient(tenantId, message.to.email);
      if (typeof to === 'string') return to;
      await deps.slack.postBlocks(to.token, { channel: to.user, ...blocks });
      return 'sent';
    },

    /** Performance's notice, reminder or proposal, with its buttons. Says why when it is not sent. */
    async tellPerformance(tenantId, message) {
      const to = await recipient(tenantId, message.email);
      if (typeof to === 'string') return to;
      await deps.slack.postBlocks(to.token, {
        channel: to.user,
        ...performanceMessage(message),
      });
      return 'sent';
    },

    /**
     * A button or a form. Returns what the acknowledgement carries — a form's
     * errors, or the view that replaces it — or undefined for a plain one.
     */
    async interact(payload: Interaction): Promise<unknown> {
      const where = await workspace(payload.team?.id ?? '');
      if (where === null) return undefined;

      // Time Off's button: its value is Time Off's to read, and it names the approver itself.
      const pressed = payload.type === 'block_actions' ? payload.actions?.[0] : undefined;
      if (pressed?.action_id.startsWith('timeoff_') === true && pressed.value) {
        const answer = await deps.timeOff
          .relay(where.tenantId, pressed.value)
          .catch(() => ({ text: 'Time Off could not take that just now. Try again in a moment.' }));
        if (payload.response_url)
          await deps.slack.replaceMessage(payload.response_url, textMessage(answer.text));
        return undefined;
      }
      if (
        pressed?.action_id.startsWith('performance_') === true &&
        pressed.value &&
        deps.performance !== undefined
      ) {
        const answer = await deps.performance.relay(where.tenantId, pressed.value).catch(() => ({
          text: 'Performance could not take that just now. Try again in a moment.',
        }));
        if (payload.response_url)
          await deps.slack.replaceMessage(payload.response_url, textMessage(answer.text));
        return undefined;
      }
      if (
        pressed?.action_id === 'recruiting_approve' &&
        pressed.value &&
        deps.recruiting !== undefined
      ) {
        const answer = await deps.recruiting.relay(where.tenantId, pressed.value).catch(() => ({
          text: 'Recruiting could not take that just now. Try again in a moment.',
        }));
        if (payload.response_url)
          await deps.slack.replaceMessage(payload.response_url, textMessage(answer.text));
        return undefined;
      }

      const email = await emailOf(where.token, payload.user?.id ?? '');
      if (email === null) return undefined;

      if (payload.type === 'block_actions') {
        const action = payload.actions?.[0];
        const url = openUrlOf(payload.message) ?? '';
        if (action === undefined) return undefined;

        if ((action.action_id === 'approve' || action.action_id === 'reject') && action.value) {
          const approve = action.action_id === 'approve';
          const before = await deps.people.act<{ items: Approval[] }>(where.tenantId, email, {
            action: 'approvals',
          });
          const item = before.ok ? before.body.items.find((i) => i.id === action.value) : undefined;
          const done = await deps.people.act(where.tenantId, email, {
            action: 'decide',
            id: action.value,
            approve,
          });
          const said = done.ok
            ? `${approve ? ':white_check_mark: You approved' : ':x: You rejected'} ${item === undefined ? 'the change' : `${item.name}’s ${item.label}`}.`
            : `:warning: ${done.message}`;
          const next = await approvalsFor(where.tenantId, email, url, said);
          if (next !== null && payload.response_url)
            await deps.slack.replaceMessage(payload.response_url, next);
          return undefined;
        }

        if (action.action_id === 'fill' && payload.trigger_id) {
          const viewId = await deps.slack.openView(where.token, payload.trigger_id, loadingView);
          const form = await deps.people.act<Form>(where.tenantId, email, { action: 'form' });
          await deps.slack.updateView(
            where.token,
            viewId,
            form.ok ? fillView(form.body, url) : messageView(form.message),
          );
        }
        return undefined;
      }

      if (payload.type === 'view_submission' && payload.view?.callback_id === 'fill') {
        const values = valuesOf(payload.view.state?.values ?? {});
        const saved = await deps.people.act<{ saved: number }>(where.tenantId, email, {
          action: 'fill',
          values,
        });
        if (saved.ok) return { response_action: 'update', view: savedView(saved.body.saved) };
        const block =
          saved.field !== undefined && saved.field in values ? saved.field : Object.keys(values)[0];
        return block === undefined
          ? { response_action: 'update', view: messageView(saved.message) }
          : { response_action: 'errors', errors: { [block]: saved.message } };
      }
      return undefined;
    },

    /* ------------------------------------------------------ settings -- */

    async status(tenantId: string) {
      const installation = await deps.store.installation(tenantId);
      return {
        canConnect: deps.oauth !== null,
        connection:
          installation === null
            ? null
            : ({
                teamName: installation.teamName,
                installedAt: installation.installedAt,
              } satisfies Connection),
      };
    },

    /** Where "Add to Slack" sends the administrator. */
    authorizeUrl(tenantId: string, accountId: string, origin: string): string | null {
      if (deps.oauth === null) return null;
      const url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.set('client_id', deps.oauth.clientId);
      url.searchParams.set('scope', BOT_SCOPES.join(','));
      url.searchParams.set('redirect_uri', deps.oauth.redirectUri);
      url.searchParams.set(
        'state',
        signState(deps.oauth.stateSecret, { t: tenantId, a: accountId, o: origin }, deps.now()),
      );
      return url.toString();
    },

    /** Slack sent them back: keep the workspace's token, as this company's. */
    async complete(tenantId: string, code: string, state: string): Promise<Outcome<Connection>> {
      if (deps.oauth === null) return { ok: false, message: 'Slack is not set up here.' };
      const claims = verifyState(deps.oauth.stateSecret, state, deps.now());
      if (claims === null || claims.t !== tenantId) {
        return {
          ok: false,
          message: 'That link expired or was not started here. Start again from Settings.',
        };
      }
      const got = await deps.slack
        .exchangeCode({
          clientId: deps.oauth.clientId,
          clientSecret: deps.oauth.clientSecret,
          code,
          redirectUri: deps.oauth.redirectUri,
        })
        .catch(() => null);
      if (got === null)
        return { ok: false, message: 'Slack did not confirm the connection. Try again.' };
      const owner = await deps.store.companyOf(got.teamId);
      if (owner !== null && owner !== tenantId) {
        return {
          ok: false,
          message: `${got.teamName} is already connected to another company in Kithena.`,
        };
      }
      const installedAt = new Date(deps.now()).toISOString();
      await deps.store.install({ tenantId, ...got, installedBy: claims.a, installedAt });
      return { ok: true, body: { teamName: got.teamName, installedAt } };
    },

    async disconnect(tenantId: string): Promise<void> {
      const installation = await deps.store.installation(tenantId);
      if (installation === null) return;
      if (installation.botToken !== deps.keepToken)
        await deps.slack.revoke(installation.botToken).catch(() => undefined);
      await deps.store.uninstall(tenantId);
    },

    /* ------------------------------------- a person's own Slack, §22.3 -- */

    async toolAuthorizeUrl(tenantId, personId, origin) {
      if (deps.oauth === null) return { ok: false, message: 'Slack is not set up here.' };
      // The company connects Slack first; a person then links their own account.
      if ((await deps.store.installation(tenantId)) === null)
        return { ok: false, message: 'Your company has not added Kithena to Slack yet.' };
      const url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.set('client_id', deps.oauth.clientId);
      url.searchParams.set('user_scope', USER_SCOPES.join(','));
      url.searchParams.set('redirect_uri', deps.oauth.toolRedirectUri);
      url.searchParams.set(
        'state',
        signState(deps.oauth.stateSecret, { t: tenantId, a: personId, o: origin }, deps.now()),
      );
      return { ok: true, body: { url: url.toString() } };
    },

    async toolComplete(tenantId, personId, code, state) {
      if (deps.oauth === null) return { ok: false, message: 'Slack is not set up here.' };
      const claims = verifyState(deps.oauth.stateSecret, state, deps.now());
      // Finished by the person who started it, for the company it started in.
      if (claims === null || claims.t !== tenantId || claims.a !== personId)
        return { ok: false, message: 'That link expired or was not started here. Try again.' };
      const installation = await deps.store.installation(tenantId);
      if (installation === null)
        return { ok: false, message: 'Your company has not added Kithena to Slack yet.' };
      const got = await deps.slack
        .exchangeUserCode({
          clientId: deps.oauth.clientId,
          clientSecret: deps.oauth.clientSecret,
          code,
          redirectUri: deps.oauth.toolRedirectUri,
        })
        .catch(() => null);
      if (got === null) return { ok: false, message: 'Slack did not confirm it. Try again.' };
      if (got.teamId !== installation.teamId) {
        await deps.slack.revoke(got.userToken).catch(() => undefined);
        return {
          ok: false,
          message: `Link the account you use in ${installation.teamName}, your company's workspace.`,
        };
      }
      await deps.store.keepPersonToken({
        tenantId,
        personId,
        slackUserId: got.userId,
        token: got.userToken,
        grantedAt: new Date(deps.now()).toISOString(),
      });
      // Slack names the person by an id; their email is what they recognise.
      const email = await deps.slack.emailOf(installation.botToken, got.userId).catch(() => null);
      return { ok: true, body: { account: email ?? got.userId } };
    },

    async toolSearch(tenantId, personId, q) {
      const [mine, installation] = await Promise.all([
        deps.store.personToken(tenantId, personId),
        deps.store.installation(tenantId),
      ]);
      if (mine === null || installation === null)
        return { ok: false, message: 'Slack is not linked.' };
      const subject = await deps.slack
        .userByEmail(installation.botToken, q.subjectEmail)
        .catch(() => null);
      if (subject === null) return { ok: true, body: { items: [] } };
      // Slack's after: and before: leave out the day named, so one day wider.
      const day = (date: string, by: number): string =>
        new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
      const found = await deps.slack
        .searchMessages(
          mine.token,
          `from:<@${subject}> after:${day(q.from, -1)} before:${day(q.to, 1)}`,
          40,
        )
        .catch(() => null);
      if (found === null) return { ok: false, message: 'Slack did not answer the search.' };
      return {
        ok: true,
        body: {
          items: found.map((m) => ({
            link: m.link,
            date: new Date(Number(m.ts) * 1000).toISOString().slice(0, 10),
            kind: 'message' as const,
            text: `In ${m.channel}: ${m.text.slice(0, 500)}`,
          })),
        },
      };
    },

    async toolRevoke(tenantId, personId) {
      const mine = await deps.store.personToken(tenantId, personId);
      if (mine === null) return;
      await deps.slack.revoke(mine.token).catch(() => undefined);
      await deps.store.dropPersonToken(tenantId, personId);
    },
  };
}

/** The parts of an interaction payload this reads. */
export interface Interaction {
  readonly type: string;
  readonly team?: { readonly id?: string };
  readonly user?: { readonly id?: string };
  readonly trigger_id?: string;
  readonly response_url?: string;
  readonly actions?: readonly { readonly action_id: string; readonly value?: string }[];
  readonly message?: { readonly blocks?: readonly unknown[] };
  readonly view?: {
    readonly callback_id?: string;
    readonly state?: { readonly values?: Record<string, Record<string, never>> };
  };
}

/** The "Open in Kithena" link a message carries, so a redrawn one keeps it. */
export function openUrlOf(message: Interaction['message']): string | null {
  for (const block of message?.blocks ?? []) {
    const elements =
      (block as { elements?: readonly { action_id?: string; url?: string }[] }).elements ?? [];
    const open = elements.find((e) => e.action_id === 'open');
    if (open?.url !== undefined) return open.url;
  }
  return null;
}

const loadingView = {
  type: 'modal',
  title: { type: 'plain_text', text: 'Your details' },
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'One moment…' } }],
};

const messageView = (text: string) => ({
  type: 'modal',
  title: { type: 'plain_text', text: 'Your details' },
  close: { type: 'plain_text', text: 'Close' },
  blocks: [{ type: 'section', text: { type: 'plain_text', text } }],
});
