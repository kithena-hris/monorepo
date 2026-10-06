import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { usePlatform } from '../../provider.tsx';

/**
 * A keyboard key, as the web's: `mod` is ⌘ on iOS and Ctrl on Android, and a named key is read by its name, since "⌘" is read as
 * nothing at all.
 *
 * A phone has no keyboard, so a shortcut is usually left out there. When the
 * same screen also serves a tablet with one, `touch="hide"` keeps the key on
 * a device that can press it and drops it from one that cannot.
 */

type KeyName =
  | 'mod'
  | 'shift'
  | 'alt'
  | 'ctrl'
  | 'enter'
  | 'esc'
  | 'tab'
  | 'backspace'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'space';

const glyph: Record<KeyName, { apple: string; other: string }> = {
  mod: { apple: '⌘', other: 'Ctrl' },
  shift: { apple: '⇧', other: 'Shift' },
  alt: { apple: '⌥', other: 'Alt' },
  ctrl: { apple: '⌃', other: 'Ctrl' },
  enter: { apple: '↵', other: 'Enter' },
  esc: { apple: 'Esc', other: 'Esc' },
  tab: { apple: 'Tab', other: 'Tab' },
  backspace: { apple: '⌫', other: 'Bksp' },
  up: { apple: '↑', other: '↑' },
  down: { apple: '↓', other: '↓' },
  left: { apple: '←', other: '←' },
  right: { apple: '→', other: '→' },
  space: { apple: 'Space', other: 'Space' },
};

const spoken: Record<KeyName, string> = {
  mod: 'Command or Control',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Control',
  enter: 'Enter',
  esc: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  up: 'Arrow up',
  down: 'Arrow down',
  left: 'Arrow left',
  right: 'Arrow right',
  space: 'Space',
};

/** A glyph typed literally is read by its name too. */
const SYMBOLS: Record<string, string> = {
  '⌘': 'Command',
  '⌥': 'Option',
  '⇧': 'Shift',
  '⌃': 'Control',
  '↵': 'Enter',
  '⌫': 'Backspace',
  '⇥': 'Tab',
  '↑': 'Arrow up',
  '↓': 'Arrow down',
  '←': 'Arrow left',
  '→': 'Arrow right',
};

const NAMES = new Set<string>(Object.keys(glyph));
const isName = (key: string): key is KeyName => NAMES.has(key);

const WEB = Platform.OS === 'web';

type Media = { matchMedia?: (query: string) => { matches: boolean } };

/**
 * Whether a keyboard is likely to hand: a fine pointer on the web, an iPad on
 * a device (its keyboard is a common accessory). A phone answers no. Only
 * decides whether a hint is drawn, never whether a shortcut works.
 */
export function useHasKeyboard(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () =>
      WEB
        ? ((globalThis as Media).matchMedia?.('(any-pointer: fine)').matches ?? true)
        : Platform.OS === 'ios' && Platform.isPad,
    () => true,
  );
}

export type KbdProps = {
  /**
   * A key: a named one (`mod`, `shift`, `enter`, `esc`, arrows…) in the
   * platform's glyph, or the character itself (`K`, `?`, `⌘` when the
   * shortcut is Apple's only).
   */
  children: string;
  /** In a tooltip or on a filled button: the cap washes the colour it sits on. */
  inverted?: boolean;
  /** `hide`: leave it out where there is no keyboard to press it on. */
  touch?: 'show' | 'hide';
  className?: string | undefined;
};

/** One keycap: a fill with a hairline along its bottom edge, so it reads as a key. */
export function Kbd({
  children,
  inverted = false,
  touch = 'show',
  className,
}: KbdProps): React.JSX.Element | null {
  const keyboard = useHasKeyboard();
  // Apple's glyphs for iOS, the key's printed name for Android.
  const apple = usePlatform() === 'ios';
  if (touch === 'hide' && !keyboard) return null;
  const named = isName(children);
  const label = named ? (apple ? glyph[children].apple : glyph[children].other) : children;
  const name = named ? spoken[children] : SYMBOLS[children];
  return (
    <View
      {...(name ? { accessibilityLabel: name, accessible: true } : {})}
      className={cn(
        'items-center justify-center overflow-hidden rounded-[6px] px-1.5',
        inverted ? 'h-5 min-w-5' : 'h-6 min-w-6 border-b border-border-strong bg-surface-sunken',
        className,
      )}
    >
      {inverted ? <View className="absolute inset-0 bg-fg-on-invert opacity-[0.14]" /> : null}
      <CssText
        className={cn(
          'text-[12px] font-semibold leading-none',
          inverted ? 'text-fg-on-invert' : 'text-fg',
        )}
      >
        {label}
      </CssText>
    </View>
  );
}

export type KbdGroupProps = {
  /** The keys pressed together, in order: `['mod', 'K']`. */
  keys: readonly string[];
  inverted?: boolean;
  touch?: 'show' | 'hide';
  className?: string | undefined;
};

/** A chord: the caps 3pt apart, read as one shortcut. */
export function KbdGroup({
  keys,
  inverted = false,
  touch = 'show',
  className,
}: KbdGroupProps): React.JSX.Element | null {
  const keyboard = useHasKeyboard();
  if (touch === 'hide' && !keyboard) return null;
  return (
    <View className={cn('flex-row gap-[3px]', className)}>
      {keys.map((key, i) => (
        // A chord may repeat a key (G then G); the position is the identity.
        <Kbd key={`${key}-${String(i)}`} inverted={inverted}>
          {key}
        </Kbd>
      ))}
    </View>
  );
}
