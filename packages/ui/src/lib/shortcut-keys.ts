'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { chordOf, keysOfChord } from '../components/kbd/kbd';

/**
 * The keys an app has chosen, by shortcut id, for the components that answer
 * keys themselves: a table's rows, a list's items, a row's actions, a
 * button's hint.
 *
 * A store rather than a context, because a screen can be rendered in a React
 * root of its own (a hydrated island) that no provider above it reaches; the
 * module is one copy on the page, so every root reads the same keys. The app
 * sets them (`setShortcutKeys`); a component asks by id and never names a key.
 *
 * Reach knows the ids its own components answer to, with defaults, so a list
 * moves with J and K before any app has said anything:
 *
 * | id | default |
 * | --- | --- |
 * | `list.next`, `list.previous` | J, K (and ↓ ↑, always) |
 * | `list.open` | O (and Enter, always) |
 * | `list.select` | X |
 * | `list.extend-next`, `list.extend-previous` | ⇧J, ⇧K (and ⇧↓ ⇧↑) |
 * | `list.preview` | Space |
 *
 * `characterKeys: false` turns off every key without ⌘, Ctrl or Alt (WCAG
 * 2.1.4). The arrows, Enter and Escape are not character keys and stay.
 */
export interface ShortcutKeys {
  readonly keys: Readonly<Record<string, readonly string[]>>;
  readonly characterKeys: boolean;
}

export const LIST_KEYS: Readonly<Record<string, readonly string[]>> = {
  'list.next': ['j'],
  'list.previous': ['k'],
  'list.open': ['o'],
  'list.select': ['x'],
  'list.extend-next': ['shift+j'],
  'list.extend-previous': ['shift+k'],
  'list.preview': ['space'],
};

let current: ShortcutKeys = { keys: LIST_KEYS, characterKeys: true };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const emit = (): void => {
  for (const listener of listeners) listener();
};

/** The app's keys, laid over Reach's defaults. */
export function setShortcutKeys(next: ShortcutKeys): void {
  current = { keys: { ...LIST_KEYS, ...next.keys }, characterKeys: next.characterKeys };
  emit();
}

export function shortcutKeys(): ShortcutKeys {
  return current;
}

export function useShortcutKeys(): ShortcutKeys {
  return useSyncExternalStore(subscribe, shortcutKeys, shortcutKeys);
}

/**
 * A chord that types a character: a letter, a digit, a symbol, Space, with
 * Shift or without, and nothing else held. What WCAG 2.1.4 lets a person turn off.
 */
export function isCharacterChord(chord: string): boolean {
  const keys = keysOfChord(chord);
  const key = keys.at(-1) ?? '';
  const held = keys.slice(0, -1);
  return (
    held.every((k) => k === 'shift') && (key.length === 1 || key === 'space')
  );
}

/** The keys of shortcut `id`, or none: none when they are character keys and those are off. */
export function keysOf(id: string | undefined, state: ShortcutKeys = current): readonly string[] {
  const keys = id === undefined ? undefined : state.keys[id];
  if (keys === undefined || keys.length === 0) return [];
  return !state.characterKeys && keys.some(isCharacterChord) ? [] : keys;
}

/** Whether this keydown is shortcut `id`: one chord, as the app has it. */
export function pressed(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  id: string | undefined,
  state: ShortcutKeys = current,
): boolean {
  const keys = keysOf(id, state);
  return keys.length === 1 && chordOf(event) === keys[0];
}

/*
 * A sequence in progress (`G`, waiting for its second key). A row that answers
 * single keys leaves the next one alone, so G then M goes to a profile rather
 * than merging the focused pair.
 */
let armedUntil = 0;

/** The app's handler says a sequence is waiting for its next key, for `ms`; 0 ends it. */
export function armSequence(ms: number): void {
  armedUntil = ms <= 0 ? 0 : Date.now() + ms;
}

export function sequenceArmed(): boolean {
  return Date.now() < armedUntil;
}

/**
 * Something a screen offers to do, by id, while it is on screen: `create`
 * ("New schedule"), `remind` ("Remind 12 people"). The app runs it from a key
 * or its command palette without knowing the screen; the last one registered
 * under an id is the one that runs.
 */
export interface ScreenCommand {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
}

let commands: readonly ScreenCommand[] = [];
const commandListeners = new Set<() => void>();
const subscribeCommands = (listener: () => void): (() => void) => {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
};

export function screenCommands(): readonly ScreenCommand[] {
  return commands;
}

export function useScreenCommands(): readonly ScreenCommand[] {
  return useSyncExternalStore(subscribeCommands, screenCommands, screenCommands);
}

/** Runs the command registered under `id`; false when no screen offers one. */
export function runScreenCommand(id: string): boolean {
  const command = commands.findLast((c) => c.id === id);
  if (command === undefined) return false;
  command.run();
  return true;
}

/**
 * Something to do to one row of a list: in the row's menu with its keys on
 * the right, and run by those keys while the row has focus. A destructive one
 * confirms in its own `onSelect`, as it would from a click.
 */
export interface RowAction {
  readonly id: string;
  readonly label: string;
  /** The shortcut id whose keys run it (`setShortcutKeys`). */
  readonly shortcut?: string;
  readonly icon?: ReactNode;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/** The action this keydown runs, if any. */
export function actionPressed(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  actions: readonly RowAction[],
  state: ShortcutKeys = current,
): RowAction | undefined {
  return actions.find((a) => a.disabled !== true && pressed(event, a.shortcut, state));
}

/** Offers `command` while the calling component is mounted; `null` offers nothing. */
export function useScreenCommand(command: ScreenCommand | null): void {
  const run = useRef(command?.run);
  run.current = command?.run;
  const id = command?.id;
  const label = command?.label;
  useEffect(() => {
    if (id === undefined || label === undefined) return undefined;
    const entry: ScreenCommand = { id, label, run: () => run.current?.() };
    commands = [...commands, entry];
    for (const listener of commandListeners) listener();
    return () => {
      commands = commands.filter((c) => c !== entry);
      for (const listener of commandListeners) listener();
    };
  }, [id, label]);
}
