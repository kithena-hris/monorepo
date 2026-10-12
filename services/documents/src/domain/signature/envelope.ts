import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DocumentId, Instant, PersonId } from '@kithena/contracts';

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

export type SignatureMark =
  | { readonly kind: 'typed'; readonly text: string }
  /** Reach's `SignaturePad`: an SVG path in a 400 × 120 box. */
  | { readonly kind: 'drawn'; readonly path: string };

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
}

export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;

/**
 * Kithena places what nobody placed (K2): a signature and the date for each
 * signer on the last page, side by side, one row per signer from the bottom.
 */
export function defaultFields(signerIds: readonly string[], lastPage: number): Field[] {
  return signerIds.flatMap((signerId, i) => {
    const row = Math.floor(i / 2);
    const x = i % 2 === 0 ? 0.08 : 0.54;
    const y = 0.78 - row * 0.12;
    return [
      {
        id: `${signerId}-signature`,
        signerId,
        kind: 'signature',
        page: lastPage,
        x,
        y,
        w: 0.38,
        h: 0.06,
        required: true,
        label: null,
      },
      {
        id: `${signerId}-date`,
        signerId,
        kind: 'date',
        page: lastPage,
        x,
        y: y + 0.065,
        w: 0.2,
        h: 0.03,
        required: true,
        label: null,
      },
    ];
  });
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
    if (!fields.some((f) => f.signerId === s.id && f.kind === 'signature')) {
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

/**
 * Sign: every required field of theirs filled (the date fills itself), the
 * signature adopted, and the turn passes on — to the next in order, or the
 * request completes.
 */
export function sign(
  env: Envelope,
  signerId: string,
  input: { readonly signature: SignatureMark; readonly values: Readonly<Record<string, string>> },
  at: Instant,
): Result<Envelope> {
  const s = turn(env, signerId);
  if (!s.ok) return s;
  if (s.value.status !== 'verified') return err(failure('NOT_VERIFIED', 'Confirm it is you first'));
  const mark = input.signature;
  if (mark.kind === 'typed' && (mark.text.trim().length === 0 || mark.text.length > 120)) {
    return err(failure('SIGNATURE', 'Type your name to sign', ['signature']));
  }
  if (
    mark.kind === 'drawn' &&
    (!/^[ML][\d.\sML-]*$/u.test(mark.path.trim()) || mark.path.length > 40_000)
  ) {
    return err(failure('SIGNATURE', 'Draw your signature again', ['signature']));
  }
  const day = at.slice(0, 10);
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

export function voidEnvelope(env: Envelope, reason: string, at: Instant): Result<Envelope> {
  const alive = open(env);
  if (!alive.ok) return alive;
  const why = reason.trim();
  if (why.length === 0) return err(failure('REASON', 'Say why it is cancelled', ['reason']));
  void at;
  return ok({ ...env, status: 'voided', voidReason: why.slice(0, 1000) });
}

export const sealed = (env: Envelope, version: number): Envelope => ({
  ...env,
  signedVersion: version,
});
