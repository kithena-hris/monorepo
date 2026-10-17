import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Progress,
  Stat,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded } from './load';
import { CycleBadge, Live, ReviewBadge, To, day, kindLabel, words } from './shared';
import type { ScreenProps } from './types';

/**
 * PF1 and PF1b (v2): what the person owes, what is owed to them and their
 * goals; HR also sees the cycles they own, live. Every number is Performance's.
 */

export interface HomeData {
  readonly hr: boolean;
  readonly name: string;
  readonly member: boolean;
  readonly stats: readonly {
    readonly label: string;
    readonly value: string;
    readonly detail: string;
    readonly warning?: boolean;
  }[];
  readonly tasks: readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string | null;
    readonly link: string;
    readonly due: string | null;
    readonly tone: string | null;
  }[];
  readonly running: readonly {
    readonly id: string;
    readonly name: string;
    readonly state: string;
    readonly who: string;
    readonly start: string;
    readonly progress: number;
  }[];
  readonly goals: readonly {
    readonly id: string;
    readonly title: string;
    readonly progress: number;
    readonly confidence: string;
  }[];
  readonly owed: readonly {
    readonly id: string;
    readonly kind: string;
    readonly from: string | null;
    readonly state: string;
    readonly cycle: string;
    readonly released: string | null;
  }[];
}

export const CONFIDENCE: Readonly<
  Record<string, readonly [string, 'success' | 'warning' | 'danger' | 'accent']>
> = {
  on_track: ['On track', 'success'],
  at_risk: ['At risk', 'warning'],
  off_track: ['Off track', 'danger'],
  done: ['Done', 'accent'],
};

export function Home(props: ScreenProps<HomeData>): JSX.Element {
  return (
    <Loaded load={props.load} what="Performance">
      {(data) => (
        <div className="flex flex-col gap-5">
          <PageHeader
            title="Performance"
            description={`Reviews, feedback, goals and learning.${data.hr ? ' As HR.' : ''}`}
            actions={
              <>
                <Button variant="secondary" asChild>
                  <a href="/performance/feedback?give=1">Give feedback</a>
                </Button>
                {data.hr ? (
                  <Button asChild>
                    <a href="/performance/cycles?new=1">New cycle</a>
                  </Button>
                ) : (
                  <Button asChild>
                    <a href="/performance/feedback/requests?ask=1">Request feedback</a>
                  </Button>
                )}
              </>
            }
          />
          {data.stats.length === 0 ? null : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.stats.map((s) => (
                <Stat
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  description={s.detail}
                  {...(s.warning === true ? { sentiment: 'negative' as const } : {})}
                />
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle level={2}>You owe</CardTitle>
              </CardHeader>
              <CardContent>
                {data.tasks.length === 0 ? (
                  <EmptyState
                    icon={<icons.success aria-hidden />}
                    title="Nothing needs you"
                    description="Reviews to write, nominations and learning due land here and in your Inbox."
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                    {data.tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 py-3">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <To href={t.link} onNavigate={props.onNavigate}>
                            {t.title}
                          </To>
                          <span className="text-sm text-fg-muted">
                            {[t.summary, t.due === null ? null : `due ${day(t.due)}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        {t.tone === 'danger' ? (
                          <Badge size="sm" tone="danger">
                            Overdue
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle level={2}>Owed to you</CardTitle>
                  <To href="/performance/reviews/owed" onNavigate={props.onNavigate}>
                    All
                  </To>
                </CardHeader>
                <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.owed.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Nobody is writing about you in a running cycle.
                    </p>
                  ) : (
                    data.owed.map((o) => (
                      <div key={o.id} className="flex items-center gap-3 py-2.5">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{`${kindLabel(o.kind)}${o.from === null ? '' : ` · ${o.from}`}`}</span>
                          <span className="text-sm text-fg-muted">{`${o.cycle} · ${o.released === null ? 'You see it when it is released' : `Released ${day(o.released)}`}`}</span>
                        </span>
                        <ReviewBadge state={o.state} />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle level={2}>My goals</CardTitle>
                  <To href="/performance/goals" onNavigate={props.onNavigate}>
                    All goals
                  </To>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.goals.length === 0 ? (
                    <p className="text-sm text-fg-muted">No goals for this period yet.</p>
                  ) : (
                    data.goals.map((g) => {
                      const [label, tone] = CONFIDENCE[g.confidence] ?? ['On track', 'success'];
                      return (
                        <div key={g.id} className="flex flex-col gap-1.5">
                          <span className="flex items-center gap-2">
                            <To
                              href={`/performance/goals/${g.id}`}
                              onNavigate={props.onNavigate}
                              className="min-w-0 flex-1 truncate font-medium hover:underline"
                            >
                              {g.title}
                            </To>
                            <Badge size="sm" tone={tone}>
                              {label}
                            </Badge>
                          </span>
                          <Progress
                            value={g.progress}
                            label={`${g.title}: ${String(g.progress)}%`}
                          />
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
          {data.hr ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle level={2}>Cycles you own</CardTitle>
                <Live />
              </CardHeader>
              <CardContent>
                {data.running.length === 0 ? (
                  <EmptyState
                    icon={<icons.review aria-hidden />}
                    title="No cycle is running"
                    description="Start one from Cycles; it updates here as reviews come in."
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                    {data.running.map((c) => (
                      <li
                        key={c.id}
                        className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 py-3"
                      >
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="flex items-center gap-2">
                            <To href={`/performance/cycles/${c.id}`} onNavigate={props.onNavigate}>
                              {c.name}
                            </To>
                            <CycleBadge state={c.state} />
                          </span>
                          <span className="text-sm text-fg-muted">{`${c.who} · from ${day(c.start)}`}</span>
                        </span>
                        {c.state === 'in_progress' ? (
                          <Progress
                            value={c.progress}
                            label={`${c.name}: ${String(c.progress)}% submitted`}
                          />
                        ) : c.state === 'launch_failed' ? (
                          <Button size="sm" variant="secondary" asChild>
                            <a href={`/performance/cycles/${c.id}`}>Retry launch</a>
                          </Button>
                        ) : (
                          <span className="text-sm text-fg-muted">{words(c.state)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </Loaded>
  );
}
