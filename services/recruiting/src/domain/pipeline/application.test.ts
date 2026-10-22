import { describe, expect, it } from 'vitest';

import {
  correct,
  currentStage,
  daysInStage,
  effectiveHistory,
  furthestCategory,
  hire,
  moveTo,
  receive,
  reject,
  undo,
  type Application,
} from './application.js';
import {
  defaultPipeline,
  nextWorkingMorning,
  sendAt,
  validatePipeline,
  withWorksCouncil,
  type Stage,
} from './pipeline.js';

let n = 0;
const id = () => `id${String(++n)}`;
const stages = defaultPipeline(id);
const [applied, screening, interview, , offer, hired] = stages as [
  Stage,
  Stage,
  Stage,
  Stage,
  Stage,
  Stage,
];

const fresh = (): Application =>
  receive({
    id: 'a1',
    candidateId: 'c1',
    jobId: 'j1',
    stages,
    at: '2026-10-01T09:00:00Z',
    by: 'ada',
    moveId: 'm0',
    flagged: false,
  });

const value = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe('pipelines (PRD §12.1)', () => {
  it('accepts the default and refuses one that goes backwards or has no offer', () => {
    expect(validatePipeline(stages).ok).toBe(true);
    expect(validatePipeline([applied, interview, screening, offer, hired])).toMatchObject({
      ok: false,
      error: { code: 'PIPELINE_ORDER' },
    });
    expect(validatePipeline([applied, screening, hired])).toMatchObject({
      ok: false,
      error: { code: 'PIPELINE_OFFER' },
    });
  });

  it('adds the works council stage before the offer for a German entity with one', () => {
    const council = withWorksCouncil(stages, () => 'wc');
    expect(council.map((s) => s.category)).toEqual([
      'applied',
      'screening',
      'interview',
      'assessment',
      'works_council',
      'offer',
      'hired',
    ]);
    expect(validatePipeline(council).ok).toBe(true);
  });

  it('tells a knockout the next working day at 09:00 in the candidate’s zone, never the same day', () => {
    // Wednesday 14 October, 15:00 in Madrid: Thursday at 09:00 CEST is 07:00 UTC.
    expect(
      nextWorkingMorning(new Date('2026-10-14T13:00:00Z'), 'Europe/Madrid').toISOString(),
    ).toBe('2026-10-15T07:00:00.000Z');
    // Friday evening in New York: Monday 19 October at 09:00 EDT is 13:00 UTC.
    expect(
      nextWorkingMorning(new Date('2026-10-16T22:00:00Z'), 'America/New_York').toISOString(),
    ).toBe('2026-10-19T13:00:00.000Z');
    // Saturday in Berlin, after the clocks went back: Monday 26 October at 09:00 CET is 08:00 UTC.
    expect(
      nextWorkingMorning(new Date('2026-10-24T10:00:00Z'), 'Europe/Berlin').toISOString(),
    ).toBe('2026-10-26T08:00:00.000Z');
  });

  it('holds an email sent at night until 08:00 in the candidate’s zone', () => {
    // 22:30 in Madrid (CEST, UTC+2) on 14 October is 20:30 UTC; 08:00 the next day is 06:00 UTC.
    expect(sendAt(new Date('2026-10-14T20:30:00Z'), 'Europe/Madrid').toISOString()).toBe(
      '2026-10-15T06:00:00.000Z',
    );
    expect(sendAt(new Date('2026-10-14T10:00:00Z'), 'Europe/Madrid').toISOString()).toBe(
      '2026-10-14T10:00:00.000Z',
    );
    // 05:15 in New York is held to 08:00 the same day.
    expect(sendAt(new Date('2026-10-14T09:15:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-10-14T12:00:00.000Z',
    );
  });
});

describe('moving an application (PRD §12.2)', () => {
  it('asks for the interview type entering an interview stage, and opens the offer entering offer', () => {
    expect(
      moveTo(fresh(), stages, interview.id, 'ada', '2026-10-02T09:00:00Z', 'm1'),
    ).toMatchObject({
      ok: false,
      error: { code: 'NEEDS_INTERVIEW_TYPE' },
    });
    const moved = value(moveTo(fresh(), stages, offer.id, 'ada', '2026-10-02T09:00:00Z', 'm1'));
    expect(moved).toMatchObject({ opensOffer: true, category: 'offer' });
  });

  it('never hires by a move', () => {
    expect(moveTo(fresh(), stages, hired.id, 'ada', '2026-10-02T09:00:00Z', 'm1')).toMatchObject({
      ok: false,
      error: { code: 'HIRED_BY_CONTRACT' },
    });
  });

  it('refuses an offer before the works council has consented', () => {
    const council = withWorksCouncil(stages, () => 'wc');
    expect(moveTo(fresh(), council, offer.id, 'ada', '2026-10-02T09:00:00Z', 'm1')).toMatchObject({
      ok: false,
      error: { code: 'WORKS_COUNCIL' },
    });
    expect(
      moveTo(fresh(), council, offer.id, 'ada', '2026-10-02T09:00:00Z', 'm1', {
        worksCouncilCleared: true,
      }).ok,
    ).toBe(true);
  });

  it('undoes within ten seconds, and only corrects after', () => {
    const moved = value(moveTo(fresh(), stages, screening.id, 'ada', '2026-10-02T09:00:00Z', 'm1'));
    const undone = value(undo(moved.application, 'm1', 'ada', '2026-10-02T09:00:08Z', 'm2'));
    expect(currentStage(undone.application)).toBe(applied.id);
    expect(effectiveHistory(undone.application).map((m) => m.id)).toEqual(['m0']);
    expect(undo(moved.application, 'm1', 'ada', '2026-10-02T09:00:11Z', 'm2')).toMatchObject({
      ok: false,
      error: { code: 'UNDO_EXPIRED' },
    });

    const corrected = value(
      correct(
        moved.application,
        stages,
        'm1',
        applied.id,
        'Wrong candidate',
        'ada',
        '2026-10-03T09:00:00Z',
        'm3',
      ),
    );
    expect(corrected.move).toMatchObject({ supersedes: 'm1', reason: 'Wrong candidate' });
    expect(furthestCategory(corrected.application, stages)).toBe('applied');
  });

  it('rejects with a reason key, and a rejected application cannot move', () => {
    const rejected = value(reject(fresh(), 'not_qualified', 'ada', '2026-10-02T09:00:00Z'));
    expect(rejected).toMatchObject({
      outcome: 'rejected',
      rejection: { reasonKey: 'not_qualified' },
    });
    expect(
      moveTo(rejected, stages, screening.id, 'ada', '2026-10-03T09:00:00Z', 'm1'),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ACTIVE' } });
  });

  it('is hired by the contract and counts the days in its stage', () => {
    const done = value(hire(fresh(), stages, 'system', '2026-10-20T09:00:00Z', 'm9'));
    expect(done.application.outcome).toBe('hired');
    expect(furthestCategory(done.application, stages)).toBe('hired');
    expect(daysInStage(fresh(), '2026-10-05T10:00:00Z')).toBe(4);
  });
});
