import { Badge, Timeline, TimelineItem, icons, type IconName } from '@reach/ui';
import type { JSX } from 'react';

import { StateBadge, day, money, when, words } from './shared';
import type { Category, CandidateData } from './types';
import { t as tr } from './i18n';

/**
 * An application's journey: one step of the timeline for each visit to a
 * stage, newest first, and inside it what happened while the candidate was
 * there — the emails, the times asked for and given, the interviews and their
 * scorecards, the offers. Nothing the old list of moves said is lost (an
 * undone or corrected move still says so); it is only put where it happened.
 */

type Application = CandidateData['applications'][number];

const STAGE_ICON: Readonly<Record<Category, IconName>> = {
  applied: 'inbox',
  screening: 'search',
  interview: 'meeting',
  assessment: 'assessment',
  works_council: 'organisation',
  offer: 'agreement',
  contract: 'document',
  hired: 'hire',
};

const STAGE_TONE: Readonly<Record<Category, 'neutral' | 'info' | 'accent' | 'warning' | 'success'>> =
  {
    applied: 'neutral',
    screening: 'info',
    interview: 'accent',
    assessment: 'accent',
    works_council: 'warning',
    offer: 'success',
    contract: 'success',
    hired: 'success',
  };

interface Moment {
  readonly key: string;
  readonly at: string;
  readonly icon: IconName;
  readonly text: string;
  readonly detail: string | null;
  readonly state?: string;
  readonly upcoming?: boolean;
}

