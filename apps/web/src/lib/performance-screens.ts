import 'server-only';

import { people, performance, timeOff } from './people';
import { currentPerson } from './session';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import type { OperationName } from './performance-operations';

/**
 * The data each Performance screen is drawn from, fetched on the server before
 * the page is sent, through the router, as the person signed in (PRF-070).
 * A tab is its own address (`/performance/feedback/sent`), and every filter
 * is in the query string.
 */

async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<ScreenLoad> {
  const answer = await performance<unknown>(name, variables);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

interface Timeline {
  readonly timeOffCalendarTimeline: {
    readonly entries: readonly {
      readonly personId: string;
      readonly status: string;
      readonly span: { readonly from: string; readonly to: string };
    }[];
  };
}

/**
 * Who is away in the next month, from Time Off, as the person signed in sees
 * it there (PRF-190): when they are back, never why. Time Off refusing (a
 * manager it shows only their team, say) just means no badges.
 */
/** Leave that is happening: agreed, taken, or agreed and being changed. */
const AWAY = new Set(['approved', 'taken', 'change_pending']);

async function awayNow(): Promise<Record<string, string>> {
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const answer = await timeOff<Timeline>('TimeOffCalendarTimeline', {
    from: today,
    to,
    scope: 'company',
  });
  const away: Record<string, string> = {};
  if (!answer.ok) return away;
  for (const e of answer.data.timeOffCalendarTimeline.entries)
    if (AWAY.has(e.status) && e.span.from <= to && e.span.to >= today) {
      const until = away[e.personId];
      if (until === undefined || e.span.to > until) away[e.personId] = e.span.to;
    }
  return away;
}

interface Organisation {
  readonly peopleOrganisation: {
    readonly legalEntities: readonly { readonly id: string; readonly name: string }[];
    readonly locations: readonly { readonly id: string; readonly name: string }[];
  };
}

/** Work location and legal entity names by id, from People; none if it cannot say. */
async function placesNamed(): Promise<{
  locations: Record<string, string>;
  entities: Record<string, string>;
}> {
  const answer = await people<Organisation>('Organisation');
  if (!answer.ok) return { locations: {}, entities: {} };
  const named = (xs: readonly { id: string; name: string }[]) =>
    Object.fromEntries(xs.map((x) => [x.id, x.name]));
  return {
    locations: named(answer.data.peopleOrganisation.locations),
    entities: named(answer.data.peopleOrganisation.legalEntities),
  };
}

const opt = (v: string | undefined): string | null => (v === undefined || v === '' ? null : v);
const int = (v: string | undefined): number | null =>
  v !== undefined && /^\d+$/u.test(v) ? Number(v) : null;
const last = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? '';

export async function loadScreen(
  component: string,
  query: ScreenQuery,
  path: string,
): Promise<ScreenLoad> {
  const s = query.search;
  const id = query.params['id'] ?? '';
  switch (component) {
    case 'Home':
      return read('PerformanceHome');
    case 'MyReviews': {
      const tab = last(path);
      const tabs: Record<string, string> = {
        owed: 'about',
        done: 'written',
        nominations: 'nominations',
      };
      return read('PerformanceMyReviews', { tab: tabs[tab] ?? 'write' });
    }
    case 'Write':
      return read('PerformanceReview', { id });
    case 'Released':
      return read('PerformanceReleased', { id });
    case 'Nominate':
      return read('PerformancePicker', { id, q: opt(s['q']) });
    case 'Cycles':
      return read('PerformanceCycles', { q: opt(s['q']), state: opt(s['state']) });
    case 'Overview': {
      const [done, person] = await Promise.all([
        read('PerformanceCycle', {
          id,
          q: opt(s['q']),
          page: int(s['page']),
          size: int(s['size']),
          tab: opt(s['tab']),
        }),
        currentPerson(),
      ]);
      if (done.status !== 'ready' || person?.entitlements.includes('module.timeoff') !== true)
        return done;
      return { ...done, data: { ...(done.data as object), away: await awayNow() } };
    }
    case 'Setup': {
      const [done, person] = await Promise.all([
        read('PerformanceCycleSetup', { id, q: opt(s['q']) }),
        currentPerson(),
      ]);
      // The filters name work locations and legal entities, which People holds.
      if (done.status !== 'ready' || person?.entitlements.includes('module.people') !== true)
        return done;
      return { ...done, data: { ...(done.data as object), places: await placesNamed() } };
    }
    case 'About': {
      const [done, person] = await Promise.all([
        read('PerformanceReviewsAbout', {
          cycleId: query.params['cycleId'] ?? '',
          subjectId: query.params['subjectId'] ?? '',
        }),
        currentPerson(),
      ]);
      // Filing the review to the person needs Documents beside Performance (PRD §20).
      const documents = person?.entitlements.includes('module.documents') === true;
      return done.status === 'ready'
        ? { ...done, data: { ...(done.data as object), documents } }
        : done;
    }
    case 'Unlocks':
      return read('PerformanceUnlocks');
    case 'Templates':
      return read('PerformanceTemplates', { q: opt(s['q']), show: opt(s['show']) });
    case 'Builder':
      return read('PerformanceTemplate', { id });
    case 'Preview':
      return read('PerformanceTemplatePreview', {
        id,
        version: int(s['version']),
        as: opt(s['as']),
        activity: opt(s['activity']),
      });
    case 'History':
      return read('PerformanceTemplateHistory', { id });
    case 'Feedback': {
      const tab = last(path);
      return read('PerformanceFeedback', {
        tab: ['sent', 'requests', 'praise'].includes(tab) ? tab : 'received',
      });
    }
    case 'Notes':
      return read('PerformanceNotes', { about: opt(s['about']) });
    case 'Goals': {
      // Mine, My team, Company (design PF18 v2); the company tab is the tree.
      const tab = last(path);
      return read('PerformanceGoals', {
        tab: tab === 'company' ? 'alignment' : 'list',
        period: opt(s['period']),
        scope: tab === 'team' ? 'team' : tab === 'company' ? 'company' : 'mine',
        risk: opt(s['risk']),
      });
    }
    case 'Goal':
      return read('PerformanceGoal', { id });
    case 'Learning': {
      const tab = last(path);
      return read('PerformanceLearning', {
        tab: tab === 'catalogue' ? 'catalogue' : tab === 'sessions' ? 'sessions' : 'assigned',
      });
    }
    case 'Item':
      return read('PerformanceLearningItem', { id });
    case 'Session':
      return read('PerformanceSession', { id, sessionId: query.params['sessionId'] ?? '' });
    case 'Automations':
      return read('PerformanceAutomations');
    case 'Automation':
      return read('PerformanceAutomation', { id });
    case 'Calibrations':
      return read('PerformanceCalibrations');
    case 'Calibration':
      return read('PerformanceCalibration', { id });
    case 'Analytics': {
      const tab = last(path);
      return read('PerformanceAnalytics', {
        tab: ['raters', 'trends', 'fairness', 'ask'].includes(tab) ? tab : 'cycle',
        cycleId: opt(s['cycle']),
        personId: opt(s['person']),
      });
    }
    case 'Settings': {
      // One screen for every settings page; which page is the address's last part.
      const done = await read('PerformanceSettings');
      return done.status === 'ready'
        ? { ...done, data: { ...(done.data as object), page: last(path) } }
        : done;
    }
    case 'AiLog':
      return read('PerformanceAiLog');
    case 'Retention':
      return read('PerformanceRetention');
    case 'Webhooks':
      return read('PerformanceWebhooks');
    case 'ConnectedTools':
      return read('PerformanceConnectedTools');
    default:
      return { status: 'none' };
  }
}
