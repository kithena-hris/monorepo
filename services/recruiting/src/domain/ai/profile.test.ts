import { describe, expect, it } from 'vitest';

import { checkProfile, type Profile } from './profile.js';

const text = `Senior product designer at Acme, 2019-03 to 2023-06.
Designer at Globex from 2016-01 until 2019-02.
Skills: Figma, prototyping, user research. Spanish (C1), English (native).`;

const profile: Profile = {
  work: [
    {
      employer: { value: 'Acme', passage: 'Senior product designer at Acme' },
      title: { value: 'Senior product designer', passage: 'Senior product designer' },
      from: { value: '2019-03', passage: '2019-03' },
      to: { value: '2023-06', passage: '2023-06' },
    },
    {
      employer: { value: 'Globex', passage: 'Designer at Globex' },
      title: { value: 'Designer', passage: 'Designer at Globex' },
      from: { value: '2016-01', passage: '2016-01' },
      to: { value: '2019-02', passage: '2019-02' },
    },
  ],
  education: [],
  skills: [
    { value: 'Figma', passage: 'Figma' },
    { value: 'Kubernetes', passage: 'Kubernetes' },
  ],
  languages: [{ value: 'Spanish', level: 'C1', passage: 'Spanish (C1)' }],
  certifications: [],
};

describe('a parsed profile, checked against the text it came from (PRD §14.2)', () => {
  it('keeps what the text says and drops what it does not', () => {
    const { profile: kept, issues } = checkProfile(profile, text, '2026-10-15');
    expect(kept.skills.map((s) => s.value)).toEqual(['Figma']);
    expect(kept.work).toHaveLength(2);
    expect(issues).toContainEqual({ code: 'not_in_text', path: 'skills.1' });
  });

  it('flags dates out of order and in the future, and leaves them for a person', () => {
    const odd: Profile = {
      ...profile,
      work: [
        {
          employer: { value: 'Acme', passage: 'Acme' },
          title: { value: 'Designer', passage: 'Designer' },
          from: { value: '2023-06', passage: '2023-06' },
          to: { value: '2019-03', passage: '2019-03' },
        },
        {
          employer: { value: 'Globex', passage: 'Globex' },
          title: { value: 'Designer', passage: 'Designer' },
          from: { value: '2016-01', passage: '2016-01' },
          to: { value: '2027-01', passage: '2016-01' },
        },
      ],
    };
    const { profile: kept, issues } = checkProfile(odd, text, '2026-10-15');
    expect(issues).toContainEqual({ code: 'dates_out_of_order', path: 'work.0' });
    expect(kept.work[0]?.from.value).toBe('2023-06');
    // A value whose passage is not that value is dropped, not trusted.
    expect(issues).toContainEqual({ code: 'not_in_text', path: 'work.1.to' });
  });

  it('flags an end date after today', () => {
    const later: Profile = {
      ...profile,
      work: [
        {
          employer: { value: 'Acme', passage: 'Acme' },
          title: { value: 'Designer', passage: 'Designer' },
          from: { value: '2019-03', passage: '2019-03' },
          to: { value: '2027-06', passage: 'until 2027-06' },
        },
      ],
    };
    const promised = `${text}\nDesigner at Acme from 2019-03 until 2027-06.`;
    expect(checkProfile(later, promised, '2026-10-15').issues).toContainEqual({
      code: 'end_in_future',
      path: 'work.0',
    });
  });
});
