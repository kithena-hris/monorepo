import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type * as z from 'zod';
import {
  SignatureMark as MarkSchema,
  type CalendarDate,
  type DocumentId,
  type Instant,
  type PersonId,
} from '@kithena/contracts';

/**
 * A signature request (PRD §10): one document version, signers in order,
 * fields on its pages per signer, and each signer's trail. A plain record and
 * its transitions, as the document is. Sealing the signed file is the
 * application's (it draws a PDF); deciding who may do each step is the
 * application's too, from the document's access.
 */

export type SignerCheck = 'login' | 'email_code';
export type SignerStatus = 'waiting' | 'sent' | 'opened' | 'verified' | 'signed' | 'declined';
export type EnvelopeStatus = 'sent' | 'completed' | 'declined' | 'voided';
export type FieldKind = 'signature' | 'initials' | 'date' | 'name' | 'title' | 'checkbox' | 'text';

/**
 * A signature as kept: the contract's, where a typed one from before styles
 * existed has none and is drawn in the flowing face.
 */
export type SignatureMark = z.input<typeof MarkSchema>;

export interface Signer {
  readonly id: string;
  readonly order: number;
  /** A member signs with their login; somebody outside, by email and a code. */
  readonly personId: PersonId | null;
  readonly email: string | null;
  readonly name: string;
  readonly check: SignerCheck;
  readonly allowDelegate: boolean;
  readonly status: SignerStatus;
  /** SHA-256 of the signing link's token, for an outside signer. */
  readonly tokenHash: string;
  readonly codeHash: string | null;
  readonly codeSentAt: Instant | null;
  readonly codeAttempts: number;
  readonly openedAt: Instant | null;
  readonly signedAt: Instant | null;
  readonly signature: SignatureMark | null;
  readonly declineReason: string | null;
}

/** Where a field sits on its page, each as a fraction of the page's width or height. */
export interface Field {
  readonly id: string;
  readonly signerId: string;
  readonly kind: FieldKind;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly required: boolean;
  readonly label: string | null;
  readonly value?: string | null;
}

export interface Envelope {
  readonly id: string;
  readonly documentId: DocumentId;
  /** The version signed: a new version is a new envelope. */
  readonly version: number;
  readonly senderAccount: string;
  readonly status: EnvelopeStatus;
  readonly signers: readonly Signer[];
  readonly fields: readonly Field[];
  readonly message: string;
  readonly dueOn: CalendarDate | null;
  readonly createdAt: Instant;
  readonly completedAt: Instant | null;
  readonly voidReason: string | null;
  /** The sealed version, once completed. */
  readonly signedVersion: number | null;
  /**
   * The document as signed so far (K7): every signature in, drawn where it
   * goes, each with its trace. What the next signer reads; absent until
   * somebody signs, and on a request older than it.
   */
  readonly workingBlobKey?: string | null;
  /**
   * What another module filed this for, so it can match the completion
   * without asking Documents anything: `recruiting:offer:<id>:<version>`
   * (Recruiting PRD §21.2). Absent on a request made in Documents itself.
   */
  readonly subjectRef?: string | null;
}

export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;

/**
 * A dated signature: the signature with the day it was signed under it, one
 * box. What Kithena places for a signer nobody placed boxes for, and a place
 * to sign in its own right (`SIGNS`).
 */
const DATED = { w: 0.38, h: 0.09 } as const;

/** The boxes a signer signs in: a signature, or a signature with its date. */
export const SIGNS: ReadonlySet<FieldKind> = new Set(['signature', 'date']);

const dated = (signerId: string, page: number, x: number, y: number): Field => ({
  id: `${signerId}-date`,
  signerId,
  kind: 'date',
  page,
  x,
  y,
  ...DATED,
  required: true,
  label: null,
});

/**
 * Kithena places what nobody placed (K2): a dated signature for each signer
 * on the last page, side by side, one row per signer from the bottom.
 */
export function defaultFields(signerIds: readonly string[], lastPage: number): Field[] {
  return signerIds.map((signerId, i) =>
    dated(signerId, lastPage, i % 2 === 0 ? 0.08 : 0.54, 0.78 - Math.floor(i / 2) * 0.12),
  );
}

