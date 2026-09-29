'use client';

import {
  Button,
  Field,
  FieldControl,
  FieldLabel,
  KbdShortcut,
  ShortcutsDialog,
  Switch,
  armSequence,
  chordOf,
} from '@reach/ui';
import Link from 'next/link';
import { createContext, use, useSyncExternalStore, type JSX, type ReactNode } from 'react';

import {
  GROUPS,
  isCharacterKey,
  type Shortcut,
  type ShortcutPrefs,
} from '../lib/shortcuts';

/**
 * The shortcuts as the shell runs them: the one key handler, what every hint
 * reads, and the `?` dialog. The table and its rules are `lib/shortcuts`.
 */

/** How long the second key of a sequence is waited for. */
export const SEQUENCE_MS = 1000;

/** Where a key is being typed, which no shortcut takes from. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

/**
 * The shortcuts the shell does itself, at the window: going somewhere, `/`,
 * `[` `]`, `?`, C, ⌘Enter, and J or K into the page's list when no row has
 * focus yet. A focused row's keys (J, K, X, A…) are the Reach list's, which
 * answers first and marks the key handled; ⌘K, ⌘\ and Escape belong to the
 * components that answer them.
 *
 * Never while a field has the key (⌘Enter excepted: submitting from a field
 * is the point), never for a key something else already handled, never a
 * single-key shortcut with ⌘, Ctrl or Alt held (that chord is a different
 * one), and no single-key shortcut at all once a person has turned them off.
 * While a sequence waits for its second key, Reach's lists are told
 * (`armSequence`), so G then M goes to a profile rather than merging the
 * focused pair. `run` does the shortcut and says whether there was anything
 * to do: a key that does nothing here is left to the page.
 */
export function shortcutHandler(options: {
  readonly table: readonly Shortcut[];
  readonly characterKeys: boolean;
  readonly run: (id: string, event: KeyboardEvent) => boolean;
  readonly now?: () => number;
}): (event: KeyboardEvent) => void {
  const { characterKeys, run, now = () => Date.now() } = options;
  const live = options.table.filter(
    (s) =>
      (s.fixed !== true || s.id === 'help') &&
      (s.scope === undefined || s.id === 'list.next' || s.id === 'list.previous'),
  );
  const find = (keys: readonly string[]): Shortcut | undefined =>
    live.find((s) => s.keys.length === keys.length && s.keys.every((k, i) => k === keys[i]));
  const submit = options.table.find((s) => s.id === 'form.submit');
  let armed: { readonly chord: string; readonly at: number } | null = null;
  const arm = (next: typeof armed): void => {
    armed = next;
    armSequence(next === null ? 0 : SEQUENCE_MS);
  };

  return (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const chord = chordOf(event);
    if (chord === null) return;
    if (typing(event.target)) {
      // The one shortcut that belongs in a field.
      if (submit?.keys.length === 1 && submit.keys[0] === chord && run(submit.id, event)) {
        event.preventDefault();
      }
      return;
    }
    const previous = armed !== null && now() - armed.at < SEQUENCE_MS ? armed.chord : null;
    arm(null);
    if (!characterKeys && isCharacterKey(chord)) return;
    const match = (previous === null ? undefined : find([previous, chord])) ?? find([chord]);
    if (match !== undefined && (characterKeys || !match.keys.some(isCharacterKey))) {
      if (run(match.id, event)) event.preventDefault();
      return;
    }
    if (live.some((s) => s.keys.length === 2 && s.keys[0] === chord)) {
      arm({ chord, at: now() });
    }
  };
}

/**
 * ⌘Enter: the form the focus is in, submitted as its submit button would;
 * outside a form, the primary button of the dialog it is in.
 */
export function submitFocused(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const form = target.closest('form');
  if (form !== null) {
    form.requestSubmit();
    return true;
  }
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]');
  const primary = [
    ...(dialog?.querySelectorAll<HTMLButtonElement>(
      'button[type="submit"], button[data-variant="primary"], button[data-variant="danger"]',
    ) ?? []),
  ].findLast((b) => !b.disabled);
  if (primary === undefined) return false;
  primary.click();
  return true;
}

