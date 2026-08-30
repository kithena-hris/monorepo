import { themePreset } from '@kithena/contracts';
import { Alert, Spinner, brandRamp } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { CompanyPanel } from '../../components/company-panel';
import { resolveTenant, type Tenant } from '../../lib/tenant';

/**
 * The signpost to a company's own sign-in page.
 *
 * Signing in happens on the company's hostname — `acme.app.kithena.com/login`
 * — and not here. `docs/authentication.md` records why that is allowed:
 * `app.kithena.com` is a registrable suffix of `acme.app.kithena.com`, so the
 * relying-party id is legal there, the ceremony is branded end to end, and the
 * session cookie is set by the host it belongs to. A central page would have to
 * verify a passkey and then hand the result across a hostname, which is a
 * mechanism to build and maintain in exchange for nothing.
 *
 * This page stays because links to it exist: every enrolment email sent so far
 * ends here, and a URL somebody was given a week ago should not be a dead end.
 * It resolves the company and forwards.
 *
 * Google is the case that will bring real work back to this origin. Google
 * requires every redirect URI registered exactly and offers no wildcards, so a
 * central callback is forced. Passkeys are not that case.
 */

/** Where a company's own app lives. `{slug}` is substituted with its label. */
const TENANT_APP_BASE = process.env['MODERN_TENANT_APP_BASE'] ?? '';

type State = { readonly kind: 'forwarding' } | { readonly kind: 'stuck'; readonly why: Why };
type Why = 'unknown_company' | 'no_company_named' | 'misconfigured';

const STUCK: Record<Why, { title: string; body: string }> = {
  no_company_named: {
    title: 'Which company?',
    body: 'Sign in at your company’s own address — the one your HR team gave you. It looks like yourcompany.app.kithena.com.',
  },
  unknown_company: {
    title: 'That company could not be found',
    body: 'Check the link you were sent, or ask your HR team for a new one.',
  },
  misconfigured: {
    title: 'Nowhere to send you',
    body: 'This deployment has no tenant app configured, so this page cannot work out your company’s address.',
  },
};

export default function Login(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'forwarding' });
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('tenant') ?? '';
    if (slug === '') {
      // Nothing to forward to, and nothing to guess from. Saying so beats
      // sitting on a spinner that will never resolve.
      setState({ kind: 'stuck', why: 'no_company_named' });
      return;
    }
    if (TENANT_APP_BASE === '') {
      setState({ kind: 'stuck', why: 'misconfigured' });
      return;
    }

    void resolveTenant(slug).then((found) => {
      setTenant(found);
      if (found === null) {
        // One answer for a reserved label, a suspended customer and a name
        // nobody registered. Distinguishing them tells whoever is probing
        // slugs which companies are customers.
        setState({ kind: 'stuck', why: 'unknown_company' });
        return;
      }
      // `replace`, not `assign`: this page is a signpost, and Back from the
      // company's own page should leave rather than bounce through here again.
      window.location.replace(`${TENANT_APP_BASE.replace('{slug}', found.slug)}/login`);
    });
  }, []);

  const themeId = tenant?.branding.themeId ?? null;

  /*
   * The company's ramp on `<html>`, written imperatively.
   *
   * `brandRamp` documents why it cannot go on a wrapper: the accent tokens are
   * declared on `:root` and a `var()` is substituted where the declaration
   * lives, so a ramp set on a descendant changes a variable nothing consults
   * again. This app resolves its tenant in the browser, so there is no server
   * render that knows the company — which leaves the document element.
   */
  useEffect(() => {
    const preset = themeId === null ? undefined : themePreset(themeId);
    if (!preset) return;

    const root = document.documentElement;
    const ramp = brandRamp(preset.hue) as Record<string, string>;
    for (const [name, value] of Object.entries(ramp)) root.style.setProperty(name, value);

    // Removed on the way out. This origin serves more than one company, and a
    // ramp left behind is the previous customer's colour on the next one's page.
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
            {state.kind === 'forwarding'
              ? 'Taking you to your company’s sign-in page…'
              : 'Sign in at your company’s own address.'}
          </p>
        </div>

        {state.kind === 'forwarding' ? (
          <Spinner label="Redirecting" />
        ) : (
          <Alert tone={state.why === 'misconfigured' ? 'warning' : 'danger'} title={STUCK[state.why].title}>
            {STUCK[state.why].body}
          </Alert>
        )}
      </main>
    </div>
  );
}
