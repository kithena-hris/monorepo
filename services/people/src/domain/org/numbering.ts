import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Employee numbering per legal entity (PRD §7, §9.4; PEO-101).
 *
 * A scheme is a prefix and a minimum width: `ES-` and 5 write `ES-00042`, and
 * grow past the width rather than wrapping (`ES-123456`). The sequence itself
 * lives in the database, one row per entity, so allocating is a row lock and
 * an increment inside the hire's own transaction — gap-free because a hire
 * that rolls back rolls its number back with it, which a Postgres sequence
 * would not.
 *
 * The same format is what an imported or typed number is held to: a number
 * that the scheme would not have written is refused, so the two sources
 * cannot drift into two styles in one register.
 */

export interface NumberingScheme {
  readonly prefix: string;
  /** Minimum digits; the sequence is zero-padded to this. */
  readonly digits: number;
}

export interface SchemeInput extends NumberingScheme {
  /** The first number this scheme hands out. */
  readonly start: number;
}

/** Letters, digits and hyphens, up to ten: what survives a CSV and a spreadsheet. */
const PREFIX = /^[A-Za-z0-9-]{0,10}$/u;
const MAX_DIGITS = 12;

const invalid = (message: string, field: string) =>
  err(failure('NUMBERING_INVALID', message, [field]));

export function checkScheme(input: SchemeInput): Result<SchemeInput> {
  if (!PREFIX.test(input.prefix)) {
    return invalid('A prefix is up to ten letters, digits or hyphens', 'prefix');
  }
  if (!Number.isInteger(input.digits) || input.digits < 1 || input.digits > MAX_DIGITS) {
    return invalid(`Digits is a whole number from 1 to ${String(MAX_DIGITS)}`, 'digits');
  }
  if (!Number.isSafeInteger(input.start) || input.start < 1) {
    return invalid('The sequence starts at a whole number of 1 or more', 'start');
  }
  if (String(input.start).length > input.digits) {
    return invalid(
      `A start of ${String(input.start)} does not fit ${String(input.digits)} digits`,
      'start',
    );
  }
  return ok({ prefix: input.prefix, digits: input.digits, start: input.start });
}

export function formatNumber(scheme: NumberingScheme, sequence: number): string {
  return `${scheme.prefix}${String(sequence).padStart(scheme.digits, '0')}`;
}

/**
 * The sequence a number stands for, or null when the scheme would never have
 * written it — another prefix, too few digits, a padding it would not add.
 */
export function sequenceOf(scheme: NumberingScheme, text: string): number | null {
  if (!text.startsWith(scheme.prefix)) return null;
  const digits = text.slice(scheme.prefix.length);
  if (!/^\d+$/u.test(digits)) return null;
  const sequence = Number(digits);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return formatNumber(scheme, sequence) === text ? sequence : null;
}
