import { Avatar } from '@reach/ui';
import type { JSX } from 'react';

import type { Branding } from '../lib/branding';

/**
 * Whose sign-in page this is.
 *
 * Every field can be null, and null is the answer for a company that has asked
 * not to be named. The decision is the registry's, made once in `brandingFor`,
 * so a screen cannot leak the customer list by forgetting to check a flag. With
 * nothing to show this renders nothing and the form takes the width.
 */
export function CompanyPanel({ branding }: { branding: Branding }): JSX.Element | null {
  const hasCover = branding.coverImageUrl !== null;

  if (branding.displayName === null && branding.logoUrl === null && !hasCover) return null;

  return (
    <aside
      className={`bg-surface border-border relative isolate flex flex-col gap-4 overflow-hidden border-b p-8 md:min-h-dvh md:w-2/5 md:border-r md:border-b-0 ${
        hasCover ? 'justify-end' : 'justify-center'
      }`}
    >
      {/*
        The company's own photograph, behind everything else. `aria-hidden` with
        an empty alt: it carries nothing the name and mark do not already say,
        and a screen reader describing an office lobby before the sign-in button
        is noise.

        The gradient is opaque along the bottom, where the mark and name sit,
        and gone by halfway up. A flat scrim strong enough to protect text in
        one corner turns the whole photograph into a grey rectangle.
      */}
      {branding.coverImageUrl === null ? null : (
        <>
          <img
            src={branding.coverImageUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-20 size-full object-cover"
          />
          <div className="from-surface/95 absolute inset-0 -z-10 bg-gradient-to-t to-transparent to-55%" />
        </>
      )}

      {branding.logoUrl === null ? null : (
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
        <div>
          <p className="text-2xl font-semibold">{branding.displayName}</p>
          <p className="text-fg-muted mt-1 text-sm">Sign in to your account.</p>
        </div>
      )}
    </aside>
  );
}
