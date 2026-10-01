import { err, failure, type Result } from '@kithena/domain-kit';

import { decide, type Approval } from '../approval/approval.js';
import { effectiveRoles, type Holdings } from '../access/roles.js';
import { spokenDate } from '../assistant/selection.js';

/**
 * An export sent to somebody else (design AI13, AI14, MA10). Pure.
 *
 * **Same permissions, both ways.** A file goes to a colleague only as far as
 * that colleague could have exported it themselves. Where the file holds
 * more than they could read — a field they cannot see on somebody in it, or
 * somebody they cannot list — it waits for a second person, a People
 * administrator who is neither the requester nor the recipient, to approve
 * sending that one file. Nothing widens anybody's standing access: an
 * approval covers one file, built once, kept a week.
 *
 * **Who it is for is read by People, never by the model.** A name or a role
 * in the sentence is matched against the accounts that sign in here; two
 * people who fit is nobody, and the person picks.
 */

/** An account that could receive a file: who, and the roles it was granted. */
export interface Candidate {
  readonly accountId: string;
  readonly name: string | null;
  readonly roles: ReadonlySet<string>;
}

const fold = (s: string): string => s.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase();

/** Words, folded, with a possessive's ending taken off ("Finance’s" is "finance"). */
const words = (s: string): string[] =>
  (fold(s).match(/[\p{L}\p{N}]+(?:['’]\p{L}+)*/gu) ?? []).map((w) => w.replace(/['’]s$/u, ''));

const LEADS = new Set(['for', 'to']);

/** What a role is called in a sentence. Granted roles only: an administrator is not "finance". */
const ROLE_WORDS: Readonly<Record<string, string>> = {
  finance: 'finance',
  payroll: 'finance',
  hr: 'hr',
};

const runAt = (ws: readonly string[], phrase: readonly string[]): boolean =>
  phrase.length > 0 && ws.some((_, i) => phrase.every((p, j) => ws[i + j] === p));

const one = (found: readonly string[]): string | null => {
  const distinct = [...new Set(found)];
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
};

/**
 * The account a sentence names as the file's recipient, or null. Tried in
 * order, the first that finds exactly one person wins: a full name anywhere,
 * a first name after "for" or "to", then a role after "for" or "to" held by
 * one person only. The requester is never their own recipient.
 */
export function recipientIn(
  sentence: string,
  candidates: readonly Candidate[],
  requester: string,
): string | null {
  const ws = words(sentence);
  const others = candidates.filter((c) => c.accountId !== requester);
  const named = others.flatMap((c) => (c.name === null ? [] : [{ c, name: words(c.name) }]));
  const led = ws.filter((_, i) => i > 0 && LEADS.has(ws[i - 1] ?? ''));

  const full = named.filter(({ name }) => name.length > 1 && runAt(ws, name));
  if (full.length > 0) return one(full.map(({ c }) => c.accountId));

  const first = named.filter(({ name }) => name[0] !== undefined && led.includes(name[0]));
  if (first.length > 0) return one(first.map(({ c }) => c.accountId));

  const roles = new Set(led.flatMap((w) => ROLE_WORDS[w] ?? []));
  const holders = others.filter((c) => [...roles].some((r) => c.roles.has(r)));
  return one(holders.map((c) => c.accountId));
}

/* -------------------------------------------------------------- the gap -- */

/** Person id → the field keys a viewer may read on them, for the people they may list. */
export type Readable = ReadonlyMap<string, ReadonlySet<string>>;

export interface Gap {
  /** In the file's column order: each field the recipient could not read, and on how many people. */
  readonly fields: readonly { readonly key: string; readonly people: number }[];
  /** People in the file the recipient could not list at all. */
  readonly unlisted: number;
}

/** What the requester's file holds that the recipient could not read themselves; null for nothing. */
export function gapBetween(
  asker: Readable,
  recipient: Readable,
  order: readonly string[],
): Gap | null {
  const counts = new Map<string, number>();
  let unlisted = 0;
  for (const [person, keys] of asker) {
    const theirs = recipient.get(person);
    if (theirs === undefined) unlisted += 1;
    for (const key of keys) {
      if (theirs?.has(key) !== true) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const fields = order.flatMap((key) => {
    const people = counts.get(key);
    return people === undefined ? [] : [{ key, people }];
  });
  return fields.length === 0 && unlisted === 0 ? null : { fields, unlisted };
}

/* ------------------------------------------------------------- approval -- */

/** Every People administrator but the requester and the recipient: who may approve sending. */
export function approversFor(holdings: Holdings, requester: string, recipient: string): string[] {
  return [...holdings].flatMap(([account, roles]) =>
    roles.has('people_admin') && account !== requester && account !== recipient ? [account] : [],
  );
}

/** A request to send one file that holds more than its recipient could read. */
export interface Share {
  readonly approval: Approval;
  readonly recipient: string;
}

const NotAnApprover = failure(
  'FORBIDDEN',
  'Only a People administrator who is neither asking nor receiving approves sending this',
);

export function decideShare<S extends Share>(
  share: S,
  by: { readonly accountId: string; readonly roles: ReadonlySet<string> },
  approve: boolean,
  at: string,
  note?: string | null,
): Result<S> {
  if (!effectiveRoles(by.roles).has('people_admin') || by.accountId === share.recipient) {
    return err(NotAnApprover);
  }
  const decided = decide(share.approval, { by: by.accountId, approve, at, note: note ?? null });
  return decided.ok ? { ok: true, value: { ...share, approval: decided.value } } : decided;
}

/* ---------------------------------------------------------- the About -- */

export interface AboutInput {
  /** Who is in it, in the builder's words. */
  readonly audience: string;
  readonly count: number;
  readonly fields: readonly {
    readonly label: string;
    readonly money: boolean;
    /** Exported masked: its last four characters only. */
    readonly masked: boolean;
  }[];
  readonly asOf: string;
  /** The requester's name, as People holds it; null when it holds none. */
  readonly madeBy: string | null;
  readonly madeOn: string;
  readonly reason: string | null;
  /** Whom it was sent to, by name. */
  readonly recipient: string | null;
  /** The last day its link opens, when it has one that is known. */
  readonly expiresOn: string | null;
  readonly exportId: string;
}

export interface About {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly footnote: string;
}

/** "FTE" stays "FTE", "Base salary" reads "base salary" mid-sentence. */
const inSentence = (label: string): string =>
  /^\p{Lu}\p{Ll}/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;

const listed = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

/** The short code the file and the screen both show; the full id is in the audit log. */
export const exportCode = (exportId: string): string =>
  `EXP-${exportId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;

/**
 * The first sheet of every export: what it holds, as of when, for whom and
 * why, so it still makes sense forwarded months later. Says only what People
 * knows: no claim about a salary being annual or gross, which a field does
 * not record.
 */
export function aboutSheet(input: AboutInput): About {
  const date = spokenDate(input.asOf);
  const one = input.count === 1;
  const paragraphs = [
    `${String(input.count)} ${one ? 'person' : 'people'}, with their ${listed(input.fields.map((f) => inSentence(f.label)))} as ${one ? 'it was' : 'they were'} at the end of ${date}.`,
    `Made${input.madeBy === null ? '' : ` by ${input.madeBy}`} on ${spokenDate(input.madeOn)}${
      input.recipient === null ? '' : ` for ${input.recipient}`
    }.${input.reason === null || input.reason === '' ? '' : ` Why: ${input.reason.replace(/\.$/u, '')}.`}`,
  ];
  if (input.fields.some((f) => f.money)) {
    paragraphs.push(
      'Amounts are as recorded for each person, in their own currency, and are not converted.',
    );
  }
  const masked = input.fields.filter((f) => f.masked).map((f) => f.label);
  if (masked.length > 0) {
    paragraphs.push(
      `${listed(masked)} ${masked.length === 1 ? 'shows only its' : 'show only their'} last four characters, as ${masked.length === 1 ? 'it does' : 'they do'} in People.`,
    );
  }
  return {
    title: `${input.audience}, ${date}`,
    paragraphs,
    footnote: [
      'Confidential',
      ...(input.expiresOn === null ? [] : [`link expires ${spokenDate(input.expiresOn)}`]),
      `export ID ${exportCode(input.exportId)}`,
    ].join(' · '),
  };
}
