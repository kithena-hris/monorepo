import { themePreset } from '@kithena/contracts';
import { startAuthentication } from '@simplewebauthn/browser';
import { Alert, Button, Spinner, brandRamp } from '@reach/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { CompanyPanel } from '../../components/company-panel';
import { resolveTenant, type Tenant } from '../../lib/tenant';

/**
 * Signing in with a passkey, on the auth origin, branded as the company's.
 *
 * The whole ceremony happens here — this page is the sign-in page and does not
 * bounce anybody anywhere to reach one. What it cannot do is *finish*, and the
 * reason is a browser rule rather than a design choice: the session cookie is
 * `__Host-` prefixed, which forbids a `Domain` attribute, so only
 * `acme.app.kithena.com` can ever be sent it and this origin is not that host.
 *
 * So the last step is a redirect carrying a one-time code — 60 seconds, single
 * use, hashed at rest, bound to the company that may spend it. The tenant app
 * exchanges it for the session over a back channel the browser is not part of
 * and sets its own cookie. `docs/authentication.md` specifies the handoff; the
 * migration for `platform.handoff_code` records why it is not PKCE.
 *
 * There is no success state on this screen. Ending here with a banner saying
 * "signed in" would report the mechanism and leave the person exactly where
 * they started; the only visible outcome of signing in is their dashboard.
 */

/**
 * Where a company's own app lives. `{slug}` is substituted with its label.
 *
 * Inlined at build time — Modern.js exposes `MODERN_`-prefixed variables to the
 * browser, the same convention Next uses for `NEXT_PUBLIC_`.
 */
const TENANT_APP_BASE = process.env['MODERN_TENANT_APP_BASE'] ?? '';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'leaving' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'misconfigured' };

export default function Login(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [tenant, setTenant] = useState<Tenant | null>(null);

  /*
   * The company, looked up as the page mounts.
   *
   * Not on the server: on one shared origin there is no hostname to resolve
   * from — see `lib/tenant.ts`. The panel arrives a moment after the form,
   * which is why the first paint is deliberately unbranded rather than briefly
   * branded as somebody else.
   */
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('tenant') ?? '';
    void resolveTenant(slug).then(setTenant);
  }, []);

  const signIn = useCallback(async () => {
    setState({ kind: 'working' });

    // The company's name, not its id. Resolved through the registry, so a
    // reserved label or a suspended customer is refused here rather than
    // producing a lookup that quietly finds nothing later.
    const resolved =
      tenant ??
      (await resolveTenant(new URLSearchParams(window.location.search).get('tenant') ?? ''));
    if (resolved === null) {
      setState({ kind: 'refused' });
      return;
    }

    if (TENANT_APP_BASE === '') {
      // Checked before the prompt, not after. Asking somebody for a passkey and
      // then discovering there is nowhere to send them spends a real
      // interaction on a failure that was knowable beforehand.
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

      // The browser prompt. Everything before this is arrangement; this is the
      // only moment a human is asked for anything.
      const assertion = await startAuthentication({ optionsJSON: begun.options as never });

      const finished = (await post('/api/identity/webauthn/authenticate/finish', {
        tenantId: resolved.id,
        origin: window.location.origin,
        response: assertion,
        // No address. A browser cannot see its own, and inventing a placeholder
        // is what once put the literal 'unknown' into an `inet` column.
        // Whatever terminates the connection supplies it, or nothing does.
        device: { userAgent: navigator.userAgent },
      })) as { accountId?: string } | null;

      if (finished?.accountId === undefined) {
        setState({ kind: 'refused' });
        return;
      }

      /*
       * The session id is not here, and that is on purpose.
       *
       * `server/modern.server.ts` strips it from the response and puts it in an
       * `HttpOnly` cookie on this origin, so this page never holds it. The
       * handoff is therefore minted by that server from its own cookie — this
       * only says which company, and gets back a code.
       */
      const handed = (await post('/api/auth/handoff', {
        tenantId: resolved.id,
      })) as { code?: string } | null;

      if (handed?.code === undefined) {
        setState({ kind: 'refused' });
        return;
      }

      setState({ kind: 'leaving' });
      // `replace`, not `assign`: Back from the dashboard should leave, not
      // return to a sign-in page holding a code that has already been spent.
      window.location.replace(
        `${TENANT_APP_BASE.replace('{slug}', resolved.slug)}/auth/callback?code=${encodeURIComponent(handed.code)}`,
      );
    } catch {
      // A cancelled prompt throws, and so does a refusal. They are the same
      // outcome to this screen: nothing happened, try again.
      setState({ kind: 'refused' });
    }
  }, [tenant]);

  const themeId = tenant?.branding.themeId ?? null;

  /*
   * The company's ramp, written onto `<html>`.
   *
   * Imperatively, and it has to be here rather than as a `style` prop on the
   * div below. `brandRamp` documents why at length: `--reach-color-accent` is
   * declared as `var(--reach-brand-600)` **on `:root`**, and a `var()` is
   * substituted where the declaration lives — so a ramp set on any descendant
   * changes a variable nothing consults again, and the visible result is a
   * themed page whose buttons are still the default hue. That is exactly what
   * this page did until it was looked at in a browser.
   *
   * Next puts this on `<html>` in a server-rendered layout. This app resolves
   * its tenant in the browser, so there is no server render that knows the
   * company — which leaves the document element and an effect.
   */
  useEffect(() => {
    const preset = themeId === null ? undefined : themePreset(themeId);
    if (!preset) return;

    const root = document.documentElement;
    const ramp = brandRamp(preset.hue) as Record<string, string>;
    for (const [name, value] of Object.entries(ramp)) root.style.setProperty(name, value);

    // Removed on the way out. The auth origin serves more than one company and
    // a ramp left behind is the previous customer's colour on the next one's
    // screen.
    return () => {
      for (const name of Object.keys(ramp)) root.style.removeProperty(name);
    };
  }, [themeId]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CompanyPanel tenant={tenant} />

      <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Use the passkey on this device. There is no password to remember.
          </p>
        </div>

        <Button
          // `primary`, not the default. `Button` defaults to `secondary`, a
          // white fill with a border — right beside another button, wrong as
          // the only action on the page, where it made a themed page look
          // unthemed.
          variant="primary"
          onClick={() => void signIn()}
          disabled={state.kind === 'working' || state.kind === 'leaving'}
        >
          {state.kind === 'working' ? 'Waiting for your device…' : 'Sign in with a passkey'}
        </Button>

        {state.kind === 'leaving' ? <Spinner label="Taking you to your dashboard" /> : null}

        {state.kind === 'refused' ? (
          /*
           * One message for every failure, unlike enrolment.
           *
           * Anyone can present a passkey here, so distinguishing "wrong
           * passkey" from "no account at this company" would answer a question
           * that is not the asker's to ask. The precise reason is in the
           * identity service's log, where the person who can act on it looks.
           */
          <Alert tone="danger" title="That did not work">
            Check you are signing in to the right company, or ask your HR team for a new enrolment
            link.
          </Alert>
        ) : null}

        {state.kind === 'misconfigured' ? (
          // Configuration, not a user error, and said plainly rather than
          // dressed up as one — whoever reads this needs the variable name.
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
