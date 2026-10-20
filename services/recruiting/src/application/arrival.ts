import { aiOn } from './ai.js';
import type { Ctx } from './context.js';
import { assessMatrix } from './matrix.js';
import { parseCv } from './parser.js';

/**
 * What the company switched on runs as an application arrives (PRD §22.2,
 * §14): the CV read into a profile, and the evidence matrix against the job's
 * criteria, so the board shows a match the moment someone applies. As the
 * system, recorded as such; a model that is off or fails changes nothing
 * about the application. Called by the transport once the application has
 * landed, so the intake never depends on the readers.
 */
export async function readOnArrival(ctx: Ctx, applicationId: string): Promise<void> {
  try {
    if (await aiOn(ctx, 'parser')) await parseCv(ctx, applicationId, true);
    if (await aiOn(ctx, 'matrix')) await assessMatrix(ctx, applicationId, true);
  } catch {
    // Read later, by a person on the profile; the application has landed either way.
  }
}
