import { describe, expect, it } from 'vitest';
import type { ModuleKey, RuntimeCatalogue } from '@kithena/contracts';
import { fixedClock } from '@kithena/domain-kit';

import { todayIn } from './dates.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from './fixtures.js';
import { INSTRUCTION, promptFor } from './instruction.js';
import { mask, maskOffer } from './mask.js';
import { offer } from './plan.js';

/**
 * What the model is shown (assistant PRD §12.1): the masked question, today
 * in words, the capabilities this asker may use with their fields, and the
 * modules the company does not have. Never a value from a record, never a
 * person's id, never a private leave type's word.
 */

const today = todayIn('Europe/Madrid', fixedClock('2026-10-06T10:00:00Z'));

function promptOf(
  question: string,
  catalogues: readonly RuntimeCatalogue[],
  earlier: readonly string[] = [],
) {
  const leaveTypes = catalogues.flatMap((c) => c.leaveTypes);
  const masked = mask(question, leaveTypes, earlier);
  const present = new Set(catalogues.map((c) => c.module));
  const unavailable = (['people', 'timeoff'] as ModuleKey[]).filter((m) => !present.has(m));
  return promptFor({
    question: masked.question,
    earlier: masked.earlier,
    today,
    offer: maskOffer(offer(catalogues), leaveTypes, masked.refs),
    unavailable,
  });
}

const BOTH = [PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE];

/** Every worked example in §7, with the company it is asked in. */
const EXAMPLES: readonly [string, readonly RuntimeCatalogue[]][] = [
  ['How many people are off today?', BOTH],
  ['Who are the managers of people on sick leave today?', BOTH],
  ['Who in Engineering is off next week?', BOTH],
  ['How many people are off today?', [PEOPLE_CATALOGUE]],
  ['Who reports to Michael?', [PEOPLE_CATALOGUE]],
  ['What’s waiting for my approval?', [PEOPLE_CATALOGUE]],
  ['Who are the managers of people on sick leave today?', [TIMEOFF_CATALOGUE]],
  ['Who in Engineering is off next week?', [TIMEOFF_CATALOGUE]],
  ['Who reports to Marco?', [TIMEOFF_CATALOGUE]],
  ['What’s the weather in Madrid?', BOTH],
  ['Who is on sick leave today?', BOTH],
  ['who is off sick or on maternity leave this week?', BOTH],
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

describe('the planner’s prompt', () => {
  it.each(EXAMPLES)('for “%s” holds no value, no person’s id and no private word', (q, cs) => {
    const prompt = promptOf(q, cs);
    const text = JSON.stringify(prompt);
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/\b(sick|ill|baja|médica|parental|maternity|paternity)\b/iu);
    // Field names and options are configuration; no record's value is in a catalogue to leak.
    expect(text).not.toMatch(/Marco Ruiz|Ada Lovelace/u);
  });

  it('gives the model the masked question, today in words, and what it may plan with', () => {
    const prompt = promptOf('Who are the managers of people on sick leave today?', BOTH);
    expect(prompt.instruction).toBe(INSTRUCTION);
    expect(prompt.context['question']).toBe('Who are the managers of people on L1 today?');
    expect(prompt.context['today']).toBe('Tuesday 6 October 2026');
    expect(prompt.context['days']).toMatchObject({ Friday: '2026-10-09', Tuesday: '2026-10-13' });
    const capabilities = prompt.context['capabilities'] as { capability: string }[];
    expect(capabilities.map((c) => c.capability)).toEqual([
      'people.find',
      'people.person',
      'people.reports',
      'people.managers',
      'people.approvals',
      'timeoff.away',
    ]);
    const away = JSON.stringify(capabilities.find((c) => c.capability === 'timeoff.away'));
    expect(away).toContain('"value":"L1","label":"a leave type named in the question"');
    expect(away).toContain('People away on leave on a date or over a range.');
    expect(prompt.context['unavailable']).toEqual([]);
  });

  it('says in one line what each missing module would have done', () => {
    const prompt = promptOf('How many people are off today?', [PEOPLE_CATALOGUE]);
    expect(prompt.context['unavailable']).toEqual([
      { module: 'timeoff', about: 'Time Off: who is away, when, and on what kind of leave.' },
    ]);
  });

  it('says the date is UTC when the asker has no zone', () => {
    const utc = todayIn(null, fixedClock('2026-10-06T10:00:00Z'));
    const prompt = promptFor({
      question: 'Who is off?',
      today: utc,
      offer: offer(BOTH),
      unavailable: [],
    });
    expect(prompt.context['today']).toBe('Tuesday 6 October 2026, in UTC');
  });

  it('gives earlier questions, masked, for a follow-up, and nothing when there are none', () => {
    const prompt = promptOf('And tomorrow?', BOTH, ['Who is on sick leave today?']);
    expect(prompt.context['question']).toBe('And tomorrow?');
    expect(prompt.context['earlier']).toEqual(['Who is on L1 today?']);
    expect(JSON.stringify(prompt)).not.toMatch(/\bsick\b/iu);
    expect(INSTRUCTION).toMatch(/"earlier".*"and tomorrow\?"/u);
    expect(promptOf('Who is off today?', BOTH).context).not.toHaveProperty('earlier');
  });

  it('tells the model what "on leave" means, and that it writes no number in say', () => {
    expect(INSTRUCTION).toMatch(/employment status, not who is away/u);
    expect(INSTRUCTION).toMatch(/never write a number/u);
    expect(INSTRUCTION).toMatch(/"@me"/u);
  });
});
