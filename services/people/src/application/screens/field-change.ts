import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import { currentValue, valueAsOf } from '../../domain/person/history.js';
import {
  actionsFor,
  dateOrderOf,
  decide,
  defaultAction,
  needsReview,
  type DateOrder,
  type Decision,
  type ReviewAction,
} from '../../domain/schema/retype.js';
import { coerceCell, fromMinor } from '../import/cells.js';
import { asSchemaChange, type Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { NOBODY, nameOf, tenantToday, type Tx } from './record.js';
import { emailAll, recordOne, type Recorded } from './requests.js';
import {
  applyRequiredFrom,
  asAdmin,
  pendingOf,
  publishRequest,
  toReview,
  type SchemaScreenDeps,
} from './schema.js';

/**
 * Changing a field that already holds values (Settings › Employee fields ›
 * a field › Change): every value read again as the new type, with nothing
 * written, and then — once HR has decided what happens to each value that
 * does not fit — published in one transaction with the new version.
 *
 * A value is converted by the import's own coercion (`coerceCell`), so the
 * review and the import cannot disagree about what "12/03/2024" is.
 */

/* --------------------------------------------------------- converting -- */

const optionsOf = (d: AttributeDefinition) =>
  d.typeConfig.kind === 'select' || d.typeConfig.kind === 'multi_select'
    ? d.typeConfig.options
    : [];

/** A value as text in the words of the type it was written as: what the new type reads. */
export function textOf(value: unknown, from: AttributeDefinition): string | null {
  if (value === null || value === undefined || value === '') return null;
  const label = (v: unknown) =>
    optionsOf(from).find((o) => o.value === v)?.label.default ?? String(v);
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === 'string' ? label(v) : JSON.stringify(v)));
    return items.length === 0 ? null : items.join('; ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return label(value);
  if (typeof value === 'number') return String(value);
  const money = value as { amountMinor?: unknown; currency?: unknown };
  if (typeof money.amountMinor === 'number' && typeof money.currency === 'string') {
    return `${money.currency} ${fromMinor(money.amountMinor, money.currency)}`;
  }
  return JSON.stringify(value);
}

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A converted value as HR reads it on the review: "12 Mar 2024", an option's label. */
function shown(value: unknown, to: AttributeDefinition): string {
  if (to.typeConfig.kind === 'date' && typeof value === 'string') {
    return DAY.format(new Date(`${value}T00:00:00Z`));
  }
  return textOf(value, to) ?? '';
}

