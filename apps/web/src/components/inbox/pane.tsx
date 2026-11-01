import { Button, type ButtonProps } from '@reach/ui';
import { createContext, use, type JSX, type MouseEvent, type ReactNode } from 'react';

import type { Shown } from '../../lib/inbox/model';
import type { Outcome } from '../../app/(app)/inbox/actions';

/**
 * What every kind's body in the detail pane is given, and the row its
 * buttons sit in: their own file, so the pane and the bodies it draws do not
 * import each other.
 */

export interface Act {
  /**
   * Run one write; on success say so (with an Undo where there is one) and,
   * for a task finished, move on to the next (C5).
   */
  readonly run: (
    write: () => Promise<Outcome>,
    success?: {
      readonly title: string;
      readonly description?: string;
      readonly undo?: () => Promise<Outcome>;
      readonly next?: boolean;
    },
  ) => void;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface BodyProps {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
  readonly act: Act;
  /** Opens the task menu's ask: the thread's reply box takes focus (C7). */
  readonly asking: boolean;
  readonly setAsking: (on: boolean) => void;
  /** C6's "I can't do this", from the menu or the body: the send-back dialog. */
  readonly sendingBack: boolean;
  readonly setSendingBack: (on: boolean) => void;
}

/** The action row at the foot of a body: the primary first, a hint at the end. */
export function Actions({
  children,
  hint,
}: {
  readonly children: ReactNode;
  readonly hint?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {children}
      {hint === undefined ? null : <span className="ms-auto text-sm text-fg-subtle">{hint}</span>}
    </div>
  );
}

/**
 * Opens an address inside the detail pane rather than leaving the Inbox
 * (`InboxDetail` provides it): what a task links to is done where the task
 * sits. Outside the pane, a link as before.
 */
export const OpenHereContext = createContext<((href: string) => void) | null>(null);

export function OpenHere({
  href,
  children,
  ...button
}: Omit<ButtonProps, 'asChild' | 'onClick'> & { readonly href: string }): JSX.Element {
  const open = use(OpenHereContext);
  if (open === null)
    return (
      <Button asChild {...button}>
        <a href={href}>{children}</a>
      </Button>
    );
  return (
    <Button
      {...button}
      onClick={() => {
        open(href);
      }}
    >
      {children}
    </Button>
  );
}

/** For a plain link in a body (a row of a list): its press opens the address in the pane. */
export function useOpenHereClick(): (href: string) => (event: MouseEvent) => void {
  const open = use(OpenHereContext);
  return (href) => (event) => {
    if (open === null || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    open(href);
  };
}
