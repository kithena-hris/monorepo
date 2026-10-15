import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { ResolvedTerms, toPeopleTerms } from '../recruiting/terms.js';
import { recruitingEvents } from './recruiting.js';

/**
 * Recruiting's events (PRD §27). No payload may hold a CV, a note, a message
 * body, an answer or a score explanation; only the hire hands over a name.
 */

function keysOf(schema: z.ZodType, out = new Set<string>()): Set<string> {
  if (schema instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(schema.shape)) {
      out.add(key);
      if (child instanceof z.ZodType) keysOf(child, out);
    }
  } else if (schema instanceof z.ZodArray) {
    if (schema.element instanceof z.ZodType) keysOf(schema.element, out);
  } else if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    for (const option of schema.options) if (option instanceof z.ZodType) keysOf(option, out);
  } else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    const inner = schema.unwrap();
    if (inner instanceof z.ZodType) keysOf(inner, out);
  }
  return out;
}

const FORBIDDEN = /cv|note|body|message|answer|explanation|text|comment|score/iu;
const NAMES = /name|email|phone/iu;

describe('no Recruiting payload can hold what a candidate wrote or what was said of them', () => {
  it.each(recruitingEvents.map((event) => [event.name, event] as const))('%s', (_name, event) => {
    const keys = [...keysOf(event.payload)];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => FORBIDDEN.test(key))).toEqual([]);
    if (event.name !== 'recruiting.candidate.hired') {
      expect(keys.filter((key) => NAMES.test(key))).toEqual([]);
    }
  });

  it('every name is in the recruiting namespace, once', () => {
    const names = recruitingEvents.map((event) => event.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('recruiting.'))).toBe(true);
  });
});

describe('ResolvedTerms maps onto People’s employment terms fields', () => {
  const terms = ResolvedTerms.parse({
    country: 'DE',
    region: 'BE',
    packVersion: 'de-2026.1',
    relationship: 'employee',
    contractType: 'befristet_ohne_sachgrund',
    employmentType: 'fixed_term',
    fixedTermReason: null,
    contractStart: '2026-11-01',
    contractEnd: '2027-10-31',
    workingPattern: 'full_time',
    weeklyMinutes: 2400,
    fte: '1.0',
    probation: { count: 6, unit: 'months' },
    probationEnd: '2027-04-30',
    noticeEmployee: { count: 4, unit: 'weeks' },
    noticeEmployer: { count: 4, unit: 'weeks' },
    workMode: 'hybrid',
    hybridDaysOnsite: 2,
    remoteCountry: null,
    collectiveAgreement: null,
    nonCompeteMonths: null,
    mobilityClause: false,
    paymentsPerYear: 12,
    signature: 'wet_ink',
    documents: ['nachweis'],
    conditions: [],
  });

  it('keeps People’s own keys and values', () => {
    expect(toPeopleTerms(terms)).toEqual({
      employment_type: 'fixed_term',
      contract_start: '2026-11-01',
      contract_end: '2027-10-31',
      probation_end: '2027-04-30',
      working_pattern: 'full_time',
      fte: '1.0',
      notice_period_employee: '4 weeks',
      notice_period_employer: '4 weeks',
      collective_agreement: null,
      work_model: 'hybrid',
      remote_country: null,
      employment_jurisdiction: 'DE-BE',
      non_compete_months: null,
      mobility_clause: false,
    });
  });

  it('refuses an FTE that is not a decimal between 0 and 1', () => {
    expect(ResolvedTerms.safeParse({ ...terms, fte: '1.5' }).success).toBe(false);
    expect(ResolvedTerms.safeParse({ ...terms, fte: '0.8' }).success).toBe(true);
  });
});
