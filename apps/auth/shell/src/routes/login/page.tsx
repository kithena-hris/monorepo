import { themePreset } from '@kithena/contracts';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  Alert,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Spinner,
  brandRamp,
} from '@reach/ui';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { CompanyPanel } from '../../components/company-panel';
import { resolveTenant, type Tenant } from '../../lib/tenant';

/**
 * Signing in, from one address for everybody.
 *
 * This page used to require the company in its URL, so a person had to know a
 * hostname before they could sign in and a shared machine served only whoever
 * knew the right link. The work address does that job now: typed here, sent
 * with the assertion, and used by identity to narrow the verified passkey to
 * the one account it names. `chooseAccount` holds the rule.
 *
 * **The address is not a username and does not gate the prompt.** No
 * `allowCredentials` is sent — a recorded decision in
 * `simplewebauthn-relying-party.ts`, because a per-address credential list is
 * an enumeration oracle for anybody who can type an address. The browser offers
 * whichever passkeys the device holds, exactly as before; the address only
 * decides which of that person's jobs this sign-in is for. A wrong address is
 * refused the same way a wrong passkey is.
 *
 * `?tenant=acme` still works and is still branded. That path names the company,
 * shows its mark and its colour, and needs no address — it is where an
 * enrolment email sends somebody, and removing it would break every link
 * already in the world.
 */

/** Where a company's own app lives. `{slug}` is substituted with its label. */
const TENANT_APP_BASE = process.env['MODERN_TENANT_APP_BASE'] ?? '';

/** Shape only, and only to save a wasted prompt. Existence is identity's answer. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'leaving' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'misconfigured' };

export default function Login(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [email, setEmail] = useState('');
  const [emailProblem, setEmailProblem] = useState<string | null>(null);

  /*
   * The company, when the URL named one.
   *
   * Absent on the generic page, and that is the whole difference between the
   * two: there is nothing to brand until a passkey has said who this is, and
   * guessing from a half-typed address would flash one customer's colours at
   * somebody who works for another.
   */
  const named = new URLSearchParams(
    typeof window === 'undefined' ? '' : window.location.search,
  ).get('tenant');

  useEffect(() => {
    if (named === null || named === '') return;
    void resolveTenant(named).then(setTenant);
  }, [named]);

  const signIn = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();

      if (named === null && !LOOKS_LIKE_EMAIL.test(email.trim())) {
        setEmailProblem('Enter the work address you were invited with.');
        return;
      }
      setEmailProblem(null);
      setState({ kind: 'working' });

      if (TENANT_APP_BASE === '') {
        // Checked before the prompt. Asking for a passkey and then finding
        // there is nowhere to send somebody spends a real interaction on a
        // failure that was knowable beforehand.
        setState({ kind: 'misconfigured' });
        return;
      }

      try {
        const begun = (await post('/api/identity/webauthn/authenticate/begin', {})) as {
          options?: unknown;
        };
        if (!begun.options) {
          setState({ kind: 'refused' });
          return;
        }

        // The browser prompt. Everything before this is arrangement; this is
        // the only moment a human is asked for anything.
        const assertion = await startAuthentication({ optionsJSON: begun.options as never });

        const finished = (await post('/api/identity/webauthn/authenticate/finish', {
          // One or the other. The branded page names a company; the generic one
          // sends the typed address and lets identity find it.
          ...(named === null ? { workEmail: email.trim() } : { tenantId: tenant?.id }),
          origin: window.location.origin,
          response: assertion,
          // No network address. A browser cannot see its own, and inventing a
          // placeholder is what once put the literal 'unknown' into an `inet`
          // column. Whatever terminates the connection supplies one or nothing.
          device: { userAgent: navigator.userAgent },
        })) as { accountId?: string; tenantId?: string; tenantSlug?: string } | null;

        if (finished?.tenantSlug === undefined || finished.tenantId === undefined) {
          setState({ kind: 'refused' });
          return;
        }

        /*
         * The session id is not here, deliberately. `server/modern.server.ts`
         * takes it out of the response and puts it in an `HttpOnly` cookie, so
         * this page never holds one — the handoff is minted by that server from
         * its own cookie.
         */
        const handed = (await post('/api/auth/handoff', {
          tenantId: finished.tenantId,
        })) as { code?: string } | null;

        if (handed?.code === undefined) {
          setState({ kind: 'refused' });
          return;
        }

        setState({ kind: 'leaving' });
        // `replace`, not `assign`: Back from the dashboard should leave, not
        // return to a sign-in page holding a code that has been spent.
        window.location.replace(
          `${TENANT_APP_BASE.replace('{slug}', finished.tenantSlug)}/auth/callback?code=${encodeURIComponent(handed.code)}`,
        );
      } catch {
        // A cancelled prompt throws, and so does a refusal. They are the same
        // outcome here: nothing happened, try again.
        setState({ kind: 'refused' });
      }
    },
    [email, named, tenant],
  );

  const preset =
    tenant?.branding.themeId == null ? undefined : themePreset(tenant.branding.themeId);
  const busy = state.kind === 'working' || state.kind === 'leaving';

  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      style={preset ? brandRamp(preset.hue) : undefined}
    >
      <CompanyPanel tenant={tenant} />

      <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {named === null
              ? 'Your work address tells us which company. Your passkey does the rest.'
              : 'Use the passkey on this device. There is no password to remember.'}
          </p>
        </div>

        {/*
          A real form, so Enter submits and a password manager can fill the
          address. `onSubmit` rather than a click handler is what makes the
          keyboard path work without a second implementation of it.
        */}
        <form onSubmit={(event) => void signIn(event)} className="flex flex-col gap-5">
          {named === null ? (
            <Field invalid={emailProblem !== null}>
              <FieldLabel htmlFor="workEmail">Work email address</FieldLabel>
              <Input
                id="workEmail"
                name="workEmail"
                type="email"
                value={email}
                disabled={busy}
                required
                // `username webauthn` is what lets a password manager offer the
                // right passkey against the right address on a shared device.
                autoComplete="username webauthn"
                placeholder="you@yourcompany.com"
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (emailProblem !== null) setEmailProblem(null);
                }}
              />
              <FieldDescription>The address your HR team invited you with.</FieldDescription>
              <FieldError>{emailProblem}</FieldError>
            </Field>
          ) : null}

          <Button type="submit" variant="primary" disabled={busy}>
            {state.kind === 'working' ? 'Waiting for your device…' : 'Sign in with a passkey'}
          </Button>
        </form>

        {state.kind === 'leaving' ? <Spinner label="Taking you to your dashboard" /> : null}

        {state.kind === 'refused' ? (
          /*
           * One message for every failure. Anybody can present a passkey and
           * type any address, so separating "wrong passkey" from "no account
           * under that address" would answer a question that is not the
           * asker's to ask. The precise reason is in identity's log.
           */
          <Alert tone="danger" title="That did not work">
            Check the address, and that you are using the passkey you set up. If you have not set
            one up yet, use the link your HR team sent you.
          </Alert>
        ) : null}

        {state.kind === 'misconfigured' ? (
          <Alert tone="warning" title="Nowhere to send you">
            <code>MODERN_TENANT_APP_BASE</code> is not set on this deployment, so this page cannot
            work out your company’s address.
          </Alert>
        ) : null}
      </main>
    </div>
  );
}

/**
 * Through this origin's proxy, which adds the credential identity requires.
 *
 * A refusal is an empty 401, so `json()` would throw on it. Returning null
 * keeps every failure the same shape as every other failure.
 */
async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}
