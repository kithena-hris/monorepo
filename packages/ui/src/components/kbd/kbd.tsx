'use client';

import type { ComponentPropsWithoutRef, JSX } from 'react';
import { useSyncExternalStore } from 'react';

import { cn } from '../../lib/cn';

/**
 * A keyboard key.
 *
 * `mod` renders as ⌘ on Apple platforms and Ctrl everywhere else, which is the
 * only reason this is a component rather than a `<kbd>` with a class. Printing
 * "Ctrl+K" to a Mac user is a small lie that makes the shortcut look broken.
 *
 * Platform detection runs once, on the client, and returns the non-Apple form
 * on the server, a hydration mismatch on a shortcut hint is not worth a
 * client-only render, and Ctrl is the safer default to be wrong with.
 */

const isAppleStore = {
  subscribe: () => () => undefined,
  // `navigator.platform` is deprecated and lies on an iPad, which reports as a
  // Mac. The user agent is the remaining option, and either way this only
  // decides which glyph is printed.
  getSnapshot: () =>
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
  getServerSnapshot: () => false,
};

export interface KbdProps extends ComponentPropsWithoutRef<'kbd'> {
  /**
   * Named keys, rendered with the platform's glyph. Anything else is passed
   * through as children.
   */
  keyName?: 'mod' | 'shift' | 'alt' | 'enter' | 'esc' | 'tab' | 'backspace' | 'up' | 'down';
}

const glyph: Record<NonNullable<KbdProps['keyName']>, { apple: string; other: string }> = {
  mod: { apple: '⌘', other: 'Ctrl' },
  shift: { apple: '⇧', other: 'Shift' },
  alt: { apple: '⌥', other: 'Alt' },
  enter: { apple: '↵', other: 'Enter' },
  esc: { apple: 'esc', other: 'Esc' },
  tab: { apple: '⇥', other: 'Tab' },
  backspace: { apple: '⌫', other: 'Bksp' },
  up: { apple: '↑', other: '↑' },
  down: { apple: '↓', other: '↓' },
};

const accessibleName: Record<NonNullable<KbdProps['keyName']>, string> = {
  mod: 'Command or Control',
  shift: 'Shift',
  alt: 'Alt',
  enter: 'Enter',
  esc: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  up: 'Arrow up',
  down: 'Arrow down',
};

export function Kbd({ className, keyName, children, ...props }: KbdProps): JSX.Element {
  const isApple = useSyncExternalStore(
    isAppleStore.subscribe,
    isAppleStore.getSnapshot,
    isAppleStore.getServerSnapshot,
  );

  const content = keyName ? (isApple ? glyph[keyName].apple : glyph[keyName].other) : children;

  return (
    <kbd
      // The glyph is unreadable aloud, "⌘" is announced as nothing at all by
      // most screen readers, so the name is carried separately.
      aria-label={keyName ? accessibleName[keyName] : undefined}
      className={cn(
        // A keycap: a fill with a hairline along the bottom edge, which is the
        // one detail that makes it read as a key rather than a badge.
        'inline-flex h-6 min-w-6 items-center justify-center rounded-xs px-1.5',
        // Both mixed from the text colour, so the cap holds on a light page,
        // in a dark tooltip and on an accent button without a variant each.
        'bg-[color-mix(in_oklch,currentColor_9%,transparent)]',
        'shadow-[inset_0_-1px_0_color-mix(in_oklch,currentColor_24%,transparent)]',
        // The colour is the surrounding text's, so a key inside a hint, a
        // tooltip or a button reads at that context's weight.
        'font-sans text-[0.75rem] leading-none font-semibold',
        className,
      )}
      {...props}
    >
      {content}
    </kbd>
  );
}
