import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { checkNationalId } from '../../country-packs/national-id.js';
import { valueSchemaFor } from '../person/values.js';

/**
 * One spreadsheet cell to one attribute value, or the reason it cannot be.
 *
 * The same `valueSchemaFor` the write path validates against has the last
 * word, so the dry run and the commit cannot disagree about what is valid —
 * this file only turns text into the shape that schema expects. Where text is
 * ambiguous it is refused rather than guessed: "03/04/2026" is the third of
 * April in Madrid and the fourth of March in Chicago, and a wrong hire date is
 * worse than a blocked row, because nothing shows it as a gap.
 */

/** How a file writes day, month and year when it does not write ISO. */
export type DateOrder = 'iso' | 'dmy' | 'mdy';

export interface CellContext {
  /** The tenant's civil date, for a date's past/future range. */
  readonly today: string;
  readonly dateOrder: DateOrder;
}

/** The masked form an export writes for a sealed value (§15.2). Never a value to import. */
export const MASK = '•';
export const isMasked = (cell: string): boolean => cell.includes(MASK);

const LIST = /\s*[;|]\s*/u;

/* ------------------------------------------------------------------ money -- */

/** A currency's minor-unit exponent: 2 for EUR, 0 for JPY, 3 for BHD. */
export function exponentOf(currency: string): number | null {
  if (!/^[A-Z]{3}$/u.test(currency)) return null;
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? null
    );
  } catch {
    return null;
  }
}

/**
 * "55,000.50" → 5500050 for EUR, exactly: digits are moved, never multiplied.
 *
 * Only an unambiguous amount is accepted — digits, optional comma thousands
 * groups, a dot and at most the currency's number of decimals. "55.000,50" is
 * refused rather than read as fifty-five.
 */
export function toMinor(amount: string, currency: string): number | null {
  const exponent = exponentOf(currency);
  if (exponent === null) return null;
  const match = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/u.exec(amount.replaceAll(' ', ''));
  if (!match) return null;
  const [, sign = '', whole = '', fraction = ''] = match;
  if (fraction.length > exponent) return null;
  const minor = Number(`${sign}${whole.replaceAll(',', '')}${fraction.padEnd(exponent, '0')}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 5500050 EUR → "55000.50". The inverse of `toMinor`, again by moving digits. */
export function fromMinor(minor: number, currency: string): string {
  const exponent = exponentOf(currency) ?? 2;
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  return exponent === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

function money(cell: string, fixed: string | null): unknown {
  const parts = cell.trim().split(/\s+/u);
  let currency = fixed;
  let amount = cell;
  if (parts.length === 2) {
    const [a = '', b = ''] = parts;
    const code = /^[A-Za-z]{3}$/u.test(a) ? a : /^[A-Za-z]{3}$/u.test(b) ? b : null;
    if (code) {
      currency = code.toUpperCase();
      amount = code === a ? b : a;
    }
  }
  if (currency === null) return undefined;
  const amountMinor = toMinor(amount, currency);
  return amountMinor === null ? undefined : { amountMinor, currency };
}

/* ------------------------------------------------------------------ dates -- */

function date(cell: string, order: DateOrder): string | undefined {
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/u.exec(cell);
  if (iso) return iso[1];
  if (order === 'iso') return undefined;
  const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u.exec(cell);
  if (!parts) return undefined;
  const [, first = '', second = '', year = ''] = parts;
  const [day, month] = order === 'dmy' ? [first, second] : [second, first];
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/* ------------------------------------------------------------------- one -- */

function scalar(definition: AttributeDefinition, cell: string, ctx: CellContext): unknown {
  const config = definition.typeConfig;
  switch (config.kind) {
    case 'number':
    case 'percentage':
    case 'duration':
      return /^-?\d+(\.\d+)?$/u.test(cell) ? Number(cell) : undefined;
    case 'money':
      return money(cell, config.currency);
    case 'boolean': {
      const b = cell.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(b)) return true;
      if (['false', 'no', 'n', '0'].includes(b)) return false;
      return undefined;
    }
    case 'date':
      return date(cell, ctx.dateOrder);
    case 'select':
    case 'multi_select': {
      const wanted = cell.toLocaleLowerCase('en');
      const option = config.options.find(
        (o) =>
          (o.value as string).toLocaleLowerCase('en') === wanted ||
          o.label.default.toLocaleLowerCase('en') === wanted,
      );
      return option ? option.value : cell;
    }
    case 'phone':
      return cell.replaceAll(/[\s().-]/gu, '');
    case 'country':
    case 'currency':
      return cell.toUpperCase();
    case 'address':
      try {
        return JSON.parse(cell) as unknown;
      } catch {
        return undefined;
      }
    case 'national_id': {
      const checked = checkNationalId(config.country, config.scheme, cell);
      return checked.ok ? checked.value.normalised : { invalid: checked.error.message };
    }
    default:
      return cell;
  }
}

/**
 * The value for this cell, `null` for an empty one, or why it is invalid.
 *
 * Empty is not invalid. Whether an empty cell matters — blocked for core
 * identity, incomplete for anything else required — is the dry run's call.
 */
export function coerceCell(
  definition: AttributeDefinition,
  cell: string,
  ctx: CellContext,
): Result<unknown> {
  if (cell === '') return ok(null);
  const invalid = (reason: string) => err(failure('VALUE_INVALID', reason, [definition.key]));

  const many =
    definition.cardinality === 'repeating' ||
    definition.typeConfig.kind === 'multi_select' ||
    definition.typeConfig.kind === 'tags';
  const pieces = many ? cell.split(LIST).filter((p) => p !== '') : [cell];
  const values: unknown[] = [];
  for (const piece of pieces) {
    const value = scalar(definition, piece, ctx);
    if (value === undefined) return invalid(`"${piece}" is not a valid ${definition.dataType}`);
    if (typeof value === 'object' && value !== null && 'invalid' in value) {
      return invalid((value as { invalid: string }).invalid);
    }
    values.push(value);
  }

  // A repeating multi-select is out of scope for a flat cell; one level of list only.
  const candidate = many ? values : values[0];
  const parsed = valueSchemaFor(definition, ctx.today).safeParse(candidate);
  if (!parsed.success) {
    return invalid(`"${cell}": ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  return ok(parsed.data);
}

/** A calendar date for a system column (`hire_date`, `effective_from`). */
export function coerceDate(cell: string, order: DateOrder): string | null | undefined {
  if (cell === '') return null;
  const day = date(cell, order);
  if (day === undefined) return undefined;
  // `2026-02-30` has the shape and is not a day.
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day) ? day : undefined;
}
