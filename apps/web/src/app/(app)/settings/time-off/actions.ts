'use server';

import { headers } from 'next/headers';

import { timeOff } from '../../../../lib/people';

/**
 * What Time Off's settings pages save (TOF-078 to TOF-083): server actions,
 * each one or more operations sent through the router as the person signed
 * in, as `../../time-off/actions.ts` does for the area's own pages. Kept
 * beside the settings route, so a settings page's writes are found where the
 * page is.
 *
 * Time Off decides who may (HR only) and validates every argument again with
 * the same Zod schema its REST route uses; nothing here authorizes anything.
 * Each write carries a fresh idempotency key and answers with the page drawn
 * again (`lib/people.ts`).
 */

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

const outcome = (a: { ok: true } | { ok: false; message: string }): Outcome =>
  a.ok ? { ok: true } : { ok: false, message: a.message };

/** T30: replace the policy's draft, or start the next version's, with this definition. */
export async function savePolicyDraft(policyId: string, definition: unknown): Promise<Outcome> {
  return outcome(await timeOff('ReviseTimeOffPolicy', { policyId, input: definition }));
}

/** T30: publish the draft from a date; balances re-fold from it. */
export async function publishPolicy(policyId: string, effectiveFrom: string): Promise<Outcome> {
  return outcome(await timeOff('PublishTimeOffPolicy', { policyId, input: { effectiveFrom } }));
}

/**
 * T31: going below zero, as a revision of the policy. With `publish` (the
 * policy's latest version is published) it is published again from today, so
 * the rule holds at once; a policy with a draft keeps it in the draft, to go
 * out with the rest of it. Going below zero changes no entitlement, so the
 * re-fold from today changes no amount.
 */
export async function saveNegativeBalance(
  policyId: string,
  rule: unknown,
  publish: boolean,
): Promise<Outcome> {
  const set = await timeOff('SetTimeOffNegativeBalanceRule', { policyId, input: { rule } });
  if (!set.ok || !publish) return outcome(set);
  return publishPolicy(policyId, new Date().toISOString().slice(0, 10));
}

/** T33: breaks, rest, the weekly limit and what overtime becomes. */
export async function saveAttendanceRules(rules: unknown): Promise<Outcome> {
  return outcome(await timeOff('SetTimeOffAttendanceRules', { input: rules }));
}

/**
 * T34: the approval rules and automatic approval, then each team minimum
 * that changed. Stops at the first refusal and says which.
 */
export async function saveApprovals(
  rules: unknown,
  autoApproval: unknown,
  minimums: readonly { readonly teamKey: string; readonly minimum: unknown }[],
): Promise<Outcome> {
  const set = await timeOff('SetTimeOffApprovalRules', { input: { rules, autoApproval } });
  if (!set.ok) return outcome(set);
  for (const { teamKey, minimum } of minimums) {
    const done = await timeOff('SetTimeOffTeamMinimum', { teamKey, input: { minimum } });
    if (!done.ok) return outcome(done);
  }
  return { ok: true };
}

/* -------------------------------------------------------- integrations -- */

type Provider = 'google' | 'microsoft' | 'slack' | 'teams';

/**
 * T35: connect a calendar or chat app. Time Off answers with the provider's
 * consent page, or `null` when it is connected at once; the provider sends
 * the browser back to this page on the company's own address.
 */
export async function connectIntegration(
  provider: Provider,
): Promise<
  | { readonly ok: true; readonly url: string | null }
  | { readonly ok: false; readonly message: string }
> {
  const asked = await headers();
  const host = asked.get('x-forwarded-host') ?? asked.get('host') ?? 'localhost:3000';
  const proto = asked.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const a = await timeOff<{ url: string | null }>('ConnectTimeOffIntegration', {
    provider,
    input: { back: `${proto}://${host}/settings/time-off/integrations` },
  });
  return a.ok ? { ok: true, url: a.data.url } : { ok: false, message: a.message };
}

/** T35: forget a connection, and every member's grant with it. */
export async function disconnectIntegration(provider: Provider): Promise<Outcome> {
  return outcome(await timeOff('DisconnectTimeOffIntegration', { provider }));
}

/** T35: a kiosk for a location; its token is shown this once. */
export async function registerKiosk(input: {
  readonly name: string;
  readonly locationKey: string;
}): Promise<
  | { readonly ok: true; readonly deviceId: string; readonly token: string }
  | { readonly ok: false; readonly message: string }
> {
  const a = await timeOff<{ deviceId: string; token: string }>('RegisterTimeOffKiosk', { input });
  return a.ok ? { ok: true, ...a.data } : { ok: false, message: a.message };
}

/** T35: the kiosk's token stops working at once. */
export async function revokeKiosk(deviceId: string): Promise<Outcome> {
  return outcome(await timeOff('RevokeTimeOffKiosk', { deviceId }));
}