export interface SendInput {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly version: number;
  readonly pages: number;
  readonly senderAccount: string;
  readonly signers: readonly Pick<
    Signer,
    'id' | 'order' | 'personId' | 'email' | 'name' | 'check' | 'allowDelegate' | 'tokenHash'
  >[];
  readonly fields: readonly Field[];
  readonly message: string;
  readonly dueOn: CalendarDate | null;
  readonly at: Instant;
  readonly subjectRef?: string | null;
}

/** Where a document says to sign: a page, and the line's top left as fractions of it. */
export interface SignatureLine {
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

const clamp = (n: number, size: number): number => Math.min(Math.max(n, 0), 1 - size);

/**
 * K2: each signer, in signing order, signs beside a line the document has
 * ("Signature", "Signed by"), a dated signature; a signer with no line left
 * signs at the foot of the last page, as `defaultFields` places them.
 */
export function fieldsAt(
  signerIds: readonly string[],
  lines: readonly SignatureLine[],
  lastPage: number,
  options: { readonly initialEachPage?: boolean } = {},
): Field[] {
  const placed = signerIds.slice(0, lines.length).flatMap((signerId, i): Field[] => {
    const line = lines[i];
    if (line === undefined) return [];
    return [dated(signerId, line.page, clamp(line.x, DATED.w), clamp(line.y, DATED.h))];
  });
  return [
    ...placed,
    ...defaultFields(signerIds.slice(lines.length), lastPage),
    ...(options.initialEachPage === true ? initialled(signerIds, lastPage) : []),
  ];
}

const INITIALS = { w: 0.1, h: 0.045 } as const;

/**
 * A contract initialled on every page before the one it is signed on, as
 * Spanish and Indian practice expects and every reader of a long contract
 * can check: each signer's initials, side by side in the bottom margin.
 */
function initialled(signerIds: readonly string[], lastPage: number): Field[] {
  const pages = Array.from({ length: Math.max(lastPage - 1, 0) }, (_, i) => i + 1);
  return pages.flatMap((page) =>
    signerIds.map((signerId, i) => ({
      id: `${signerId}-initials-${String(page)}`,
      signerId,
      kind: 'initials' as const,
      page,
      x: clamp(0.88 - (signerIds.length - 1 - i) * (INITIALS.w + 0.02), INITIALS.w),
      y: 1 - INITIALS.h - 0.02,
      ...INITIALS,
      required: true,
      label: null,
    })),
  );
}

const within = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

export function send(input: SendInput): Result<Envelope> {
  if (input.signers.length === 0 || input.signers.length > 10) {
    return err(failure('SIGNERS', 'One to ten people sign', ['signers']));
  }
  const who = input.signers.map((s) => s.personId ?? s.email?.toLowerCase() ?? '');
  if (who.some((w) => w === '') || new Set(who).size !== who.length) {
    return err(failure('SIGNERS', 'Each signer is a person or an email, once', ['signers']));
  }
  if (input.signers.some((s) => s.personId === null && s.check !== 'email_code')) {
    return err(failure('SIGNERS', 'Somebody outside confirms with a code', ['signers']));
  }
  const fields =
    input.fields.length === 0
      ? defaultFields(
          input.signers.map((s) => s.id),
          input.pages,
        )
      : input.fields;
  const ids = new Set(input.signers.map((s) => s.id));
  for (const f of fields) {
    if (!ids.has(f.signerId)) return err(failure('FIELDS', 'A field for nobody', ['fields']));
    if (f.page < 1 || f.page > input.pages)
      return err(failure('FIELDS', 'A field off the document', ['fields']));
    if (![f.x, f.y, f.w, f.h].every(within) || f.x + f.w > 1 || f.y + f.h > 1) {
      return err(failure('FIELDS', 'A field off its page', ['fields']));
    }
  }
  for (const s of input.signers) {
    if (!fields.some((f) => f.signerId === s.id && SIGNS.has(f.kind))) {
      return err(failure('FIELDS', `${s.name} has nowhere to sign`, ['fields']));
    }
  }
  const first = Math.min(...input.signers.map((s) => s.order));
  return ok({
    id: input.id,
    documentId: input.documentId,
    version: input.version,
    senderAccount: input.senderAccount,
    status: 'sent',
    signers: input.signers
      .toSorted((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        status: s.order === first ? 'sent' : 'waiting',
        codeHash: null,
        codeSentAt: null,
        codeAttempts: 0,
        openedAt: null,
        signedAt: null,
        signature: null,
        declineReason: null,
      })),
    fields: fields.map((f) => ({ ...f, value: null })),
    message: input.message.trim().slice(0, 2000),
    dueOn: input.dueOn,
    createdAt: input.at,
    completedAt: null,
    voidReason: null,
    signedVersion: null,
    subjectRef: input.subjectRef ?? null,
  });
}

