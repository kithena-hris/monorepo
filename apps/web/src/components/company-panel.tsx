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
      /*
        The company's colour, not ours.

        A wash of their accent over the surface, rather than a flat neutral
        panel. The ramp on `<html>` has already re-pointed `accent-subtle` to
        their hue in both colour schemes, so this is the customer's colour at
        every screen width without the page knowing which customer it is. A
        flat neutral panel put the whole brand on one small mark and left the
        rest of the page looking like everybody else's.

        Gradient rather than a flat fill so the wash has a direction and the
        name at the bottom is not read against the strongest part of it. Under a
        cover photograph there is no wash at all — the photograph is the brand
        there, and tinting it would be the one thing a customer notices.
      */
      className={`bg-surface border-border relative isolate flex flex-col gap-4 overflow-hidden border-b p-8 md:min-h-dvh md:w-2/5 md:border-r md:border-b-0 ${
        hasCover
          ? 'justify-end'
          : 'from-accent-subtle justify-center bg-gradient-to-b to-transparent'
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
          // A ring in their accent, so the mark sits on the brand rather than
          // beside it. `bg-surface` stays: a logo with a transparent background
          // needs a white plate under it or it reads as a hole in the wash.
          className="bg-surface ring-accent/25 self-start ring-4"
        />
      )}

      {branding.displayName === null ? null : (
        <div>
          {/*
            A short accent rule above the name. Three pixels of the company's
            colour, the same mark the invitation email opens with — somebody
            arriving from that message lands on a page that is recognisably the
            one the button belonged to.
          */}
          <div aria-hidden className="bg-accent-solid mb-3 h-[3px] w-10 rounded-full" />
          <p className="text-2xl font-semibold">{branding.displayName}</p>
          <p className="text-fg-muted mt-1 text-sm">Sign in to your account.</p>
        </div>
      )}
    </aside>
  );
}