/** When a UUIDv7 was made: its first 48 bits are the milliseconds (RFC 9562). Offers carry no date of their own. */
function madeAt(id: string): string | null {
  const hex = id.replaceAll('-', '');
  if (hex.charAt(12) !== '7') return null;
  const ms = Number.parseInt(hex.slice(0, 12), 16);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function askText(a: Application['asks'][number]): string {
  const label = a.label.toLowerCase();
  if (a.kind === 'slots')
    return tr(
      'journey.times_offered',
      { one: 'A time offered for the {{label}}', other: '{{count}} times offered for the {{label}}' },
      { count: a.times.length, label },
    );
  if (a.kind === 'availability')
    return tr(
      'journey.times_given',
      {
        one: 'The candidate gave a time for the {{label}}',
        other: 'The candidate gave {{count}} times for the {{label}}',
      },
      { count: a.times.length, label },
    );
  if (a.kind === 'info') return tr('journey.asked', 'Asked: {{label}}', { label: a.label });
  return tr('journey.asked_to_move', 'The candidate asked to move the {{label}}', { label });
}

function askDetail(a: Application['asks'][number]): string | null {
  if (a.answer?.time != null) return tr('journey.chose', 'Chose {{time}}', { time: when(a.answer.time) });
  if (a.answer?.text != null) return a.answer.text;
  if (a.state === 'open') return tr('journey.waiting_on_the_candidate', 'Waiting on the candidate');
  if (a.closedBecause === 'replaced') return tr('journey.replaced', 'Replaced by new times');
  if (a.closedBecause === 'more_times') return tr('journey.more_times', 'More times asked for');
  if (a.closedBecause === 'moved_on')
    return tr('journey.moved_on', 'Closed when the candidate moved on');
  return a.state === 'closed' ? tr('journey.closed', 'Closed') : null;
}

function moments(data: CandidateData, app: Application, now: number): Moment[] {
  const names = data.names ?? {};
  return [
    ...data.messages.map((m) => ({
      key: `m:${m.id}`,
      at: m.direction === 'out' ? (m.sentAt ?? m.sendAt) : m.createdAt,
      icon: (m.direction === 'out' ? 'send' : 'email') as IconName,
      text: m.subject,
      detail:
        m.direction === 'in'
          ? tr('journey.reply', 'Their reply')
          : m.sentAt === null
            ? tr('journey.sends', 'Sends {{at}}', { at: when(m.sendAt) })
            : tr('journey.email_sent', 'Email sent'),
    })),
    ...app.asks.map((a) => ({
      key: `a:${a.id}`,
      at: a.createdAt,
      icon: (a.kind === 'info' ? 'help' : 'calendar') as IconName,
      text: askText(a),
      detail: askDetail(a),
    })),
    ...app.interviews.map((i) => ({
      key: `i:${i.id}`,
      at: i.startsAt,
      icon: 'meeting' as IconName,
      text: i.title,
      detail: tr('journey.interview_when', '{{when}} · {{minutes}} min', {
        when: when(i.startsAt),
        minutes: String(i.minutes),
      }),
      state: i.state,
      upcoming: i.state === 'scheduled' && Date.parse(i.startsAt) > now,
    })),
    ...app.scorecards
      .filter((c) => c.submittedAt !== null)
      .map((c) => ({
        key: `s:${c.interviewId}:${c.interviewerId}`,
        at: c.submittedAt ?? '',
        icon: 'review' as IconName,
        text: tr('journey.scorecard_from', 'Scorecard from {{name}}', {
          name: names[c.interviewerId] ?? tr('journey.an_interviewer', 'an interviewer'),
        }),
        detail: c.recommendation === null ? null : words(c.recommendation),
      })),
    ...app.offers.map((o) => ({
      key: `o:${o.id}`,
      at: madeAt(o.id) ?? app.history.at(-1)?.at ?? '',
      icon: 'agreement' as IconName,
      text: tr('journey.offer_version', 'Offer, version {{version}}', { version: String(o.version) }),
      detail: tr('journey.offer_detail', '{{base}} · starts {{start}}', {
        base: money(o.baseMinor, o.currency),
        start: day(o.startDate),
      }),
      state: o.state,
    })),
  ];
}

export function Journey({
  data,
  application,
}: {
  readonly data: CandidateData;
  readonly application: Application;
}): JSX.Element {
  const now = Date.now();
  const all = moments(data, application, now).toSorted((a, b) => b.at.localeCompare(a.at));
  const visits = application.history.map((m, i) => {
    const until = application.history[i + 1]?.at ?? null;
    const stage = application.stages.find((s) => s.id === m.to);
    return {
      move: m,
      stage,
      until,
      // What happened while they were here; what came before the first move belongs to it.
      happened: all.filter((e) => (i === 0 || e.at >= m.at) && (until === null || e.at < until)),
    };
  });
  const active = application.outcome === 'active';
  const newestFirst = visits.toReversed();
  return (
    <Timeline>
      {application.rejection === null ? null : (
        <TimelineItem
          icon={<icons.reject aria-hidden />}
          tone="neutral"
          title={tr('journey.rejected', 'Rejected')}
          timestamp={when(application.rejection.at)}
        >
          {words(application.rejection.reasonKey)}
        </TimelineItem>
      )}
      {newestFirst.map((v, i) => {
        const category = v.stage?.category ?? 'applied';
        const current = active && i === 0;
        const Icon = icons[STAGE_ICON[category]];
        return (
          <TimelineItem
            key={v.move.id}
            icon={<Icon aria-hidden />}
            tone={STAGE_TONE[category]}
            status={current ? 'current' : 'past'}
            last={i === newestFirst.length - 1}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {v.stage?.name ?? tr('journey.moved', 'Moved')}
                {current ? (
                  <Badge size="sm" tone="accent">
                    {tr('journey.now', 'Now')}
                  </Badge>
                ) : null}
                {v.move.supersedes === null ? null : (
                  <Badge size="sm" tone="neutral">
                    {v.move.reason === 'undone'
                      ? tr('journey.undone', 'Undone')
                      : tr('journey.corrected', 'Corrected: {{reason}}', {
                          reason: v.move.reason ?? '',
                        })}
                  </Badge>
                )}
              </span>
            }
            timestamp={
              v.until === null
                ? tr('journey.since', 'Since {{day}}', { day: day(v.move.at) })
                : tr('journey.from_to', '{{from}} – {{to}}', {
                    from: day(v.move.at),
                    to: day(v.until),
                  })
            }
          >
            {v.happened.length === 0 ? null : (
              <ul className="mt-2 flex flex-col gap-2">
                {v.happened.map((e) => {
                  const Glyph = icons[e.icon];
                  return (
                    <li key={e.key} className="flex items-start gap-2.5">
                      <Glyph aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg">
                          <span className="[overflow-wrap:anywhere]">{e.text}</span>
                          {e.upcoming === true ? (
                            <Badge size="sm" tone="info">
                              {tr('journey.upcoming', 'Upcoming')}
                            </Badge>
                          ) : e.state === undefined ? null : (
                            <StateBadge state={e.state} />
                          )}
                        </span>
                        {e.detail === null ? null : <span>{e.detail}</span>}
                      </span>
                      <time
                        dateTime={e.at}
                        className="shrink-0 text-xs whitespace-nowrap tabular-nums text-fg-subtle"
                      >
                        {day(e.at)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
