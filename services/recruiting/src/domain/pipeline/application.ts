import type { ApplicationOutcome, StageCategory } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Stage } from './pipeline.js';

/**
 * An application and its stage history (Recruiting PRD §12, REC-019).
 *
 * The history is append-only: the current stage is the last move's
 * destination. A move is reversible for ten seconds; after that only by a
 * correction, which names the move it supersedes and gives a reason, so
 * analytics can tell a mistake from a candidate going backwards.
 */

export const UNDO_WINDOW_MS = 10_000;

export interface StageMove {
  readonly id: string;
  readonly from: string | null;
  readonly to: string;
  readonly at: string;
  readonly by: string;
  /** The move this one corrects or undoes. */
  readonly supersedes: string | null;
  readonly reason: string | null;
}

export interface Rejection {
  readonly reasonKey: string;
  readonly at: string;
  readonly by: string;
}

export interface Application {
  readonly id: string;
  readonly candidateId: string;
  readonly jobId: string;
  readonly outcome: ApplicationOutcome;
  readonly rejection: Rejection | null;
  readonly withdrawnAt: string | null;
  readonly history: readonly StageMove[];
  /** Knockout rules matched at intake (PRD §15.2): flagged for review, never rejected by default. */
  readonly flagged: boolean;
}

export const currentStage = (app: Application): string => {
  const last = app.history.at(-1);
  if (last === undefined) throw new Error(`Application ${app.id} has no stage`);
  return last.to;
};

export function receive(input: {
  readonly id: string;
  readonly candidateId: string;
  readonly jobId: string;
  readonly stages: readonly Stage[];
  readonly at: string;
  readonly by: string;
  readonly moveId: string;
  readonly flagged: boolean;
}): Application {
  const first = input.stages[0];
  if (first === undefined) throw new Error('A job always has a pipeline');
  return {
    id: input.id,
    candidateId: input.candidateId,
    jobId: input.jobId,
    outcome: 'active',
    rejection: null,
    withdrawnAt: null,
    history: [
      {
        id: input.moveId,
        from: null,
        to: first.id,
        at: input.at,
        by: input.by,
        supersedes: null,
        reason: null,
      },
    ],
    flagged: input.flagged,
  };
}

/** What a move needs to ask, and what it opens (PRD §12.2). */
export interface MoveNeeds {
  /** Entering an interview stage asks which interview. */
  readonly interviewType?: string;
  /** For a DE job with a works council: § 99 consent given or deemed. */
  readonly worksCouncilCleared?: boolean;
}

export interface Moved {
  readonly application: Application;
  readonly move: StageMove;
  readonly category: StageCategory;
  /** A move into `offer` opens the offer (PRD §12.2). */
  readonly opensOffer: boolean;
  readonly automations: Stage['automations'];
}

export function moveTo(
  app: Application,
  stages: readonly Stage[],
  to: string,
  by: string,
  at: string,
  id: string,
  needs: MoveNeeds = {},
): Result<Moved> {
  if (app.outcome !== 'active')
    return err(failure('NOT_ACTIVE', `This application is ${app.outcome}`));
  const target = stages.find((s) => s.id === to);
  if (target === undefined) return err(failure('NO_STAGE', 'No such stage in this job’s pipeline'));
  const from = currentStage(app);
  if (from === to) return err(failure('SAME_STAGE', 'Already in that stage'));
  if (target.category === 'hired') {
    return err(
      failure(
        'HIRED_BY_CONTRACT',
        'A candidate is hired when the contract is signed, not by a move',
      ),
    );
  }
  if (target.category === 'interview' && needs.interviewType === undefined) {
    return err(failure('NEEDS_INTERVIEW_TYPE', 'Say which interview this is'));
  }
  const council = stages.some((s) => s.category === 'works_council');
  if (target.category === 'offer' && council && needs.worksCouncilCleared !== true) {
    return err(
      failure('WORKS_COUNCIL', 'The works council has not consented to this hire (§ 99 BetrVG)'),
    );
  }
  const move: StageMove = { id, from, to, at, by, supersedes: null, reason: null };
  return ok({
    application: { ...app, history: [...app.history, move] },
    move,
    category: target.category,
    opensOffer: target.category === 'offer',
    automations: target.automations,
  });
}

