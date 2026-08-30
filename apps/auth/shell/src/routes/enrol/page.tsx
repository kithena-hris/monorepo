import { startRegistration } from '@simplewebauthn/browser';
import { Alert, Button, Spinner } from '@reach/ui';
import { useNavigate } from '@modern-js/runtime/router';

import { resolveTenant } from '../../lib/tenant';
import { useCallback, useEffect, useState, type JSX } from 'react';

/**
 * Creating a first passkey.
 *
 * A person reaches this with a link their HR team issued and a second channel
 * they satisfied in person — see `docs/authentication.md`, which explains why
 * the link alone is not enough and why SP 800-63B-4 makes that more than a
 * preference. This screen is the last step of that, not the whole of it.
 */
type State =
  /** Asking what the link is worth. The button is not offered yet. */
  | { readonly kind: 'checking' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done' }
  /** They have a passkey already. Not a failure — a different destination. */
  | { readonly kind: 'already_enrolled' }
  | { readonly kind: 'refused'; readonly reason: Reason };

/**
 * What went wrong, in words a person can act on.
 *
 * Enrolment is allowed to say this where sign-in is not: reaching here requires
 * a 256-bit token handed over out of band, so whoever is reading already holds
 * the secret. Withholding the reason from them would turn a solvable problem
 * into a support call and protect nobody.
 */
type Reason =
  | 'link_invalid'
  | 'link_used_or_expired'
  | 'employment_not_started'
  | 'passkey_rejected'
  | 'cancelled';

const MESSAGES: Record<Reason, { title: string; body: string }> = {
  link_used_or_expired: {
    title: 'This link has already been used',
    body: 'Enrolment links work once. Ask your HR team for a new one.',
  },
  link_invalid: {
    title: 'This link is not valid',
    body: 'Check you opened the most recent link, or ask your HR team to send another.',
  },
  employment_not_started: {
    title: 'Your start date has not arrived yet',
    body: 'You can set up your passkey on your first day.',
  },
  passkey_rejected: {
    title: 'That passkey could not be accepted',
    body: 'Try again, or use a different device.',
  },
  cancelled: {
    title: 'Setup was cancelled',
    body: 'Your device did not finish creating the passkey. You can try again.',
  },
};

export default function Enrol(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const navigate = useNavigate();

  /*
   * Which account this passkey is for.
   *
   * One device holds passkeys for many accounts — a contractor at three
   * customers, or one person testing two environments — and the system prompt
   * only shows what it was told at registration. Saying it on the page as well
   * means the choice is made before the prompt appears rather than guessed at
   * inside it, and it is the difference between "create a passkey" and "create
   * a passkey for this person at this company".
   *
   * Read once, on render, because the query string does not change under us.
   */
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const account = params.get('name');
  const company = params.get('tenant');

  /*
   * What this link is worth, asked before the button appears.
   *
   * This page used to find out by trying: it ran the whole ceremony — a real
   * prompt, on a real device — and then said "this link has already been used".
   * Somebody returning to a bookmark, or opening it on a second device, is the
   * ordinary case rather than the strange one, and the useful thing to tell
   * them is that they are already set up and where to sign in.
   */
  useEffect(() => {
    // Read here rather than closing over the object built during render: a new
    // `URLSearchParams` every render would be a new dependency every render.
    const query = new URLSearchParams(window.location.search);
    const tenant = query.get('tenant') ?? '';
    const token = query.get('token') ?? '';
    if (tenant === '' || token === '') {
      setState({ kind: 'refused', reason: 'link_invalid' });
      return;
    }

    let current = true;
    void resolveTenant(tenant)
      .then(async (resolved) => {
        if (resolved === null) return { state: 'unknown' as const };
        const asked = await post('/api/identity/enrolment/status', {
          tenantId: resolved.id,
          token,
        });
        return (asked.body ?? { state: 'unknown' }) as { state: string };
      })
      .then(({ state: found }) => {
        if (!current) return;
        if (found === 'usable') setState({ kind: 'idle' });
        else if (found === 'already_enrolled') setState({ kind: 'already_enrolled' });
        else if (found === 'spent') setState({ kind: 'refused', reason: 'link_used_or_expired' });
        else if (found === 'expired') setState({ kind: 'refused', reason: 'link_used_or_expired' });
        else setState({ kind: 'refused', reason: 'link_invalid' });
      })
      .catch(() => {
        // Unreachable identity is not a spent link, and saying so would send
        // somebody to ask HR for a replacement they do not need.
        if (current) setState({ kind: 'refused', reason: 'link_invalid' });
      });

    return () => {
      current = false;
    };
  }, []);

  const enrol = useCallback(async () => {
    setState({ kind: 'working' });
    const tenant = await resolveTenant(params.get('tenant') ?? '');
    if (tenant === null) {
      setState({ kind: 'refused', reason: 'link_invalid' });
      return;
    }

    const begun = (await post('/api/identity/webauthn/register/begin', {
      identityId: params.get('identity'),
      displayName: params.get('name') ?? 'Kithena',
    })) as { body: { options?: unknown } | null };

    if (!begun.body?.options) {
      setState({ kind: 'refused', reason: 'link_invalid' });
      return;
    }

    let attestation;
    try {
      attestation = await startRegistration({ optionsJSON: begun.body.options as never });
    } catch {
      // The device said no, or the person did. Distinct from anything the
      // server decided, and the only message that should suggest trying again
      // with the same link — because the link has not been spent yet.
      setState({ kind: 'refused', reason: 'cancelled' });
      return;
    }

    const finished = (await post('/api/identity/webauthn/register/finish', {
      tenantId: tenant.id,
      token: params.get('token'),
      origin: window.location.origin,
      response: attestation,
    })) as { ok: boolean; body: { accountId?: string; reason?: Reason } | null };

    if (finished.ok && finished.body?.accountId !== undefined) {
      setState({ kind: 'done' });
      // Straight on to signing in. Leaving someone on a success screen with a
      // spent link is how they press the button again and are told, correctly
      // and uselessly, that their link has been used.
      window.setTimeout(
        () => void navigate(`/login?tenant=${encodeURIComponent(tenant.slug)}`),
        900,
      );
      return;
    }

    setState({ kind: 'refused', reason: finished.body?.reason ?? 'link_invalid' });
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Set up your passkey</h1>
        {account === null ? null : (
          <p className="mt-1 text-sm">
            for <strong className="font-medium">{account}</strong>
            {company === null ? null : (
              <>
                {' '}
                at <strong className="font-medium">{company}</strong>
              </>
            )}
          </p>
        )}
        <p className="text-fg-muted mt-2 text-sm">
          Your device will ask for your fingerprint, face or PIN. Nothing leaves it. The passkey
          will be saved under this address, so you can tell it apart from any others on this device.
        </p>
      </div>

      {state.kind === 'refused' ? (
        <Alert tone="danger" title={MESSAGES[state.reason].title}>
          {MESSAGES[state.reason].body}
        </Alert>
      ) : null}

      {state.kind === 'done' ? (
        <Alert tone="success" title="Passkey created">
          Taking you to sign in…
        </Alert>
      ) : null}

      {state.kind === 'already_enrolled' ? (
        <>
          <Alert tone="info" title="You already have a passkey">
            This link has done its job. Sign in with the passkey on the device you set up, or
            replace it if that device is gone.
          </Alert>
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={() => void navigate('/login')}>
              Go to sign in
            </Button>
            {/*
              Replacing needs the current passkey, which is what makes this
              safe to offer on a page anybody holding an old link can open.
            */}
            <Button variant="secondary" onClick={() => void navigate('/passkey')}>
              Replace my passkey
            </Button>
          </div>
        </>
      ) : null}

      {state.kind === 'checking' ? <Spinner label="Checking your link" /> : null}

      {state.kind === 'done' || state.kind === 'already_enrolled' || state.kind === 'checking' ? null : (
        <Button variant="primary" onClick={() => void enrol()} disabled={state.kind === 'working'}>
          {state.kind === 'working' ? 'Waiting for your device…' : 'Create a passkey'}
        </Button>
      )}
    </main>
  );
}

/**
 * Through this origin's proxy, which adds the credential identity requires.
 *
 * The status is returned alongside the body rather than thrown on, because a
 * 401 here carries a reason worth reading — unlike on sign-in, where it
 * deliberately carries nothing.
 */
async function post(path: string, body: unknown): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, body: text === '' ? null : JSON.parse(text) };
}
