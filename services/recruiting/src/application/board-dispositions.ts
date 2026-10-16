import type { PendingEvent } from '@kithena/domain-kit';
import type { StageCategory } from '@kithena/contracts';

import type { Deps, Tx } from './ports.js';

/** What it needs of a request; not `Ctx`, which publishes through here. */
interface Request {
  readonly deps: Pick<Deps, 'boards'>;
  readonly tx: Pick<Tx, 'applications'>;
  readonly at: string;
}

/**
 * Tells a board where an application it sent has got to (PRD §26.1, REC-132):
 * Indeed's disposition sync. Read off the events every move already publishes,
 * so no path that moves an application can forget it. Best effort: a board
 * that does not answer never stops the move.
 */
export async function tellBoards(ctx: Request, events: readonly PendingEvent[]): Promise<void> {
  const boards = (ctx.deps.boards ?? []).filter((b) => b.disposition !== undefined);
  if (boards.length === 0) return;
  for (const e of events) {
    const payload = e.payload as { applicationId?: string; category?: StageCategory };
    const status =
      e.eventName === 'recruiting.application.moved'
        ? payload.category
        : e.eventName === 'recruiting.application.rejected'
          ? 'rejected'
          : e.eventName === 'recruiting.application.withdrawn'
            ? 'withdrawn'
            : e.eventName === 'recruiting.candidate.hired'
              ? 'hired'
              : undefined;
    if (status === undefined || payload.applicationId === undefined) continue;
    const app = await ctx.tx.applications.get(payload.applicationId);
    if (app?.source.kind !== 'target') continue;
    const target = app.source.target;
    const ref = app.answers['boardRef'];
    const board = boards.find((b) => b.target === target);
    if (typeof ref === 'string' && board?.disposition !== undefined)
      await board.disposition({ ref, status, at: ctx.at });
  }
}