/** Undo the last move within ten seconds of it (PRD §12.2). */
export function undo(
  app: Application,
  moveId: string,
  by: string,
  at: string,
  id: string,
): Result<{ application: Application; move: StageMove }> {
  const last = app.history.at(-1);
  if (last?.id !== moveId || last.from === null)
    return err(failure('NOT_LAST', 'Only the last move can be undone'));
  if (Date.parse(at) - Date.parse(last.at) > UNDO_WINDOW_MS) {
    return err(
      failure('UNDO_EXPIRED', 'Too late to undo; correct the move instead, with a reason'),
    );
  }
  const move: StageMove = {
    id,
    from: last.to,
    to: last.from,
    at,
    by,
    supersedes: last.id,
    reason: 'undone',
  };
  return ok({ application: { ...app, history: [...app.history, move] }, move });
}

/** Correct a move made by mistake, at any time, with a reason (repo rule: `supersedes`). */
export function correct(
  app: Application,
  stages: readonly Stage[],
  moveId: string,
  to: string,
  reason: string,
  by: string,
  at: string,
  id: string,
): Result<{ application: Application; move: StageMove }> {
  if (reason.trim() === '') return err(failure('REASON_REQUIRED', 'A correction says why'));
  if (!app.history.some((m) => m.id === moveId)) return err(failure('NO_MOVE', 'No such move'));
  if (!stages.some((s) => s.id === to))
    return err(failure('NO_STAGE', 'No such stage in this job’s pipeline'));
  const move: StageMove = { id, from: currentStage(app), to, at, by, supersedes: moveId, reason };
  return ok({ application: { ...app, history: [...app.history, move] }, move });
}

export function reject(
  app: Application,
  reasonKey: string,
  by: string,
  at: string,
): Result<Application> {
  if (app.outcome !== 'active')
    return err(failure('NOT_ACTIVE', `This application is ${app.outcome}`));
  if (reasonKey.trim() === '') return err(failure('REASON_REQUIRED', 'A rejection has a reason'));
  return ok({ ...app, outcome: 'rejected', rejection: { reasonKey, at, by } });
}

export function withdraw(app: Application, at: string): Result<Application> {
  if (app.outcome !== 'active')
    return err(failure('NOT_ACTIVE', `This application is ${app.outcome}`));
  return ok({ ...app, outcome: 'withdrawn', withdrawnAt: at });
}

/** The contract is signed: the application moves to the hired stage (PRD §21.3). */
export function hire(
  app: Application,
  stages: readonly Stage[],
  by: string,
  at: string,
  id: string,
): Result<{ application: Application; move: StageMove }> {
  if (app.outcome !== 'active')
    return err(failure('NOT_ACTIVE', `This application is ${app.outcome}`));
  const hired = stages.find((s) => s.category === 'hired');
  if (hired === undefined) return err(failure('NO_STAGE', 'This pipeline has no hired stage'));
  const move: StageMove = {
    id,
    from: currentStage(app),
    to: hired.id,
    at,
    by,
    supersedes: null,
    reason: null,
  };
  return ok({ application: { ...app, outcome: 'hired', history: [...app.history, move] }, move });
}

/** Whole days since the application entered its current stage. */
export const daysInStage = (app: Application, now: string): number =>
  Math.floor((Date.parse(now) - Date.parse(app.history.at(-1)?.at ?? now)) / 86_400_000);

/**
 * The effective history: undone and corrected moves removed, so a stage the
 * candidate was in by mistake does not count in conversion (PRD §23.1).
 */
export function effectiveHistory(app: Application): StageMove[] {
  const superseded = new Set(
    app.history.flatMap((m) => (m.supersedes === null ? [] : [m.supersedes])),
  );
  return app.history.filter((m) => !superseded.has(m.id) && m.reason !== 'undone');
}

/** The furthest category an application ever reached, read from its effective history. */
export function furthestCategory(app: Application, stages: readonly Stage[]): StageCategory {
  const rank: Record<string, number> = {
    applied: 0,
    screening: 1,
    interview: 2,
    assessment: 3,
    works_council: 4,
    offer: 5,
    hired: 6,
  };
  let best: StageCategory = 'applied';
  for (const move of effectiveHistory(app)) {
    const category = stages.find((s) => s.id === move.to)?.category;
    if (category !== undefined && (rank[category] ?? 0) > (rank[best] ?? 0)) best = category;
  }
  return best;
}
