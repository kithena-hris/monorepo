import { describe, expect, it } from 'vitest';

import {
  debrief,
  decideDebrief,
  moveInterview,
  scorecardsOwed,
  submitScorecard,
  visibleScorecards,
  type Interview,
  type Scorecard,
} from './interview.js';

const interview: Interview = {
  id: 'i1',
  applicationId: 'a1',
  planKey: 'technical',
  startsAt: '2026-10-15T08:00:00Z',
  minutes: 60,
  interviewerIds: ['adam', 'mei'],
  state: 'scheduled',
};
const competencies = [
  { key: 'systems', name: 'System design' },
  { key: 'collab', name: 'Collaboration' },
];
const card = (
  interviewerId: string,
  ratings: Record<string, 1 | 2 | 3 | 4>,
  submittedAt: string | null,
): Scorecard => ({
  interviewId: 'i1',
  interviewerId,
  ratings,
  recommendation: submittedAt === null ? null : 'yes',
  submittedAt,
});

describe('interviews and scorecards (PRD §16)', () => {
  it('owes a scorecard from each interviewer a day after a completed interview', () => {
    const done = moveInterview(interview, 'completed');
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(scorecardsOwed(done.value, ['mei'], '2026-10-15T09:00:00Z')).toEqual([
      { interviewerId: 'adam', dueAt: '2026-10-16T09:00:00.000Z' },
    ]);
    expect(moveInterview(done.value, 'scheduled').ok).toBe(false);
  });

  it('submits only a complete scorecard', () => {
    expect(submitScorecard(card('adam', { systems: 3 }, null), competencies, 'now')).toMatchObject({
      ok: false,
      error: { code: 'RATINGS_MISSING' },
    });
    expect(
      submitScorecard(
        { ...card('adam', { systems: 3, collab: 4 }, null), recommendation: 'yes' },
        competencies,
        'now',
      ).ok,
    ).toBe(true);
  });

  it('keeps others’ scorecards from an interviewer until theirs is in', () => {
    const cards = [
      card('adam', {}, null),
      card('mei', { systems: 4, collab: 4 }, '2026-10-15T10:00:00Z'),
    ];
    expect(
      visibleScorecards(cards, { kind: 'interviewer', personId: 'adam' }).map(
        (c) => c.interviewerId,
      ),
    ).toEqual(['adam']);
    expect(
      visibleScorecards(cards, { kind: 'interviewer', personId: 'mei' }).map(
        (c) => c.interviewerId,
      ),
    ).toEqual(['mei']);
    expect(visibleScorecards(cards, { kind: 'hiring_team' }).map((c) => c.interviewerId)).toEqual([
      'mei',
    ]);
  });

  it('averages per competency and marks two points apart as a disagreement', () => {
    const result = debrief(
      competencies,
      [
        card('adam', { systems: 2, collab: 3 }, 't'),
        card('mei', { systems: 4, collab: 3 }, 't'),
        card('tom', { systems: 3, collab: 4 }, 't'),
      ],
      4,
    );
    expect(result.rows.map((r) => [r.competency, r.average, r.disagreement])).toEqual([
      ['systems', '3.00', true],
      ['collab', '3.33', false],
    ]);
    expect(result).toMatchObject({ submitted: 3, expected: 4, recommendations: { yes: 3 } });
  });

  it('lets only the hiring manager decide, with a reason', () => {
    expect(decideDebrief('adam', 'marco', 'offer', 'Strong').ok).toBe(false);
    expect(decideDebrief('marco', 'marco', 'offer', '')).toMatchObject({
      ok: false,
      error: { code: 'REASON_REQUIRED' },
    });
    expect(decideDebrief('marco', 'marco', 'offer', 'Strong on systems').ok).toBe(true);
  });
});
