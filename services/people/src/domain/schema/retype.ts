import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { ownerByRules, type Owner } from '../import/who-fills.js';

/**
 * Changing a field that already holds values: a text becoming a date, a
 * number losing its decimals, an option retired.
 *
 * Nothing here converts a value; that is the import's coercion, reused, so
 * a value the import would refuse is refused here too. What is decided here
 * is which changes need every value looked at before they are published,
 * how a column of typed dates is read, and what happens to each value that
 * does not fit the new type.
 */

/** How dates were typed (the import's `DateOrder`). */
export type DateOrder = 'iso' | 'dmy' | 'mdy';

/**
 * What HR chose for a value that does not fit: write one that does, clear it,
 * ask the employee for it, fill it in later from Data health, or leave it
 * empty. Every one but `edit` clears the value, by a correction that keeps
 * the old one in history; they differ in who is asked next.
 */
export type ReviewAction = 'edit' | 'clear' | 'request' | 'hr' | 'leave';

type Typed = Pick<AttributeDefinition, 'dataType' | 'typeConfig'>;

const optionsOf = (a: Typed) =>
  a.typeConfig.kind === 'select' || a.typeConfig.kind === 'multi_select'
    ? a.typeConfig.options
    : [];

/**
 * Whether publishing `now` over `was` needs every value checked first: a new
 * type, an option a value may hold no longer offered, or any other format
 * setting (decimals, a currency, a shape). A new option or a new label does
 * not; nothing already written can stop fitting because of it.
 */
export function needsReview(was: Typed | undefined, now: Typed): boolean {
  if (was === undefined) return false;
  if (was.dataType !== now.dataType) return true;
  const live = new Set(optionsOf(now).flatMap((o) => (o.retiredAt === null ? [o.value] : [])));
  if (optionsOf(was).some((o) => o.retiredAt === null && !live.has(o.value))) return true;
  const rest = (a: Typed): string => {
    const { options: _options, ...config } = a.typeConfig as Typed['typeConfig'] & {
      options?: unknown;
    };
    return JSON.stringify(Object.entries(config).toSorted(([x], [y]) => x.localeCompare(y)));
  };
  return rest(was) !== rest(now);
}

const SLASHED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u;

/**
 * Which way round a column of typed dates is written. A first number above
 * 12 can only be a day, and so can a second; the side with more of those
 * wins, and a column that never says reads day first, as the import's
 * "dates, dd/mm/yyyy" does. A date the order then misreads is not guessed:
 * it fails to convert and is listed for review.
 */
export function dateOrderOf(texts: readonly string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  let slashed = 0;
  for (const text of texts) {
    const parts = SLASHED.exec(text.trim());
    if (parts === null) continue;
    slashed += 1;
    if (Number(parts[1]) > 12) dayFirst += 1;
    if (Number(parts[2]) > 12) monthFirst += 1;
  }
  if (slashed === 0) return 'iso';
  return monthFirst > dayFirst ? 'mdy' : 'dmy';
}

/** What HR may do with a value that does not fit, in the order a screen offers them. */
export function actionsFor(definition: Pick<AttributeDefinition, 'ownership'>): ReviewAction[] {
  return [
    'edit',
    'clear',
    // Only somebody who fills it in can be asked, or be given it to fill.
    ...(definition.ownership.includes('employee') ? (['request'] as const) : []),
    ...(definition.ownership.includes('hr') ? (['hr'] as const) : []),
    'leave',
  ];
}

/** What the field needs to be placed by the rules for who fills it in. */
export type Placed = Pick<AttributeDefinition, 'key' | 'label' | 'ownership' | 'classification'>;

const BY_OWNER: Record<Owner, ReviewAction> = { employee: 'request', hr: 'hr', leave: 'leave' };

/**
 * The default for a value nobody decided on, by the import's rules for who
 * fills a field in (`who-fills.ts`, one rule table for both): their own
 * details go back to the employee, employment data to HR, notes and anything
 * sensitive are left empty. Never what the field does not offer; a field the
 * rules cannot place goes to the employee if they fill it in, else to HR.
 */
export function defaultAction(definition: Placed, section: string): ReviewAction {
  const offered = actionsFor(definition);
  const ruled = ownerByRules({
    key: definition.key,
    label: definition.label.default,
    section,
    piiKind: definition.classification.piiKind,
    classification: definition.classification.classification,
  });
  const wanted = ruled === null ? null : BY_OWNER[ruled.owner];
  if (wanted !== null && offered.includes(wanted)) return wanted;
  return offered.includes('request') ? 'request' : offered.includes('hr') ? 'hr' : 'leave';
}

export interface Decision {
  readonly personId: string;
  readonly action: ReviewAction;
  /** The new value, of the new type, for `edit`. */
  readonly value?: unknown;
}

export interface Decided {
  readonly personId: string;
  readonly action: ReviewAction;
  /** What is written: the edit, or null for everything that clears. */
  readonly value: unknown;
}

/**
 * One outcome for every value that does not fit: HR's decision where there
 * is one, the default otherwise. A decision about somebody whose value fits
 * now (it was fixed since the review was drawn) is dropped, not refused.
 */
export function decide(
  definition: Placed,
  section: string,
  problems: readonly { readonly personId: string }[],
  decisions: readonly Decision[],
): Result<readonly Decided[]> {
  const offered = actionsFor(definition);
  const fallback = defaultAction(definition, section);
  const byPerson = new Map(decisions.map((d) => [d.personId, d]));
  const out: Decided[] = [];
  for (const { personId } of problems) {
    const d = byPerson.get(personId);
    const action = d?.action ?? fallback;
    if (!offered.includes(action)) {
      return err(
        failure('ACTION_NOT_ALLOWED', `${definition.key} cannot be handled that way: ${action}`, [
          personId,
        ]),
      );
    }
    if (action === 'edit' && (d?.value === undefined || d.value === null || d.value === '')) {
      return err(failure('VALUE_INVALID', 'An edit needs the new value', [personId]));
    }
    out.push({ personId, action, value: action === 'edit' ? d?.value : null });
  }
  return ok(out);
}