const NOT_A: Partial<Record<string, string>> = {
  date: 'Not a date',
  number: 'Not a number',
  decimal: 'Not a number',
  percentage: 'Not a number',
  duration: 'Not a number',
  money: 'Not an amount with its currency, like EUR 1200.50',
  email: 'Not an email address',
  url: 'Not a web address',
  boolean: 'Not a yes or a no',
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why `text` does not fit `to`, in words, never repeating the value it was given. */
function reasonOf(to: AttributeDefinition, text: string, message: string): string {
  const config = to.typeConfig;
  if (config.kind === 'select' || config.kind === 'multi_select') {
    const retired = config.options.find(
      (o) =>
        o.retiredAt !== null &&
        text.split(/\s*;\s*/u).some((t) => t.toLowerCase() === o.label.default.toLowerCase()),
    );
    return retired === undefined
      ? `“${text}” isn’t one of the options`
      : `${retired.label.default} is no longer an option`;
  }
  if (config.kind === 'date' && /^\d/u.test(text) && !message.includes('is not a valid')) {
    return 'Not a calendar date';
  }
  if ((config.kind === 'number' || config.kind === 'percentage') && /^-?\d+\.\d+$/u.test(text)) {
    return config.decimals === 0
      ? 'A whole number, without decimals'
      : `At most ${String(config.decimals)} decimals`;
  }
  if (config.kind === 'decimal' && /^-?\d+\.\d+$/u.test(text)) {
    return `At most ${String(config.decimals)} decimals`;
  }
  if (message.includes('is not a valid')) return NOT_A[config.kind] ?? `Not a valid ${to.dataType}`;
  // `"text": why`, from the value's own schema: the why, without the value.
  const why = message.replace(/^".*":\s*/su, '');
  return NOT_A[config.kind] !== undefined && /invalid/iu.test(why)
    ? (NOT_A[config.kind] as string)
    : capital(why);
}

export interface Held {
  readonly personId: string;
  readonly name: string;
  /** The value as it is written now, of the old type. */
  readonly value: unknown;
}

export interface Converted {
  readonly personId: string;
  readonly name: string;
  readonly before: string;
  /** The value as the new type. */
  readonly value: unknown;
  readonly after: string;
}

export interface Unfit {
  readonly personId: string;
  readonly name: string;
  readonly before: string;
  readonly reason: string;
}

export interface ValueReview {
  /** How dates were read, when the new type is a date and a value was typed as one. */
  readonly dateOrder: DateOrder | null;
  /** Values that convert to something different: each one is written, as a correction. */
  readonly converted: readonly Converted[];
  /** Values the new type holds as they are: nothing is written for them. */
  readonly unchanged: number;
  readonly unfit: readonly Unfit[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every held value read as `to`. Pure: the caller reads the values (and
 * opens any sealed one) and writes nothing until HR has decided.
 */
export function reviewValues(
  held: readonly Held[],
  from: AttributeDefinition,
  to: AttributeDefinition,
  today: string,
): ValueReview {
  const texts = held.map((h) => ({ ...h, before: textOf(h.value, from) }));
  const dateOrder =
    to.typeConfig.kind === 'date'
      ? dateOrderOf(texts.flatMap((t) => (t.before === null ? [] : [t.before])))
      : null;
  const converted: Converted[] = [];
  const unfit: Unfit[] = [];
  let unchanged = 0;
  for (const t of texts) {
    if (t.before === null) continue;
    // Read as it was written: a value that already is the new type is not re-parsed.
    const raw = typeof t.value === 'string' && from.dataType === to.dataType ? t.value : t.before;
    const coerced = coerceCell(to, raw.trim(), { today, dateOrder: dateOrder ?? 'dmy' });
    if (!coerced.ok) {
      unfit.push({
        personId: t.personId,
        name: t.name,
        before: t.before,
        reason: reasonOf(to, t.before, coerced.error.message),
      });
    } else if (same(coerced.value, t.value)) {
      unchanged += 1;
    } else {
      converted.push({
        personId: t.personId,
        name: t.name,
        before: t.before,
        value: coerced.value,
        after: shown(coerced.value, to),
      });
    }
  }
  return { dateOrder, converted, unchanged, unfit };
}

/* ------------------------------------------------------------ the page -- */

/** At most this many conversions are shown as examples; all of them are written. */
const SAMPLES = 5;
const PAGE = 500;

export interface FieldChangeView {
  readonly field: {
    readonly key: string;
    readonly label: string;
    readonly from: string;
    readonly to: string;
    /** What an edit is written as: the new type's options, and money's currency. */
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly currency: string | null;
    readonly encrypted: boolean;
  };
  /** Whether the change could make a value stop fitting; false publishes it as it is. */
  readonly needsReview: boolean;
  /** People holding a value. */
  readonly withValue: number;
  readonly dateOrder: DateOrder | null;
  readonly converted: {
    readonly count: number;
    readonly samples: readonly { readonly before: string; readonly after: string }[];
  };
  readonly unchanged: number;
  readonly unfit: readonly Unfit[];
  readonly actions: readonly ReviewAction[];
  readonly defaultAction: ReviewAction;
  /**
   * The values are kept from this administrator (sealed, or a field only HR
   * reads): counted and converted, shown masked.
   */
  readonly hidden: boolean;
  /** Other unpublished changes that publish with this one. */
  readonly alsoPublished: number;
  /** Another field whose values have to be reviewed first, by label; null for none. */
  readonly blockedBy: string | null;
}

interface Loaded {
  readonly was: AttributeDefinition;
  readonly to: AttributeDefinition;
  readonly review: ValueReview;
  readonly withValue: number;
  readonly hidden: boolean;
  readonly alsoPublished: number;
  readonly blockedBy: string | null;
  readonly today: string;
}

const mask = (text: string) => `•••• ${text.slice(-4)}`;

/** The field as published and as the draft holds it, and every value read as the draft's type. */
async function load(
  deps: SchemaScreenDeps,
  tx: Tx,
  asking: Asking,
  key: string,
  to: string | null,
): Promise<Result<Loaded>> {
  const [draft, published] = await Promise.all([
    deps.schema.loadDraft(tx, asking.tenantId),
    deps.schema.currentVersion(tx, asking.tenantId),
  ]);
  const next = draft.attributes.find((a) => a.key === key && a.deprecatedAt === null);
  const was = published?.document.attributes.find((a) => a.key === key);
  if (next === undefined || was === undefined) {
    return err(failure('ATTRIBUTE_UNKNOWN', `No published field called ${key}`, ['key']));
  }
  if (to !== null && to !== next.dataType) {
    return err(
      failure(
        'VALUE_INVALID',
        `${next.label.default} is a ${next.dataType} in the draft, not a ${to}: change its type in the field editor`,
        ['to'],
      ),
    );
  }
  const records = deps.records;
  if (records === undefined) {
    return err(failure('UNAVAILABLE', 'Reading every value is not available here'));
  }
  const others = toReview(draft.attributes, published).filter((a) => a.key !== key);
  const today = await tenantToday(deps, tx, asking.tenantId);
  const held: Held[] = [];
  // ponytail: every record in memory, a page at a time; a tenant of tens of
  // thousands wants this as a background job with its result stored.
  for (let after: string | null = null; ;) {
    const page = await records.page(tx, asking.tenantId, after, PAGE);
    for (const r of page) {
      let value = r.values[key];
      // Opened only to be converted, in memory: never kept, logged or shown.
      if (was.encrypted && value !== undefined && value !== null && deps.reveal !== undefined) {
        value = await deps.reveal(tx, {
          tenantId: asking.tenantId,
          personId: r.snapshot.id,
          attributeKey: key,
        });
      }
      if (value === undefined || value === null || value === '') continue;
      held.push({ personId: r.snapshot.id, name: nameOf(r.values) ?? 'Someone', value });
    }
    if (page.length < PAGE) break;
    after = page.at(-1)?.snapshot.id ?? null;
  }
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  // Compared as the registry compares them: key order is not a difference.
  const alsoPublished = draft.attributes.filter(
    (a) => a.key !== key && pendingOf(a, published) !== null,
  ).length;
  return ok({
    was,
    to: next,
    review: reviewValues(held, was, next, today),
    withValue: held.length,
    hidden: was.encrypted || next.encrypted || !visibleTo(was, everyone),
    alsoPublished,
    blockedBy: others[0]?.label.default ?? null,
    today,
  });
}

/** The review page: every value checked against the field's new type, and nothing written. */
export async function fieldChangeView(
  deps: SchemaScreenDeps,
  asking: Asking,
  key: string,
  to: string | null,
): Promise<Result<FieldChangeView>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const loaded = await load(deps, tx, asking, key, to);
      if (!loaded.ok) return loaded;
      const { was, to: next, review, hidden } = loaded.value;
      const shownAs = (text: string) => (hidden ? mask(text) : text);
      const config = next.typeConfig;
      return ok({
        field: {
          key,
          label: next.label.default,
          from: was.dataType,
          to: next.dataType,
          options:
            config.kind === 'select' || config.kind === 'multi_select'
              ? config.options
                  .filter((o) => o.retiredAt === null)
                  .map((o) => ({ value: o.value, label: o.label.default }))
              : [],
          currency: config.kind === 'money' ? config.currency : null,
          encrypted: next.encrypted,
        },
        needsReview: needsReview(was, next),
        withValue: loaded.value.withValue,
        dateOrder: review.dateOrder,
        converted: {
          count: review.converted.length,
          samples: review.converted
            .slice(0, SAMPLES)
            .map((c) => ({ before: shownAs(c.before), after: hidden ? '••••' : c.after })),
        },
        unchanged: review.unchanged,
        unfit: review.unfit.map((u) => ({
          ...u,
          before: shownAs(u.before),
          // A reason that quotes the value quotes it masked.
          reason: hidden ? u.reason.replace(u.before, mask(u.before)) : u.reason,
        })),
        actions: actionsFor(next),
        defaultAction: defaultAction(next),
        hidden,
        alsoPublished: loaded.value.alsoPublished,
        blockedBy: loaded.value.blockedBy,
      });
    }),
  );
}

