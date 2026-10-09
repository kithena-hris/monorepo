import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { Company, Person } from '../account';

/**
 * People, as the person signed in: one operation per request, by the name the
 * web uses (`apps/web/src/lib/people-operations.ts`), through the company's
 * own host (`/api/mobile/people`). The web server turns the session into the
 * router's token; People decides what this person may see, as it does for the
 * browser, so nothing here filters or hides.
 */
export interface Signed {
  readonly company: Company;
  readonly sessionId: string;
  readonly person: Person;
  /** The session ended under us: back to signing in. */
  readonly signedOut: () => void;
  /** Signing out on purpose: ends the session in identity, then here. */
  readonly signOut: () => Promise<void>;
  /** Viewing the app as somebody, saying why: null once it has started, else People's refusal. */
  readonly viewAs: (personId: string, reason: string) => Promise<string | null>;
}

export const SignedContext = createContext<Signed | null>(null);

export function useSigned(): Signed {
  const signed = useContext(SignedContext);
  if (signed === null) throw new Error('useSigned outside SignedContext');
  return signed;
}

export type Answer<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function ask<T>(
  signed: Signed,
  operation: string,
  variables: Record<string, unknown> = {},
  /** Whose operation it is: People's, or Time Off's. */
  area: 'people' | 'timeoff' = 'people',
): Promise<Answer<T>> {
  const response = await fetch(`${signed.company.origin}/api/mobile/people`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signed.sessionId}`,
    },
    body: JSON.stringify({ area, operation, variables }),
  }).catch(() => null);
  if (response === null) {
    return { ok: false, code: 'OFFLINE', message: 'Kithena could not be reached. Try again.' };
  }
  if (response.status === 401) {
    signed.signedOut();
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Sign in again.' };
  }
  const answer = (await response.json().catch(() => null)) as Answer<T> | null;
  return answer ?? { ok: false, code: 'UNAVAILABLE', message: 'People did not answer.' };
}

export type Load<T> =
  | { readonly status: 'loading' }
  /** `at`: when the answer was read, for anything that counts on from it. */
  | { readonly status: 'ready'; readonly data: T; readonly at: number }
  | { readonly status: 'error'; readonly message: string };

/**
 * Reads already answered, by session and question: a screen opens on the
 * last answer at once and asks again behind it, so going back, switching tab
 * or opening a screen the app read ahead never waits on the network. Per
 * session, so nobody else's answer is ever shown; in memory only.
 *
 * ponytail: the oldest go past 300 answers; a byte budget if answers grow.
 */
const kept = new Map<string, { readonly data: unknown; readonly at: number }>();
const asking = new Map<string, Promise<Answer<unknown>>>();
const KEEP = 300;

const keyOf = (
  signed: Signed,
  area: string,
  operation: string,
  variables: Record<string, unknown> | string,
): string =>
  [
    signed.company.origin,
    signed.sessionId,
    area,
    operation,
    typeof variables === 'string' ? variables : JSON.stringify(variables),
  ].join('\n');

function keep(key: string, data: unknown): void {
  kept.delete(key);
  kept.set(key, { data, at: Date.now() });
  if (kept.size > KEEP) kept.delete(kept.keys().next().value ?? '');
}

/**
 * A read, its answer kept: two screens, or a read-ahead and the screen it was
 * for, asking the same question at once share one request.
 */
export function read<T>(
  signed: Signed,
  operation: string,
  variables: Record<string, unknown> = {},
  area: 'people' | 'timeoff' = 'people',
): Promise<Answer<T>> {
  const key = keyOf(signed, area, operation, variables);
  const held = asking.get(key);
  if (held !== undefined) return held as Promise<Answer<T>>;
  const answer = ask<T>(signed, operation, variables, area).then((a) => {
    if (a.ok) keep(key, a.data);
    return a;
  });
  asking.set(key, answer);
  void answer.finally(() => asking.delete(key));
  return answer;
}

/**
 * A write went through: a read already on its way was asked before it, so
 * the next screen to ask asks afresh rather than waiting for that answer.
 */
export function wrote(): void {
  asking.clear();
}

/** The last answer to a read, if there is one: of the type the caller asked it as. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names what it reads, as `ask` does.
export function keptAnswer<T>(
  signed: Signed,
  operation: string,
  variables: Record<string, unknown> = {},
  area: 'people' | 'timeoff' = 'people',
): { readonly data: T; readonly at: number } | undefined {
  return kept.get(keyOf(signed, area, operation, variables)) as { data: T; at: number } | undefined;
}

/** Reads a screen is about to need, asked now so it opens on them. */
export function readAhead(
  signed: Signed,
  reads: readonly (readonly [string, Record<string, unknown>?])[],
  area: 'people' | 'timeoff' = 'people',
): void {
  for (const [operation, variables] of reads) void read(signed, operation, variables, area);
}

/**
 * One read, kept for the screen, asked again when its variables change or on
 * `reload`. It opens on the last answer to the same question, if any, and
 * keeps showing it when asking again fails. The variables are compared as
 * JSON, so a new object each render does not ask twice.
 */
export function useRead<T>(
  operation: string,
  variables: Record<string, unknown> = {},
  area: 'people' | 'timeoff' = 'people',
): { load: Load<T>; reload: () => void } {
  const signed = useSigned();
  const key = JSON.stringify(variables);
  const held = (): Load<T> => {
    const last = kept.get(keyOf(signed, area, operation, key));
    return last === undefined
      ? { status: 'loading' }
      : { status: 'ready', data: last.data as T, at: last.at };
  };
  const [load, setLoad] = useState<Load<T>>(held);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    const last = held();
    setLoad(last);
    void read<T>(signed, operation, JSON.parse(key) as Record<string, unknown>, area).then(
      (answer) => {
        if (!live) return;
        if (answer.ok) setLoad({ status: 'ready', data: answer.data, at: Date.now() });
        else if (last.status !== 'ready') setLoad({ status: 'error', message: answer.message });
      },
    );
    return () => {
      live = false;
    };
    // `held` reads the same inputs.
  }, [signed, operation, key, round, area]);

  const reload = useCallback(() => {
    setRound((r) => r + 1);
  }, []);
  return { load, reload };
}

/* ---------------------------------------------------------------------------
 * A record's shape, as People sends it (`RecordFieldParts`, `EntryParts`).
 * ------------------------------------------------------------------------- */

export interface RecordField {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly required: boolean;
  readonly missing: boolean | null;
  readonly readOnly: boolean;
  readonly currency: string | null;
  readonly ownedBy: string | null;
  readonly keptIn: string | null;
  readonly sensitive: boolean | null;
  readonly askable: boolean | null;
}

export interface Entry {
  readonly __typename: string;
  readonly key: string;
  readonly text?: string;
  readonly flag?: boolean;
  readonly items?: readonly string[];
  readonly amountMinor?: string;
  readonly currency?: string;
  readonly last4?: string | null;
}

/** A value as a screen reads it: the web's `formValue` (`people-views.ts`). */
export type Value =
  | string
  | boolean
  | readonly string[]
  | { readonly amountMinor: string; readonly currency: string }
  | { readonly last4: string | null }
  | null;

export function valueOf(entry: Entry): Value {
  switch (entry.__typename) {
    case 'TextEntry':
      return entry.text ?? '';
    case 'FlagEntry':
      return entry.flag === true;
    case 'ListEntry':
      return [...(entry.items ?? [])];
    case 'MoneyEntry':
      return { amountMinor: entry.amountMinor ?? '', currency: entry.currency ?? '' };
    case 'SealedEntry':
      return { last4: entry.last4 ?? null };
    default:
      return null;
  }
}

export function valuesOf(entries: readonly Entry[]): Readonly<Record<string, Value>> {
  return Object.fromEntries(entries.map((e) => [e.key, valueOf(e)]));
}

/** Nothing held: an empty text or list, or no entry. A `false` flag is a value. */
export function isEmpty(value: Value | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** What a save's checks warned about (PEO-125): per field, never the value. */
export interface Finding {
  readonly key: string;
  readonly label: string;
  readonly level: string;
  readonly code: string;
  readonly message: string;
}

/**
 * A form's changed values as People's `FormValueInput`s: one slot each, null
 * clears. The web's `formInputs` (`apps/web/.../people/actions.ts`): a sealed
 * value's last four is what was shown, not something to write back.
 */
export function formInputs(changed: Readonly<Record<string, Value>>): Record<string, unknown>[] {
  return Object.entries(changed).flatMap(([key, value]): Record<string, unknown>[] => {
    if (value === null) return [{ key, clear: true }];
    if (typeof value === 'string') return [{ key, text: value }];
    if (typeof value === 'boolean') return [{ key, flag: value }];
    if (Array.isArray(value)) return [{ key, items: value.map(String) }];
    if (typeof value === 'object' && 'amountMinor' in value) {
      return [{ key, money: { amountMinor: value.amountMinor, currency: value.currency } }];
    }
    return [];
  });
}

/** Two values the same, as a form compares them: lists and money by content. */
export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
