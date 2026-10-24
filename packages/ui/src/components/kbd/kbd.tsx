'use client';

import type { ComponentPropsWithoutRef, JSX } from 'react';
import { Fragment, useSyncExternalStore } from 'react';

import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';

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

/** The key as a keyboard prints it, in the reader's language (Strg, Entf). */
const glyph = (
  key: NonNullable<KbdProps['keyName']>,
): { readonly apple: string; readonly other: string } => {
  switch (key) {
    case 'mod':
      return { apple: '⌘', other: t('components.kbd.kbd.key_ctrl', 'Ctrl') };
    case 'shift':
      return { apple: '⇧', other: t('components.kbd.kbd.key_shift', 'Shift') };
    case 'alt':
      return { apple: '⌥', other: t('components.kbd.kbd.key_alt', 'Alt') };
    case 'enter':
      return { apple: '↵', other: t('components.kbd.kbd.key_enter', 'Enter') };
    case 'esc':
      return { apple: 'esc', other: t('components.kbd.kbd.key_esc', 'Esc') };
    case 'tab':
      return { apple: '⇥', other: t('components.kbd.kbd.key_tab', 'Tab') };
    case 'backspace':
      return { apple: '⌫', other: t('components.kbd.kbd.key_bksp', 'Bksp') };
    case 'up':
      return { apple: '↑', other: '↑' };
    case 'down':
      return { apple: '↓', other: '↓' };
  }
};

const accessibleName = (key: NonNullable<KbdProps['keyName']>): string => {
  switch (key) {
    case 'mod':
      return t('components.kbd.kbd.command_or_control', 'Command or Control');
    case 'shift':
      return t('components.kbd.kbd.key_shift', 'Shift');
    case 'alt':
      return t('components.kbd.kbd.key_alt', 'Alt');
    case 'enter':
      return t('components.kbd.kbd.key_enter', 'Enter');
    case 'esc':
      return t('components.kbd.kbd.key_escape', 'Escape');
    case 'tab':
      return t('components.kbd.kbd.key_tab', 'Tab');
    case 'backspace':
      return t('components.kbd.kbd.key_backspace', 'Backspace');
    case 'up':
      return t('components.kbd.kbd.arrow_up', 'Arrow up');
    case 'down':
      return t('components.kbd.kbd.arrow_down', 'Arrow down');
  }
};

export function Kbd({ className, keyName, children, ...props }: KbdProps): JSX.Element {
  const isApple = useSyncExternalStore(
    isAppleStore.subscribe,
    isAppleStore.getSnapshot,
    isAppleStore.getServerSnapshot,
  );

  const content = keyName ? (isApple ? glyph(keyName).apple : glyph(keyName).other) : children;

  return (
    <kbd
      // The glyph is unreadable aloud, "⌘" is announced as nothing at all by
      // most screen readers, so the name is carried separately.
      aria-label={keyName ? accessibleName(keyName) : undefined}
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

/**
 * A keyboard event as a chord: `'g'`, `'shift+j'`, `'?'`, `'mod+k'`,
 * `'mod+shift+d'`, `'escape'`. `null` for a modifier pressed on its own.
 *
 * `mod` is ⌘ or Ctrl, whichever was held, the way `Kbd` prints it. Shift is
 * named where it changes what the key means — a letter (Shift+J is not J), or
 * a key that types nothing (Shift+Enter) — and not where the character
 * already carries it: `?` is `'?'`, not Shift+/. `event.key` rather than
 * `code`, so a Dvorak or AZERTY layout gets the letter it is looking at —
 * except under Alt, where a Mac types a character instead (⌥T is `†`), so
 * the key's own letter is read from `code`.
 */
export function chordOf(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & {
    readonly code?: string;
  },
): string | null {
  const letter =
    event.altKey && !/^[a-z]$/i.test(event.key) ? /^Key([A-Z])$/.exec(event.code ?? '') : null;
  const key = letter?.[1] ?? event.key;
  if (key === 'Shift' || key === 'Control' || key === 'Meta' || key === 'Alt' || key === '') {
    return null;
  }
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push('mod');
  if (event.altKey) modifiers.push('alt');
  const character = key.length === 1 && key !== ' ' && !/^[a-z]$/i.test(key);
  if (event.shiftKey && (!character || modifiers.length > 0)) modifiers.push('shift');
  return [...modifiers, key === ' ' ? 'space' : key.toLowerCase()].join('+');
}

/** A chord's keys: `'mod+k'` is `['mod', 'k']`, and `'mod++'` is `['mod', '+']`. */
export function keysOfChord(chord: string): string[] {
  if (chord === '+') return ['+'];
  return chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
}

const named: Readonly<Record<string, NonNullable<KbdProps['keyName']>>> = {
  mod: 'mod',
  shift: 'shift',
  alt: 'alt',
  enter: 'enter',
  escape: 'esc',
  tab: 'tab',
  backspace: 'backspace',
  arrowup: 'up',
  arrowdown: 'down',
};

const drawn = (name: string): string | undefined =>
  name === 'space'
    ? t('components.kbd.kbd.key_space', 'Space')
    : name === 'delete'
      ? t('components.kbd.kbd.key_del', 'Del')
      : name === 'arrowleft'
        ? '←'
        : name === 'arrowright'
          ? '→'
          : undefined;

/** One key of a chord: a named key with its glyph, a letter in capitals, anything else as written. */
function Key({ name }: { readonly name: string }): JSX.Element {
  const keyName = named[name];
  if (keyName !== undefined) return <Kbd keyName={keyName} />;
  return <Kbd>{drawn(name) ?? (name.length === 1 ? name.toUpperCase() : name)}</Kbd>;
}

export interface KbdShortcutProps extends ComponentPropsWithoutRef<'span'> {
  /**
   * The chords, pressed one after another, each as `chordOf` writes it:
   * `['g', 'd']` is G then D, `['mod+k']` is ⌘K.
   */
  keys: readonly string[];
}

/**
 * A shortcut as keycaps, from the chords a handler matches. The modifiers
 * still swap per platform, because each is drawn by `Kbd`'s `keyName`. The
 * eye sees the keys of a sequence side by side, as every hint draws them; a
 * reader hears "then" between them.
 */
export function KbdShortcut({ keys, className, ...props }: KbdShortcutProps): JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} {...props}>
      {keys.map((chord, index) => (
        <Fragment key={`${String(index)}:${chord}`}>
          {index === 0 ? null : (
            <span className="sr-only"> {t('components.kbd.kbd.then', 'then')} </span>
          )}
          {keysOfChord(chord).map((name, n) => (
            <Key key={`${String(n)}:${name}`} name={name} />
          ))}
        </Fragment>
      ))}
    </span>
  );
}