/* ---------------------------------------------------------- publishing -- */

export interface FieldChangeInput {
  readonly decisions: readonly Decision[];
  /** When a field this publish newly requires is required from (§6.5); today when absent. */
  readonly requiredFrom?: string | undefined;
}

export interface FieldChangeApplied {
  readonly version: number;
  readonly converted: number;
  readonly edited: number;
  readonly cleared: number;
  /** Asked of the employee: one request each, emailed after the commit. */
  readonly requested: number;
  /** Cleared and HR's to fill in, from Data health. */
  readonly forHr: number;
  /** Cleared, and nobody asked: this administrator may not ask that person. */
  readonly notAsked: number;
  readonly emailed: number;
}

const WORDS: Record<Exclude<ReviewAction, 'edit'>, string> = {
  clear: 'removed',
  request: 'asked of the employee',
  hr: 'left for HR to fill in',
  leave: 'left empty',
};

/**
 * Publish the draft with this field's new type, and every value it holds
 * with it, in one transaction: the new version; each value that converts,
 * as a correction carrying `supersedes` (history keeps what it was); each
 * edit HR typed; each value cleared, by a correction to nothing, so the old
 * value stays in history; and a request to each employee asked for theirs.
 * Anything refused refuses the lot, and the draft is as it was.
 *
 * A correction takes effect when the value it corrects did, as every
 * correction does: the date was always a date, written as text. Dated from
 * the publish instead, the record would hold nothing at all before it.
 */
