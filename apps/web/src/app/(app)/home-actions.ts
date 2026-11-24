'use server';

import type { AwayScope, HomeAway } from '../../lib/home-time-off';
import { homeAwayIn } from '../../lib/home-time-off-read';

/**
 * Who's out on Home, in another of Time Off's scopes: asked for when the
 * reader picks one. Null when Time Off refuses it (the whole company, to
 * somebody who may only see their team) or cannot answer.
 */
export async function homeAway(scope: AwayScope): Promise<HomeAway | null> {
  // Anything but a scope Time Off names is the team's.
  return homeAwayIn(scope === 'company' ? 'company' : 'team').catch(() => null);
}
