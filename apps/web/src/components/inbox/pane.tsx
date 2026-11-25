import { Button, type ButtonProps } from '@reach/ui';
import { createContext, use, type JSX, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

/**
 * Where a holder with a footer of its own (Home's modal) wants a body's
 * actions drawn: its footer. Without one, the row pins itself.
 */
export const ActionsSlotContext = createContext<HTMLElement | null>(null);

/**
 * A body's actions, always in reach: a footer fixed to the foot of whatever
 * holds the body, so sending, approving or declining never has to be scrolled
 * to. The primary is written first and drawn last, at the footer's end, where
 * a dialog's confirming button sits; a hint takes the other end.
 */
export function Actions({
  children,
  hint,
}: {
  readonly children: ReactNode;
  readonly hint?: ReactNode;
}): JSX.Element {
  const slot = use(ActionsSlotContext);
  const row = (
    <>
      {children}
      {hint === undefined ? null : <span className="me-auto text-sm text-fg-subtle">{hint}</span>}
    </>
  );
  if (slot !== null) {
    return createPortal(
      <div className="flex w-full flex-row-reverse flex-wrap items-center gap-2">{row}</div>,
      slot,
    );
  }
  return (
    // The Inbox's pane: pinned to the foot of what scrolls, edge to edge of the card.
    <div className="sticky bottom-0 z-10 -mx-5 flex flex-row-reverse flex-wrap items-center gap-2 border-t border-border bg-surface px-5 py-3 touch:-mx-4 touch:px-4">
      {row}
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

/**
 * Draws an address's page in place, beneath what the body says (`InboxDetail`
 * provides it): for an item with no form of its own, whose page is the form.
 */
export const InlineContext = createContext<((href: string) => ReactNode) | null>(null);

export function Inline({ href }: { readonly href: string }): ReactNode {
  const draw = use(InlineContext);
  return draw === null ? null : draw(href);
}