export async function applyFieldChange(
  deps: SchemaScreenDeps,
  asking: Asking,
  key: string,
  to: string | null,
  input: FieldChangeInput,
): Promise<Result<FieldChangeApplied>> {
  const now = deps.clock.now();
  const done = await run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const loaded = await load(deps, tx, asking, key, to);
      if (!loaded.ok) return loaded;
      const { to: next, review, blockedBy, today } = loaded.value;
      if (blockedBy !== null) {
        return err(
          failure(
            'VALUES_NEED_REVIEW',
            `${blockedBy} changes type or format too: review its values first`,
            [key],
          ),
        );
      }
      const decided = decide(next, review.unfit, input.decisions);
      if (!decided.ok) return decided;

      await applyRequiredFrom(deps, tx, asking.tenantId, input.requiredFrom ?? today);
      const current = await deps.schema.currentVersion(tx, asking.tenantId);
      const published = await deps.publisher.publish(
        tx,
        publishRequest(deps, asking, (current?.version ?? 0) + 1),
      );
      if (!published.ok) return published;

      const changing = asSchemaChange(asking);
      const access = deps.service.access;
      const label = next.label.default;
      const write = async (
        personId: string,
        value: unknown,
        why: string,
      ): Promise<Result<void>> => {
        const on = { ...changing, personId };
        if (!next.encrypted) {
          const history = await access.history(tx, { ...on, attributeKey: key });
          if (!history.ok) return history;
          const entry = next.effectiveDated
            ? valueAsOf(history.value, key, today)
            : currentValue(history.value, key);
          if (entry !== undefined) {
            const fixed = await access.correct(tx, {
              ...on,
              supersedes: entry.id,
              value,
              reason: `${label} changed type: ${why}`,
            });
            return fixed.ok ? ok(undefined) : fixed;
          }
        }
        // Sealed, or never written through history: the value is written anew.
        const updated = await access.update(tx, { ...on, changes: { [key]: value } });
        return updated.ok ? ok(undefined) : updated;
      };
      const named = new Map(
        [...review.converted, ...review.unfit].map((v) => [v.personId, v.name]),
      );
      const refused = (personId: string, e: { code: string; message: string }) =>
        err(failure(e.code, `${named.get(personId) ?? 'Someone'}: ${e.message}`, [personId]));

      for (const c of review.converted) {
        const wrote = await write(c.personId, c.value, 'converted');
        if (!wrote.ok) return refused(c.personId, wrote.error);
      }
      const counts = { edited: 0, cleared: 0, requested: 0, forHr: 0, notAsked: 0 };
      const asked: Recorded[] = [];
      for (const d of decided.value) {
        let value = d.value;
        // Typed into a form: read as the import reads a cell, so "42" is a number.
        if (typeof value === 'string') {
          const typed = coerceCell(next, value.trim(), { today, dateOrder: 'iso' });
          if (!typed.ok) return refused(d.personId, typed.error);
          value = typed.value;
        }
        // A form's money carries its minor units as digits.
        const money = value as { amountMinor?: unknown; currency?: unknown } | null;
        if (typeof money?.amountMinor === 'string') {
          value = { amountMinor: Number(money.amountMinor), currency: money.currency };
        }
        const wrote = await write(
          d.personId,
          value,
          d.action === 'edit'
            ? 'corrected by hand'
            : `the value did not fit, so it was ${WORDS[d.action]}`,
        );
        if (!wrote.ok) return refused(d.personId, wrote.error);
        if (d.action === 'edit') counts.edited += 1;
        else counts.cleared += 1;
        if (d.action === 'hr') counts.forHr += 1;
        if (d.action === 'request') {
          // One request per person, as their profile's "Ask them for it" makes it.
          const one = await recordOne(deps, tx, asking, d.personId, [key], now);
          if (one.ok) {
            asked.push(one.value);
            counts.requested += 1;
          } else counts.notAsked += 1;
        }
      }
      const company =
        asked.length === 0 || deps.requests?.company === undefined
          ? null
          : await deps.requests.company(tx, asking.tenantId);
      return ok({
        version: published.value.version.version,
        converted: review.converted.length,
        ...counts,
        asked,
        company,
      });
    }),
  );
  if (!done.ok) return done;
  const { asked, company, ...applied } = done.value;
  const emailed = await emailAll(deps, asking.tenantId, company, asked, now);
  return ok({ ...applied, emailed });
}
