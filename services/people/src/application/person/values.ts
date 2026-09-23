import * as z from 'zod';
import { CountryCode, Money, PostalAddress, type AttributeDefinition } from '@kithena/contracts';

/**
 * What a value of each attribute may be, as Zod.
 *
 * One definition, three consumers: the write path validates against it, the
 * published schema artifact is `z.toJSONSchema` of it, and the OpenAPI
 * document embeds that. A derived artifact is never hand-written, so there is
 * no second description of "a select holds one of its option values" to drift.
 *
 * Refinements (a date's range, a time zone's existence) are enforced on write
 * and do not survive into JSON Schema, which cannot express them. That is the
 * honest direction to lose information in: the artifact is looser than the
 * API, never stricter.
 */

const SHAPES = {
  any: null,
  alphanumeric: /^[A-Za-z0-9]*$/,
  digits: /^\d*$/,
  uppercase_alphanumeric: /^[A-Z0-9]*$/,
} as const;

function decimalsOf(n: number): number {
  const [, fraction = ''] = String(n).split('.');
  return fraction.length;
}

function inRange(value: string, range: 'any' | 'past' | 'future', today: string): boolean {
  const day = value.slice(0, 10);
  if (range === 'past') return day <= today;
  if (range === 'future') return day >= today;
  return true;
}

function isTimeZone(value: string): boolean {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}

/** One value, before cardinality. `today` is the tenant's civil date, for a date's range. */
function scalarFor(definition: AttributeDefinition, today: string): z.ZodType {
  const config = definition.typeConfig;

  switch (config.kind) {
    case 'text': {
      const shape = SHAPES[config.pattern];
      const text = z.string().max(config.maxLength);
      return shape ? text.regex(shape) : text;
    }
    case 'long_text':
      return z.string().max(config.maxLength);
    case 'number':
    case 'percentage':
    case 'duration': {
      let n = z.number();
      if (config.min !== null) n = n.min(config.min);
      if (config.max !== null) n = n.max(config.max);
      return config.decimals === 0
        ? n.int()
        : n.refine(
            (v) => decimalsOf(v) <= config.decimals,
            `at most ${String(config.decimals)} decimals`,
          );
    }
    case 'decimal':
      // A string, so 0.1 stays 0.1. The same reason money is never a float.
      return z
        .string()
        .regex(
          config.decimals === 0
            ? /^-?\d+$/
            : new RegExp(`^-?\\d+(\\.\\d{1,${String(config.decimals)}})?$`),
        );
    case 'money': {
      let amount = z.int();
      if (config.minMinor !== null) amount = amount.min(config.minMinor);
      if (config.maxMinor !== null) amount = amount.max(config.maxMinor);
      return Money.extend({
        amountMinor: amount,
        currency:
          config.currency === null ? z.string().regex(/^[A-Z]{3}$/) : z.literal(config.currency),
      });
    }
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.iso.date().refine((v) => inRange(v, config.range, today), `must be ${config.range}`);
    case 'datetime':
      return z.iso
        .datetime({ offset: true })
        .refine((v) => inRange(v, config.range, today), `must be ${config.range}`);
    case 'select': {
      // Retired options stay on the records that hold them and are refused on
      // a new answer, which is what "retired" means.
      const live = config.options.filter((o) => o.retiredAt === null).map((o) => o.value as string);
      return z.enum(live as [string, ...string[]]);
    }
    case 'multi_select': {
      const live = config.options.filter((o) => o.retiredAt === null).map((o) => o.value as string);
      const list = z.array(z.enum(live as [string, ...string[]]));
      return config.maxSelections === null ? list : list.max(config.maxSelections);
    }
    case 'tags':
      return z.array(z.string().min(1).max(64)).max(config.maxTags);
    case 'email':
      return z.email();
    case 'phone':
      return z.string().regex(/^\+[1-9]\d{6,14}$/, 'an international number, +country code first');
    case 'url':
      return z.url();
    case 'country':
      return CountryCode;
    case 'currency':
      return z.string().regex(/^[A-Z]{3}$/);
    case 'language':
      return z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
    case 'time_zone':
      return z.string().refine(isTimeZone, 'not a time zone');
    case 'address':
      return PostalAddress;
    case 'national_id':
    case 'bank_account':
      // The country's own rule is a later ticket; the shape is a non-empty
      // string, and it is stored sealed rather than in `custom`.
      return z.string().trim().min(1).max(64);
    case 'person_ref':
    case 'org_unit_ref':
    case 'legal_entity_ref':
      return z.uuid();
    case 'document_ref':
    case 'image':
      return z.string().min(1).max(512);
  }
}

export function valueSchemaFor(definition: AttributeDefinition, today: string): z.ZodType {
  const scalar = scalarFor(definition, today);
  return definition.cardinality === 'repeating' ? z.array(scalar) : scalar;
}
