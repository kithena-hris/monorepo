import { Alert, Spinner } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { useBrandRamp } from '../../lib/brand';
import { resolveTenant } from '../../lib/tenant';

/**
 * A signpost to the company's own recovery page, not a second one.
 *
 * There were two of these. This app had a full recovery form and so does
 * `apps/web`, on the company's own hostname â the same page twice, differing
 * only in where each read the tenant from: a `?tenant=` parameter here, the
 * Host header there. Three links pointed at the two of them across the two
 * apps, with three different labels, and keeping both in step was a standing
 * invitation to fix one and forget the other.
 *
 * So this forwards, exactly as `/login` beside it does and for the same reason.
 * The company's own hostname is where the passkey ceremony has to happen â a
 * credential is bound to the origin that created it â so sending somebody there
 * first is not a detour. It is where they were always going.
 */

/** Where a company's own app lives. `{slug}` is substituted with its label. */
const TENANT_APP_BASE = process.env['MODERN_TENANT_APP_BASE'] ?? '';

type State = { readonly kind: 'forwarding' } | { readonly kind: 'stuck'; readonly why: Why };
type Why = 'unknown_company' | 'no_company_named' | 'misconfigured';

/**
 * The same three refusals `/login` gives, in the same words.
 *
 * Deliberately identical: somebody who lands on one of these has the same
 * problem whichever page they came through, and two descriptions of one problem
 * is one more than anybody needs.
 */
const STUCK: Record<Why, { title: string; body: string }> = {
  no_company_named: {
    title: 'Which company?',
    body: 'Start from your company’s own address — the one your HR team gave you. It looks like yourcompany.app.kithena.com.',
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

export default function Recover(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'forwarding' });
  /*
   * Branded too, short as its life is.
   *
   * This page forwards as soon as the registry answers, so the colour is on
   * screen for a moment — but the moment is somebody's spinner, and a company
   * that changed its theme in the back office should not have one screen on
   * the way in that missed the memo. It already resolves the tenant; using the
   * answer costs a line.
   */
  const [themeId, setThemeId] = useState<string | null>(null);
  useBrandRamp(themeId);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('tenant') ?? '';
    if (slug === '') {
      setState({ kind: 'stuck', why: 'no_company_named' });
      return;
    }
    if (TENANT_APP_BASE === '') {
      setState({ kind: 'stuck', why: 'misconfigured' });
      return;
    }

    let current = true;
    void resolveTenant(slug).then((found) => {
      if (!current) return;
      setThemeId(found?.branding.themeId ?? null);
      if (found === null) {
        // One answer for a malformed label, a suspended customer and a slug
        // nobody registered. Distinguishing them tells whoever is probing slugs
        // which companies are customers.
        setState({ kind: 'stuck', why: 'unknown_company' });
        return;
      }
      // `replace`, not `assign`: this page is a signpost, and Back from the
      // company's own page should leave rather than bounce through here again.
      window.location.replace(`${TENANT_APP_BASE.replace('{slug}', found.slug)}/recover`);
    });

    return () => {
      current = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      {state.kind === 'forwarding' ? (
        <Spinner label="Taking you to your company" />
      ) : (
        <Alert tone="warning" title={STUCK[state.why].title}>
          {STUCK[state.why].body}
        </Alert>
      )}
    </main>
  );
}
