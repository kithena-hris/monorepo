import 'server-only';

import {
  homeAway,
  type AwayScope,
  type AwayUnit,
  type HomeAway,
  type OverviewAnswer,
  type TimelineAnswer,
} from './home-time-off';
import { people, timeOff } from './people';
import { today } from './people-screens';

/**
 * The departments somebody can ask about, from People, which names them.
 * Time Off keys a team by the department's id (`teamKeyOf` in its People
 * consumer); the same key is made here, so a department nobody in Time Off
 * has named yet can still be asked for. None when People cannot say.
 */
async function units(): Promise<readonly AwayUnit[]> {
  const org = await people<{
    readonly orgUnits: readonly {
      readonly id: string;
      readonly name: string;
      readonly archived: boolean;
    }[];
  }>('Organisation');
  return org.ok
    ? org.data.orgUnits
        .filter((u) => !u.archived)
        .map((u) => ({ teamKey: `u_${u.id.replaceAll('-', '')}`, name: u.name }))
    : [];
}

/**
 * Who is away in the next three weeks, in one of Time Off's scopes; null when Time Off refuses it.
 * ponytail: Time Off answers the whole timeline, so each page reads it again
 * and keeps fifty. Page in Time Off when a company's list is opened often.
 */
export async function homeAwayIn(
  scope: AwayScope,
  /** The reader, left out of the list; asked of Time Off when not handed. */
  me?: Promise<string | null>,
  /** How many to pass over: a later page of the same list. */
  from = 0,
): Promise<HomeAway | null> {
  const day = today();
  const to = new Date(Date.parse(`${day}T12:00:00Z`) + 21 * 86_400_000).toISOString().slice(0, 10);
  const [timeline, reader, named] = await Promise.all([
    timeOff<TimelineAnswer>(
      'TimeOffCalendarTimeline',
      scope.startsWith('unit:')
        ? { from: day, to, scope: 'team', teamKey: scope.slice('unit:'.length) }
        : { from: day, to, scope },
    ),
    me === undefined
      ? timeOff<OverviewAnswer>('TimeOffOverview').then((o) =>
          o.ok ? (o.data.member?.personId ?? null) : null,
        )
      : me,
    units().catch(() => []),
  ]);
  return timeline.ok ? homeAway(timeline.data, day, reader, scope, named, from) : null;
}
