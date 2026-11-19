import { describe, expect, it } from 'vitest';

import { toPick } from './pick.js';

const m = (
  personId: string,
  displayName: string,
  teamName: string | null,
  workEmail: string | null,
) => ({
  personId,
  displayName,
  teamName,
  workEmail,
});

describe('people to pick from by name', () => {
  it('says nothing more of a name only one person has', () => {
    expect(toPick([m('1', 'Ada Lovelace', 'Engineering', 'ada@acme.example')])).toEqual([
      { personId: '1', name: 'Ada Lovelace' },
    ]);
  });

  it('tells two of the same name apart by department', () => {
    expect(
      toPick([
        m('1', 'Aaliyah Brown', 'Sales', 'a1@acme.example'),
        m('2', 'Aaliyah Brown', 'Finance', 'a2@acme.example'),
        m('3', 'Ada Lovelace', 'Sales', 'ada@acme.example'),
      ]),
    ).toEqual([
      { personId: '1', name: 'Aaliyah Brown', hint: 'Sales' },
      { personId: '2', name: 'Aaliyah Brown', hint: 'Finance' },
      { personId: '3', name: 'Ada Lovelace' },
    ]);
  });

  it('and by their email when the department is the same or not known', () => {
    expect(
      toPick([
        m('1', 'Aaliyah Brown', 'Sales', 'a1@acme.example'),
        m('2', 'Aaliyah Brown', 'Sales', 'a2@acme.example'),
        m('3', 'Aaliyah Brown', 'Finance', 'a3@acme.example'),
        m('4', 'Aaliyah Brown', null, 'a4@acme.example'),
      ]).map((p) => p.hint),
    ).toEqual(['a1@acme.example', 'a2@acme.example', 'Finance', 'a4@acme.example']);
  });

  it('says nothing when nothing known differs', () => {
    expect(toPick([m('1', 'A B', null, null), m('2', 'A B', null, null)])).toEqual([
      { personId: '1', name: 'A B' },
      { personId: '2', name: 'A B' },
    ]);
  });
});