const open = (env: Envelope): Result<true> =>
  env.status === 'sent' ? ok(true) : err(failure('CLOSED', `This request is ${env.status}`));

function signerOf(env: Envelope, signerId: string): Result<Signer> {
  const s = env.signers.find((x) => x.id === signerId);
  return s === undefined ? err(failure('NOT_FOUND', 'No such signer')) : ok(s);
}

const withSigner = (env: Envelope, next: Signer): Envelope => ({
  ...env,
  signers: env.signers.map((s) => (s.id === next.id ? next : s)),
});

/** Their turn, not yet signed. */
function turn(env: Envelope, signerId: string): Result<Signer> {
  const alive = open(env);
  if (!alive.ok) return alive;
  const s = signerOf(env, signerId);
  if (!s.ok) return s;
  if (s.value.status === 'waiting')
    return err(failure('NOT_YOUR_TURN', 'Somebody signs before you'));
  if (s.value.status === 'signed' || s.value.status === 'declined') {
    return err(failure('DONE', 'You have already answered this'));
  }
  return s;
}

export function markOpened(env: Envelope, signerId: string, at: Instant): Result<Envelope> {
  const s = turn(env, signerId);
  if (!s.ok) return s;
  if (s.value.status !== 'sent') return ok(env);
  // A colleague signs in to open it: their login is the check.
  const status: SignerStatus = s.value.check === 'login' ? 'verified' : 'opened';
  return ok(withSigner(env, { ...s.value, status, openedAt: at }));
}

export function issueCode(
  env: Envelope,
  signerId: string,
  codeHash: string,
  at: Instant,
): Result<Envelope> {
  const s = turn(env, signerId);
  if (!s.ok) return s;
  if (s.value.check !== 'email_code') return err(failure('NO_CODE', 'This signer signs in'));
  return ok(withSigner(env, { ...s.value, codeHash, codeSentAt: at, codeAttempts: 0 }));
}

const minutesBetween = (from: Instant, to: Instant) => (Date.parse(to) - Date.parse(from)) / 60_000;

/** The code they typed, hashed by the caller; a wrong one counts against five. */
export function checkCode(
  env: Envelope,
  signerId: string,
  codeHash: string,
  at: Instant,
): Result<{ envelope: Envelope; matched: boolean }> {
  const s = turn(env, signerId);
  if (!s.ok) return s;
  const signer = s.value;
  if (signer.codeHash === null || signer.codeSentAt === null) {
    return err(failure('NO_CODE', 'Ask for a code first'));
  }
  if (signer.codeAttempts >= CODE_ATTEMPTS)
    return err(failure('CODE_LOCKED', 'Too many tries; ask for a new code'));
  if (minutesBetween(signer.codeSentAt, at) > CODE_MINUTES) {
    return err(failure('CODE_EXPIRED', 'That code has expired; ask for a new one'));
  }
  if (signer.codeHash !== codeHash) {
    return ok({
      envelope: withSigner(env, { ...signer, codeAttempts: signer.codeAttempts + 1 }),
      matched: false,
    });
  }
  return ok({
    envelope: withSigner(env, { ...signer, status: 'verified', codeHash: null, codeAttempts: 0 }),
    matched: true,
  });
}

const DAY_MS = 86_400_000;

/**
 * The day a date box shows: the signer's own, as their device gave it, where
 * it is a real day within one of the clock's (every time zone is), else the
 * clock's day in UTC. The signing instant itself is always the server's.
 */
function signersDay(given: string | undefined, at: Instant): string {
  const utc = at.slice(0, 10);
  if (given === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(given)) return utc;
  const apart = Math.abs(Date.parse(`${given}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`));
  return Number.isNaN(apart) || apart > DAY_MS ? utc : given;
}

/**
 * Sign: every required field of theirs filled (the date fills itself), the
 * signature adopted, and the turn passes on — to the next in order, or the
 * request completes.
 */
