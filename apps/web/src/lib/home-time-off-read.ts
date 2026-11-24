import 'server-only';

import {
  homeAway,
  type AwayScope,
  type HomeAway,
  type OverviewAnswer,
  type TimelineAnswer,
} from './home-time-off';
import { timeOff } from './people';
import { today } from './people-screens';

/** Who is away in the next three weeks, in one of Time Off's scopes; null when Time Off refuses it. */
export async function homeAwayIn(
  scope: AwayScope,
  /** The reader, left out of the list; asked of Time Off when not handed. */
  me?: Promise<string | null>,
): Promise<HomeAway | null> {
  const day = today();
  const to = new Date(Date.parse(`${day}T12:00:00Z`) + 21 * 86_400_000).toISOString().slice(0, 10);
  const [timeline, reader] = await Promise.all([
    timeOff<TimelineAnswer>('TimeOffCalendarTimeline', { from: day, to, scope }),
    me === undefined
      ? timeOff<OverviewAnswer>('TimeOffOverview').then((o) =>
          o.ok ? (o.data.member?.personId ?? null) : null,
        )
      : me,
  ]);
  return timeline.ok ? homeAway(timeline.data, day, reader, scope) : null;
}