/** J or K with no row focused: into the page's list, on its row in the tab order. */
export function focusList(): boolean {
  const row = document.querySelector<HTMLElement>(
    'main [data-roving-row][tabindex="0"], main [data-list-row][tabindex="0"]',
  );
  if (row === null) return false;
  row.focus();
  return true;
}

/** The page's own search, focused, when it has one on screen. */
export function focusPageSearch(): boolean {
  const field = Array.from(
    document.querySelectorAll<HTMLInputElement>('main input[type="search"]'),
  ).find((el) => el.getClientRects().length > 0);
  if (field === undefined) return false;
  field.focus();
  field.select();
  return true;
}

export interface ShortcutsValue {
  readonly prefs: ShortcutPrefs;
  /** The table with this person's keys. */
  readonly table: readonly Shortcut[];
  /** Where each go-to shortcut takes this viewer, by id; absent where it goes nowhere. */
  readonly destinations: ReadonlyMap<string, string>;
  /** The keys a hint beside a link to `path` shows, while they work. */
  readonly keysFor: (path: string) => readonly string[] | undefined;
  readonly openHelp: () => void;
  /** What C makes on this page, and makes it; null where the page makes nothing. */
  readonly create?: { readonly label: string; readonly run: () => void } | null;
  /** Saves, then draws the shell again with them; the refusal's sentence, or null. */
  readonly save: (prefs: ShortcutPrefs) => Promise<string | null>;
}

const NONE: ShortcutsValue = {
  prefs: { bindings: {}, characterKeys: true },
  table: [],
  destinations: new Map(),
  keysFor: () => undefined,
  openHelp: () => undefined,
  save: () => Promise.resolve(null),
};

const ShortcutsContext = createContext<ShortcutsValue>(NONE);

/** The shell's shortcuts; outside the shell, none. */
export function useShortcuts(): ShortcutsValue {
  return use(ShortcutsContext);
}

/** ⌘ or Ctrl, for a sentence: the same question `Kbd` asks. */
export function useApple(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false,
  );
}

/**
 * A path's keys as keycaps, for a tooltip, a menu row or a flyout;
 * `undefined` where it has none, so no empty hint is drawn.
 */
export function useHint(): (path: string) => JSX.Element | undefined {
  const { keysFor } = useShortcuts();
  return (path) => {
    const keys = keysFor(path);
    return keys === undefined ? undefined : <KbdShortcut keys={keys} />;
  };
}

/**
 * `?`: every shortcut, by group, and the switch that turns single-key
 * shortcuts off (WCAG 2.1.4). A go-to shortcut to somewhere this viewer
 * cannot open is left out rather than listed as broken.
 */
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { prefs, table, destinations, save } = useShortcuts();
  const groups = GROUPS.map((label) => ({
    label,
    shortcuts: table.filter(
      (s) => s.group === label && (s.href === undefined || destinations.has(s.id)),
    ),
  }));
  return (
    <ShortcutsDialog
      open={open}
      onOpenChange={onOpenChange}
      groups={groups}
      description={
        prefs.characterKeys
          ? 'Press G, then a letter, to go somewhere. Not while you are typing in a field.'
          : 'Single-key shortcuts are off. Those with ⌘ or Ctrl still work.'
      }
      footer={
        <>
          <Field orientation="horizontal" className="gap-3">
            <FieldLabel>Single-key shortcuts</FieldLabel>
            <FieldControl>
              <Switch
                checked={prefs.characterKeys}
                onCheckedChange={(on) => {
                  void save({ ...prefs, characterKeys: on });
                }}
              />
            </FieldControl>
          </Field>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/settings/shortcuts"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Change shortcuts
            </Link>
          </Button>
        </>
      }
    />
  );
}

/** Children with the shortcuts in context. */
export function Shortcuts({
  value,
  children,
}: {
  readonly value: ShortcutsValue;
  readonly children: ReactNode;
}): JSX.Element {
  return <ShortcutsContext value={value}>{children}</ShortcutsContext>;
}