export function sign(
  env: Envelope,
  signerId: string,
  input: {
    readonly signature: SignatureMark;
    readonly values: Readonly<Record<string, string>>;
    /** The signer's own calendar day, as their device has it: what the date box says. */
    readonly day?: string | undefined;
  },
  at: Instant,
): Result<Envelope> {
  const s = turn(env, signerId);
  if (!s.ok) return s;
  if (s.value.status !== 'verified') return err(failure('NOT_VERIFIED', 'Confirm it is you first'));
  const parsed = MarkSchema.safeParse(input.signature);
  if (!parsed.success) {
    return err(
      failure(
        'SIGNATURE',
        input.signature.kind === 'drawn' ? 'Draw your signature again' : 'Type your name to sign',
        ['signature'],
      ),
    );
  }
  const mark = parsed.data;
  const day = signersDay(input.day, at);
  const mine = env.fields.filter((f) => f.signerId === signerId);
  const filled = new Map<string, string | null>();
  for (const f of mine) {
    const given = input.values[f.id]?.trim() ?? '';
    const value =
      f.kind === 'date'
        ? day
        : f.kind === 'signature' || f.kind === 'initials'
          ? 'signed'
          : f.kind === 'name'
            ? given || s.value.name
            : given || null;
    if (f.required && (value === null || (f.kind === 'checkbox' && value !== 'true'))) {
      return err(failure('FIELDS_MISSING', 'Fill in every field marked for you', [f.id]));
    }
    filled.set(f.id, value === null ? null : value.slice(0, 200));
  }
  let next = withSigner(
    {
      ...env,
      fields: env.fields.map((f) =>
        filled.has(f.id) ? { ...f, value: filled.get(f.id) ?? null } : f,
      ),
    },
    { ...s.value, status: 'signed', signedAt: at, signature: mark },
  );
  const left = remaining(next);
  if (left.length === 0) return ok({ ...next, status: 'completed', completedAt: at });
  // The next order starts once everyone in this one has signed.
  const nowOrder = Math.min(...left.map((x) => x.order));
  next = {
    ...next,
    signers: next.signers.map((x) =>
      x.order === nowOrder && x.status === 'waiting' ? { ...x, status: 'sent' } : x,
    ),
  };
  return ok(next);
}

/** Signers yet to sign, in order. */
export const remaining = (env: Envelope): Signer[] =>
  env.signers.filter((s) => s.status !== 'signed');

export function decline(
  env: Envelope,
  signerId: string,
  reason: string,
  at: Instant,
): Result<Envelope> {
  const s = turn(env, signerId);
  if (!s.ok) return s;
  const why = reason.trim();
  if (why.length === 0 || why.length > 1000)
    return err(failure('REASON', 'Say why, in up to 1,000 characters', ['reason']));
  return ok({
    ...withSigner(env, { ...s.value, status: 'declined', declineReason: why, signedAt: at }),
    status: 'declined',
  });
}

/** Hand a signer's turn to somebody else (K7, K8), where the sender allowed it. */
export function reassign(
  env: Envelope,
  signerId: string,
  to: { readonly personId: PersonId | null; readonly email: string | null; readonly name: string },
  tokenHash: string,
): Result<Envelope> {
  const alive = open(env);
  if (!alive.ok) return alive;
  const s = signerOf(env, signerId);
  if (!s.ok) return s;
  if (!s.value.allowDelegate)
    return err(failure('NO_DELEGATE', 'The sender did not allow passing this on'));
  if (s.value.status === 'signed' || s.value.status === 'declined')
    return err(failure('DONE', 'They have already answered'));
  if (to.personId === null && to.email === null)
    return err(failure('SIGNERS', 'Somebody to pass it to'));
  return ok(
    withSigner(env, {
      ...s.value,
      personId: to.personId,
      email: to.email,
      name: to.name,
      check: to.personId === null ? 'email_code' : 'login',
      status: s.value.status === 'waiting' ? 'waiting' : 'sent',
      tokenHash,
      codeHash: null,
      codeSentAt: null,
      codeAttempts: 0,
      openedAt: null,
    }),
  );
}

export function voidEnvelope(env: Envelope, reason: string, _at: Instant): Result<Envelope> {
  const alive = open(env);
  if (!alive.ok) return alive;
  const why = reason.trim();
  if (why.length === 0) return err(failure('REASON', 'Say why it is cancelled', ['reason']));
  return ok({ ...env, status: 'voided', voidReason: why.slice(0, 1000) });
}

export const sealed = (env: Envelope, version: number): Envelope => ({
  ...env,
  signedVersion: version,
});
