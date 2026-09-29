'use client';

import { useId, type JSX, type ReactNode } from 'react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog';
import { KbdShortcut } from '../kbd/kbd';

/**
 * Every keyboard shortcut an app has, by group: what `?` opens.
 *
 * It lists and nothing else. Which keys exist, what they do and whether they
 * are on at all is the app's; the switch that turns character keys off (WCAG
 * 2.1.4) and a way to change them go in `footer`.
 */
export interface ShortcutGroup {
  readonly label: string;
  readonly shortcuts: readonly {
    readonly id?: string;
    readonly label: string;
    /** Chords as `chordOf` writes them: `['g', 'd']`, `['mod+k']`. */
    readonly keys: readonly string[];
  }[];
}

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly ShortcutGroup[];
  readonly title?: string;
  readonly description?: ReactNode;
  /** Under the list, beside each other: a switch, a link to change the keys. */
  readonly footer?: ReactNode;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  groups,
  title = 'Keyboard shortcuts',
  description,
  footer,
}: ShortcutsDialogProps): JSX.Element {
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        // The dialog itself takes focus, not the list's scroller, which is the
        // first thing in it that can: Tab reaches that, and Escape closes.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.target instanceof HTMLElement) event.target.focus();
        }}
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Focusable, so a keyboard can scroll a list longer than the dialog: nothing in it is. */}
        <DialogBody
          tabIndex={0}
          className="@container focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        >
          {/* Two columns where the dialog has room for them: its width, never the window's. */}
          <div className="gap-x-10 pb-2 @xl:columns-2">
            {groups.map((group, g) => (
              <section
                key={group.label}
                aria-labelledby={`${id}-${String(g)}`}
                className="mb-6 break-inside-avoid"
              >
                <h3 id={`${id}-${String(g)}`} className="mb-1 text-xs font-semibold text-fg-subtle">
                  {group.label}
                </h3>
                <ul className="divide-y divide-border">
                  {group.shortcuts.map((shortcut) => (
                    <li
                      key={shortcut.id ?? shortcut.label}
                      className="flex min-h-10 items-center justify-between gap-4 py-1.5 text-sm text-fg"
                    >
                      <span className="min-w-0">{shortcut.label}</span>
                      <KbdShortcut keys={shortcut.keys} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogBody>
        {footer === undefined ? null : (
          <DialogFooter className="items-center justify-between border-t border-border pt-4">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
