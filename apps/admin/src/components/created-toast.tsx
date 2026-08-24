'use client';

import { useToast } from '@reach/ui';
import { useEffect, useRef, type JSX } from 'react';

/**
 * The confirmation for a company that was just created, shown on its own page.
 *
 * The wizard used to end on a screen of its own holding the enrolment links.
 * That screen was the only place they existed, which made leaving it a loss —
 * and it left the operator nowhere useful, because the thing they want next is
 * the company they just made.
 *
 * Losing the links is no longer a loss: the company page can issue a fresh one
 * for anybody, which invalidates the old one anyway. So the wizard hands over
 * to the company page and this says what happened.
 *
 * Counts travel in the query string; nothing else does. A token in a URL is a
 * token in browser history, in the referrer of every image the page loads, and
 * in any analytics that sees the path.
 */
export interface CreatedToastProps {
  readonly companyName: string;
  readonly invited: number;
  readonly undelivered: number;
}

export function CreatedToast({
  companyName,
  invited,
  undelivered,
}: CreatedToastProps): JSX.Element | null {
  const { toast } = useToast();
  // Once per mount. Effects run twice in development under StrictMode, and a
  // duplicated toast reads as the action having happened twice.
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    shown.current = true;

    const people = `${String(invited)} administrator${invited === 1 ? '' : 's'}`;

    toast(
      undelivered === 0
        ? {
            tone: 'success',
            title: `${companyName} created`,
            description: `${people} invited by email.`,
          }
        : {
            tone: 'warning',
            title: `${companyName} created`,
            description: `${String(undelivered)} of ${people} could not be emailed. Invite them again below to get a fresh link.`,
            // Pinned. This one needs an action, and a warning that vanishes
            // before it is read is a warning nobody acted on.
            duration: Infinity,
          },
    );
  }, [toast, companyName, invited, undelivered]);

  return null;
}
