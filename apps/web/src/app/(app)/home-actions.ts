'use server';

import { awayScope, type HomeAway } from '../../lib/home-time-off';
import { homeAwayIn } from '../../lib/home-time-off-read';

/**
 * Who's out on Home, in another of Time Off's scopes: asked for when the
 * reader picks one. Null when Time Off refuses it (the whole company, to
 * somebody who may only see their team) or cannot answer.
 */
export async function homeAway(scope: string): Promise<HomeAway | null> {
  return homeAwayIn(awayScope(scope)).catch(() => null);
}
