import type { JSX } from 'react';

import type { Tenant } from '../lib/tenant';

/**
 * Whose login page this is.
 *
 * Beside the form on a wide screen, above it on a narrow one — the company is
 * context for the decision, not the decision, so it gets the space that is
 * going spare rather than the space the form needs.
 *
 * Renders nothing at all when the registry returned no branding. That is not
 * the same as rendering an empty panel: a company that asked not to be named
 * gets a page indistinguishable from one that has uploaded nothing, which is
 * the point of asking.
 */
export function CompanyPanel({ tenant }: { tenant: Tenant | null }): JSX.Element | null {
  const branding = tenant?.branding;
  if (!branding || (branding.displayName === null && branding.logoUrl === null)) return null;

  return (
    <aside
      className="bg-surface border-border flex flex-col justify-center gap-4 border-b p-8 md:min-h-dvh md:w-2/5 md:border-r md:border-b-0"
      /*
       * The accent arrives as an OKLCH triple that Reach's own token takes
       * directly, so a customer re-points the design system's accent rather
       * than introducing a colour beside it. A CHECK constraint on the column
       * is what stops arbitrary CSS reaching this attribute.
       */
      style={
        branding.accentColor === null
          ? undefined
          : ({ '--reach-color-accent': branding.accentColor } as React.CSSProperties)
      }
    >
      {branding.logoUrl === null ? null : (
        <img
          src={branding.logoUrl}
          // The company name, not "logo". A screen reader announcing "logo" has
          // told the listener nothing they could not already infer.
          alt={branding.displayName ?? ''}
          className="h-10 w-auto self-start object-contain"
        />
      )}
      {branding.displayName === null ? null : (
        <p className="text-fg text-lg font-semibold">{branding.displayName}</p>
      )}
      <p className="text-fg-muted text-sm">
        Signing in to your {branding.displayName ?? 'company'} account.
      </p>
    </aside>
  );
}
