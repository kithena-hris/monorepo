import { describe, expect, it } from 'vitest';

import { recordingJudge, recordingWriter, shown } from '../testing/assist.js';
import { caller, hr, people, TENANT, world } from '../testing/world.js';
import { holidayDraft, readLines } from './holiday-draft.js';

/** Madrid city's 2028 days as HR might paste them from the council's bulletin. */
const BULLETIN = [
  'Fiestas locales de Madrid 2028',
  '15 de mayo — San Isidro',
  'November 9, 2028: La Almudena (provisional)',
  '2028-12-24 | Nochebuena',
  '2027-05-15 San Isidro',
].join('\n');

describe('reading a pasted list', () => {
  it('finds each line’s date in whatever way it was written, and its name', () => {
    expect(readLines(BULLETIN, 2028)).toEqual([
      {
        line: 'Fiestas locales de Madrid 2028',
        date: null,
        name: 'Fiestas locales de Madrid 2028',
        provisional: false,
      },
      {
        line: '15 de mayo — San Isidro',
        date: '2028-05-15',
        name: 'San Isidro',
        provisional: false,
      },
      {
        line: 'November 9, 2028: La Almudena (provisional)',
        date: '2028-11-09',
        name: 'La Almudena',
        provisional: true,
      },
      {
        line: '2028-12-24 | Nochebuena',
        date: '2028-12-24',
        name: 'Nochebuena',
        provisional: false,
      },
      { line: '2027-05-15 San Isidro', date: '2027-05-15', name: 'San Isidro', provisional: false },
    ]);
  });
});

describe('an AI holiday draft (TOF-112)', () => {
  it('drafts the year from the list, marks what is not confirmed, and saves nothing', async () => {
    const app = world();
    const before = JSON.stringify([...app.state(TENANT).layers.values()]);
    const draft = await holidayDraft(app.deps)(hr, {
      year: 2028,
      layerKey: 'madrid',
      source: BULLETIN,
    });
    if (!draft.ok) throw new Error(draft.error.message);
    expect(draft.value).toMatchObject({
      layerKey: 'madrid',
      layerName: 'Madrid city',
      year: 2028,
      days: [
        { date: '2028-05-15', name: 'San Isidro', confirmed: true, known: false },
        { date: '2028-11-09', name: 'La Almudena', confirmed: false, known: false },
        { date: '2028-12-24', name: 'Nochebuena', confirmed: true, known: false },
      ],
      skipped: ['Fiestas locales de Madrid 2028', '2027-05-15 San Isidro'],
      summary: {
        text: 'Read 3 days for Madrid city in 2028 from the list you supplied; 1 is not confirmed yet and stays with you.',
        ai: false,
      },
      ai: false,
    });
    expect(JSON.stringify([...app.state(TENANT).layers.values()])).toBe(before);
  });

  it('lets TypeSafe judge each line and a model write the summary, from the list alone', async () => {
    const app = world();
    const judge = recordingJudge((id) => (id === 'line_2' ? 'not_a_holiday' : 'confirmed'));
    const writer = recordingWriter(() => 'Drafted 2 days for Madrid city in 2028.');
    const draft = await holidayDraft({ ...app.deps, judge, writer })(hr, {
      year: 2028,
      layerKey: 'madrid',
      source: BULLETIN,
    });
    if (!draft.ok) throw new Error(draft.error.message);
    expect(draft.value.ai).toBe(true);
    expect(draft.value.days.map((d) => [d.date, d.confirmed])).toEqual([
      ['2028-05-15', true],
      ['2028-11-09', true],
    ]);
    expect(draft.value.summary).toEqual({
      text: 'Drafted 2 days for Madrid city in 2028.',
      ai: true,
    });
    expect(shown([...judge.asks, ...writer.asks])).not.toContain('Ada');
  });

  it('is HR’s alone, and names a calendar that does not exist', async () => {
    const app = world();
    expect(
      await holidayDraft(app.deps)(caller(people.adam), {
        year: 2028,
        layerKey: 'madrid',
        source: BULLETIN,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await holidayDraft(app.deps)(hr, { year: 2028, layerKey: 'nowhere', source: BULLETIN }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
