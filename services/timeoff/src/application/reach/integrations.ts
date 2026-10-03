import { createHmac, timingSafeEqual } from 'node:crypto';

import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  LeaveApproved,
  LeaveCancelled,
  ParentalBirthRecorded,
  PeriodClosed,
  TenantId,
  type Instant,
  type LocationKey,
} from '@kithena/contracts';

import { de } from '../../country-packs/de.js';
import { es } from '../../country-packs/es.js';
import { gb } from '../../country-packs/gb.js';
import type { ChatAnswers } from '../../domain/settings/chat.js';
import { kioskDevices, type KioskSummary } from '../attendance/kiosk.js';
import type {
  Caller,
  Deps,
  IntegrationPort,
  IntegrationProvider,
  ProviderAnswer,
} from '../ports.js';
import { chatAnswersOf } from '../settings/chat.js';
import { forbidden, isHrAdmin, refuse, transact } from '../shared.js';

/**
 * Where time off and attendance show up outside this module (T35, TOF-109):
 * a calendar, a chat app, the kiosks at the doors, the country packs the
 * holidays come from — and the Kithena modules that would consume Time Off's
 * events, which do not exist yet and are marked so, because what crosses to
 * them is a contract between modules and not a setting.
 *
 * Connecting is the provider's consent page, where there is one, carrying a
 * state Time Off signs (the tenant, the HR account, where to go back) and
 * coming back to Time Off's public callback, which checks the signature and
 * stores what the provider granted. A provider whose credentials nobody has
 * created is listed and cannot be connected.
 */

type ReachDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'feedSecret' | 'reach'>;

/** Every provider Time Off knows, in the order the page shows them; Teams has no adapter yet. */
const CATALOGUE: readonly { provider: IntegrationProvider; kind: 'calendar' | 'chat' }[] = [
  { provider: 'google', kind: 'calendar' },
  { provider: 'microsoft', kind: 'calendar' },
  { provider: 'slack', kind: 'chat' },
  { provider: 'teams', kind: 'chat' },
];

/** The modules that would read Time Off's events, and which events. None of them is built. */
const MODULES = [
  { key: 'payroll', events: [PeriodClosed.name, LeaveApproved.name] },
  { key: 'benefits', events: [ParentalBirthRecorded.name, LeaveApproved.name] },
  { key: 'projects', events: [LeaveApproved.name, LeaveCancelled.name] },
] as const;

const PACKS = [es, de, gb];

export interface IntegrationsScreen {
  readonly integrations: readonly {
    readonly provider: IntegrationProvider;
    readonly kind: 'calendar' | 'chat';
    /** Time Off has an adapter for it. */
    readonly available: boolean;
    /** Its credentials are set, so it can be connected. */
    readonly configured: boolean;
    readonly connected: boolean;
    readonly connectedAt: Instant | null;
    /** What the provider said the company is called there, when it said. */
    readonly account: string | null;
  }[];
  readonly kiosks: readonly KioskSummary[];
  /** Where a kiosk may be put: every location a member works at. */
  readonly locations: readonly {
    readonly locationKey: LocationKey;
    readonly name: string | null;
  }[];
  readonly packs: readonly {
    readonly country: string;
    readonly reviewed: boolean;
    readonly inUse: boolean;
  }[];
  readonly modules: readonly { readonly key: string; readonly events: readonly string[] }[];
  /** What a chat answer may say about private leave (AST-029a). */
  readonly chatAnswers: ChatAnswers;
}

const portOf = (deps: Pick<Deps, 'reach'>, provider: IntegrationProvider): IntegrationPort | null =>
  [...(deps.reach?.calendars ?? []), ...(deps.reach?.chats ?? [])].find(
    (p) => p.provider === provider,
  ) ?? null;

/** T35, for HR. */
export const integrationsScreen =
  (deps: ReachDeps) =>
  async (caller: Caller): Promise<Result<IntegrationsScreen>> => {
    const kiosks = await kioskDevices(deps)(caller);
    if (!kiosks.ok) return kiosks;
    return transact(deps, caller.tenantId, async (tx) => {
      const connected = new Map((await tx.integrations.list()).map((i) => [i.provider, i]));
      const keys = [
        ...new Set(
          (await tx.members.list())
            .map((m) => m.locationKey)
            .filter((k): k is LocationKey => k !== null),
        ),
      ].toSorted();
      const locations = [];
      for (const locationKey of keys)
        locations.push({ locationKey, name: (await tx.locations.get(locationKey))?.name ?? null });
      const layers = new Set((await tx.holidays.layers()).map((l) => l.key));
      return ok({
        integrations: CATALOGUE.map(({ provider, kind }) => {
          const port = portOf(deps, provider);
          const integration = connected.get(provider);
          return {
            provider,
            kind,
            available: port !== null,
            configured: port?.configured ?? false,
            connected: integration !== undefined,
            connectedAt: integration?.connectedAt ?? null,
            account: integration?.config['name'] ?? null,
          };
        }),
        kiosks: kiosks.value,
        locations,
        packs: PACKS.map((p) => ({
          country: p.country,
          reviewed: p.reviewed,
          inUse: p.holidayLayers.some((l) => layers.has(l.key)),
        })),
        modules: MODULES.map((m) => ({ key: m.key, events: [...new Set(m.events)] })),
        chatAnswers: await chatAnswersOf(tx),
      });
    });
  };

/* ----------------------------------------------------------------- state -- */

/** Long enough to read a consent page; too short to keep a stolen link. */
const STATE_MINUTES = 15;

interface State {
  /** Tenant, account, provider, where to go back, expiry; `m` for a member's own grant. */
  readonly t: string;
  readonly a: string;
  readonly v: IntegrationProvider;
  readonly b: string;
  readonly e: string;
  readonly m?: true;
}

