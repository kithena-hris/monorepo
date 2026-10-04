import type {
  AssistantAsker,
  Capability,
  CapabilityInput,
  ModuleKey,
  RuntimeCatalogue,
} from '@kithena/contracts';
import type { Result } from '@kithena/domain-kit';

import type { Today } from '../domain/dates.js';
import type { CallOutcome } from '../domain/execute.js';
import type { Offer } from '../domain/plan.js';

/**
 * What the ask use case needs from the world (assistant PRD §6.6, §10, §12):
 * who is asking, what each module offers them and answers for them, and a
 * plan for the question. Each has a client in `infrastructure/` and a fake in
 * the tests; none of them decides who may see what.
 */

/** Identity's answer for an email in a tenant (§10.1). */
export type AskerLookup = Result<AssistantAsker, 'NOT_FOUND' | 'UNREACHABLE'>;

/** Whom to look up: a chat app's verified work email, or the web's signed-in account. */
export type AskerKey = { readonly email: string } | { readonly accountId: string };

export interface Identity {
  asker(tenantId: string, who: AskerKey): Promise<AskerLookup>;
}

/**
 * Who a module is called as: the router's principal shape
 * (`apps/gateway/config.yaml`). A chat app's asker is always the person; a
 * web question carries the session the router forwarded — a support session
 * (`impersonatedBy`) or a view-as (`viewedBy`) — and each module treats it as
 * it does on its own screens.
 */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly entitlements: readonly string[];
  readonly impersonatedBy: string | null;
  readonly viewedBy: string | null;
}

/** A module that said no to this asker (a 403), in its own words: never retried as anybody else. */
export interface Refused {
  readonly refused: string;
}

export interface Modules {
  /** The modules this deployment can reach: a URL and a pair token each (§6.5). */
  readonly configured: readonly ModuleKey[];
  /** What the module offers this asker, its refusal, or null when it did not answer within its contract. */
  catalogue(
    module: ModuleKey,
    as: Principal,
    correlationId: string,
  ): Promise<RuntimeCatalogue | Refused | null>;
  /** One capability as the asker. `signal` is the question's deadline. */
  call(
    capability: Capability,
    input: CapabilityInput,
    as: Principal,
    correlationId: string,
    signal: AbortSignal,
  ): Promise<CallOutcome>;
}

/** Everything a plan is asked from: configuration and the masked question, never a value. */
export interface PlanRequest {
  readonly question: string;
  readonly today: Today;
  /** The offer the model is shown: masked references in place of private types. */
  readonly offer: Offer;
  /** Modules with capabilities this company cannot use right now, for `unavailable`. */
  readonly unavailable: readonly ModuleKey[];
  /** Every catalogue's not-for-AI keys and words, for the AI gateway (§12.3). */
  readonly denied: RuntimeCatalogue['denied'];
}

/** The model's text, or why there is none: the gateway refused, or the model failed. */
export type Planned =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: 'NOT_ALLOWED' | 'FAILED' };

export interface Planner {
  plan(tenantId: string, request: PlanRequest): Promise<Planned>;
}
