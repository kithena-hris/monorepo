import { describe, expect, it } from 'vitest';

import { exportAddressOf, scheduleAudienceOf, shareChoiceOf } from './export-address';

const SEGMENT = '0199a3f0-7c1e-7d2a-9b1e-4f6a8c2d1e00';
const SOFIA = '00000000-0000-4000-8000-0000000000fe';

describe('the export page’s address', () => {
  it('reads each value, and a garbled one is its default', () => {
    expect(
      exportAddressOf({
        q: '  salaries for Finance ',
        read: 'model',
        fields: 'given_name,Bad-Key,base_salary',
        asOf: '30 June',
        format: 'docx',
        to: SOFIA,
        send: 'fax',
        hand: '1',
      }),
    ).toEqual({
      q: 'salaries for Finance',
      read: null,
      who: null,
      fields: ['given_name', 'base_salary'],
      asOf: null,
      format: null,
      photos: false,
      reason: null,
      to: SOFIA,
      send: null,
      hand: true,
    });
    expect(exportAddressOf({ to: 'not-an-account' }).to).toBeNull();
  });

  it('is a choice People can build: offered fields only, all of them when none are asked', () => {
    const offered = ['given_name', 'base_salary'];
    expect(
      shareChoiceOf(
        {
          who: 'conditions',
          conditions: JSON.stringify([{ key: 'team', op: 'in', values: ['eng'] }]),
          fields: 'base_salary,not_offered',
          asOf: '2026-06-30',
          reason: 'Budget',
        },
        offered,
        'Everybody whose team is Engineering',
      ),
    ).toEqual({
      format: 'xlsx',
      fields: ['base_salary'],
      asOf: '2026-06-30',
      conditions: [{ key: 'team', op: 'in', values: ['eng'] }],
      match: 'all',
      filter: 'Everybody whose team is Engineering',
      reason: 'Budget',
    });
    expect(shareChoiceOf({ who: `segment:${SEGMENT}` }, offered, undefined)).toEqual({
      format: 'xlsx',
      fields: offered,
      segmentId: SEGMENT,
    });
  });

  it('is a schedule only where a schedule can say who: a view, everybody, or one value per field', () => {
    expect(scheduleAudienceOf({ format: 'xlsx', fields: ['a'], segmentId: SEGMENT })).toEqual({
      segmentId: SEGMENT,
      filter: [],
    });
    expect(
      scheduleAudienceOf({
        format: 'xlsx',
        fields: ['a'],
        conditions: [{ key: 'team', op: 'in', values: ['eng'] }],
        match: 'all',
      }),
    ).toEqual({ segmentId: null, filter: [{ key: 'team', value: 'eng' }] });
    expect(
      scheduleAudienceOf({
        format: 'xlsx',
        fields: ['a'],
        conditions: [{ key: 'hire_date', op: 'after', values: ['2026-01-01'] }],
      }),
    ).toBeNull();
  });
});