function signedState(secret: string, state: State): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${body}.${signState(secret, body)}`;
}

const signState = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`integration-state:${body}`).digest('base64url');

function stateOf(secret: string, state: string): State | null {
  const [body, signature] = state.split('.');
  if (body === undefined || signature === undefined) return null;
  const expected = Buffer.from(signState(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as State;
  } catch {
    return null;
  }
}

export const redirectUri = (publicUrl: string, provider: IntegrationProvider): string =>
  `${publicUrl.replace(/\/$/u, '')}/v1/timeoff/integrations/${provider}/callback`;

const withQuery = (back: string, key: string, value: string): string => {
  const url = new URL(back);
  url.searchParams.set(key, value);
  return url.toString();
};

/* ---------------------------------------------------------------- writes -- */

/**
 * Starts connecting a provider: its consent page, or — where access is
 * granted in the company's own admin console — the connection at once.
 * `back` is the integrations page HR came from.
 */
export const connectIntegration =
  (deps: ReachDeps) =>
  (
    caller: Caller,
    provider: IntegrationProvider,
    back: string,
  ): Promise<Result<{ url: string | null }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const port = portOf(deps, provider);
      if (port === null || !port.configured || deps.reach === undefined) {
        return refuse(
          'NOT_CONFIGURED',
          `${provider} cannot be connected until its credentials are set`,
        );
      }
      const now = deps.clock.instant();
      const state = signedState(deps.feedSecret, {
        t: caller.tenantId,
        a: caller.accountId,
        v: provider,
        b: back,
        e: new Date(Date.parse(now) + STATE_MINUTES * 60_000).toISOString(),
      });
      const url = port.connectUrl(state, redirectUri(deps.reach.publicUrl, provider));
      if (url === null) {
        await tx.integrations.save({
          provider,
          config: {},
          secret: null,
          connectedAt: now,
          connectedBy: caller.accountId,
        });
      }
      return ok({ url });
    });

/**
 * A member's own grant, where the company is connected and the provider
 * needs one: a chat status is the person's to set. Any member, for
 * themselves; the company's connection is untouched.
 */
export const connectMyIntegration =
  (deps: ReachDeps) =>
  (
    caller: Caller,
    provider: IntegrationProvider,
    back: string,
  ): Promise<Result<{ url: string | null }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (caller.personId === null) return forbidden();
      const port = portOf(deps, provider);
      if (port === null || !port.configured || deps.reach === undefined) {
        return refuse(
          'NOT_CONFIGURED',
          `${provider} cannot be connected until its credentials are set`,
        );
      }
      if (port.memberGrant === false) {
        return refuse(
          'NOT_CONFIGURED',
          `A ${provider} status while you are away is not available yet`,
        );
      }
      if ((await tx.integrations.get(provider)) === null) {
        return refuse('NOT_CONNECTED', `Your company has not connected ${provider}`);
      }
      const state = signedState(deps.feedSecret, {
        t: caller.tenantId,
        a: caller.accountId,
        v: provider,
        b: back,
        e: new Date(Date.parse(deps.clock.instant()) + STATE_MINUTES * 60_000).toISOString(),
        m: true,
      });
      return ok({ url: port.connectUrl(state, redirectUri(deps.reach.publicUrl, provider), true) });
    });

/** Forgets the company's connection, and every member's grant with it. HR. */
export const disconnectIntegration =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (caller: Caller, provider: IntegrationProvider): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      await tx.integrations.remove(provider);
      return ok(undefined);
    });

const invalidState = (): Result<never> =>
  err(failure('INVALID_STATE', 'This answer was not asked for here, or has expired'));

/**
 * The provider's redirect, on Time Off's public callback: checked against
 * the state Time Off signed, stored, and answered with where to send the
 * browser — the page HR came from, saying whether it worked.
 */
export const completeIntegration =
  (deps: Pick<Deps, 'uow' | 'clock' | 'feedSecret' | 'reach'>) =>
  async (
    provider: IntegrationProvider,
    answer: ProviderAnswer,
  ): Promise<Result<{ location: string }>> => {
    const state = stateOf(deps.feedSecret, answer['state'] ?? '');
    const tenant = TenantId.safeParse(state?.t);
    const port = portOf(deps, provider);
    if (
      state === null ||
      !tenant.success ||
      state.v !== provider ||
      Date.parse(state.e) < Date.parse(deps.clock.instant()) ||
      port === null ||
      deps.reach === undefined
    ) {
      return invalidState();
    }
    // The provider says why it did not grant access in `error`.
    if (answer['error'] !== undefined) {
      return ok({ location: withQuery(state.b, 'refused', provider) });
    }
    const granted = await port.complete(answer, redirectUri(deps.reach.publicUrl, provider));
    return transact(deps, tenant.data, async (tx) => {
      const member = await tx.members.byAccount(state.a);
      if (state.m === true) {
        // A member's own grant: theirs alone, and only while the company is connected.
        if (member === null || (await tx.integrations.get(provider)) === null)
          return invalidState();
        await tx.integrations.setMemberSecret(
          provider,
          member.personId,
          granted.memberSecret ?? null,
        );
        return ok({ location: withQuery(state.b, 'connected', provider) });
      }
      await tx.integrations.save({
        provider,
        config: granted.config,
        secret: granted.secret,
        connectedAt: deps.clock.instant(),
        connectedBy: state.a,
      });
      if (member !== null && (granted.memberSecret ?? null) !== null) {
        await tx.integrations.setMemberSecret(
          provider,
          member.personId,
          granted.memberSecret ?? null,
        );
      }
      return ok({ location: withQuery(state.b, 'connected', provider) });
    });
  };
