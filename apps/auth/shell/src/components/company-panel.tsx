import { Avatar } from '@reach/ui';
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
  if (
    !branding ||
    (branding.displayName === null &&
      branding.logoUrl === null &&
      branding.coverImageUrl === null)
  ) {
    return null;
  }

  return (
    <aside
      className={`bg-surface border-border relative isolate flex flex-col gap-4 overflow-hidden border-b p-8 md:min-h-dvh md:w-2/5 md:border-r md:border-b-0 ${
        branding.coverImageUrl === null ? 'justify-center' : 'justify-end'
      }`}
      /*
       * No accent here any more. It used to set `--reach-color-accent` on this
       * panel alone, which themed the half of the page with no controls on it
       * and left the sign-in button on the default hue. The page now applies
       * `brandRamp` above both panels, which re-points the whole ramp — accent,
       * focus ring, subtle washes, in either colour scheme.
       */
    >
      {/*
        The company's own photograph, behind everything else.
        `aria-hidden` and empty alt: it carries no information the rest of the
        panel does not already give, and a screen reader reading out a
        description of an office lobby before the sign-in button is noise.
        The scrim is what keeps the logo and the name legible over whatever
        they uploaded — a bright photograph and dark text is the failure this
        panel would otherwise have on exactly the screen we do not control.
      */}
      {branding.coverImageUrl === null ? null : (
        <>
          <img
            src={branding.coverImageUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-20 size-full object-cover"
          />
          <div
            /*
              A gradient, not a flat wash. A uniform 80% scrim made every
              photograph look like a grey rectangle — it protected text that
              occupies one corner by erasing the whole image. This is opaque
              along the bottom, where the mark and name are, and gone by
              halfway up, where nothing is being read over anything.
            */
            className="from-surface/95 absolute inset-0 -z-10 bg-gradient-to-t to-transparent to-55%"
          />
        </>
      )}

      {branding.logoUrl === null ? null : (
        // `Avatar`, not a bare `<img>`: `shape` and `fit` exist on it precisely
        // so a company mark is framed without being cropped, and the design
        // system owns the border and the fallback rather than three screens
        // each having their own idea of both.
        //
        // The company name, not "logo". A screen reader announcing "logo" has
        // told the listener nothing they could not already infer.
        <Avatar
          size="xl"
          shape="rounded"
          fit="contain"
          src={branding.logoUrl}
          name={branding.displayName ?? 'This company'}
          className="bg-surface self-start"
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
