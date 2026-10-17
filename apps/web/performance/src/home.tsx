import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  List,
  ListItem,
  PageHeader,
  Progress,
  Stat,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded } from './load';
import {
  CycleBadge,
  Live,
  Refusal,
  ReviewBadge,
  To,
  day,
  kindLabel,
  useAct,
  words,
} from './shared';
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
  const act = useAct(props);
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
                  <Button
                    loading={act.pending}
                    onClick={() => {
                      // Straight into setup: its Basics step names the cycle and sets its start.
                      act.run(
                        'CreatePerformanceCycle',
                        { input: { name: 'New cycle', start: null, copyFrom: null } },
                        (d) => {
                          props.onNavigate?.(
                            `/performance/cycles/${(d as { id: string }).id}/setup`,
                          );
                        },
                      );
                    }}
                  >
                    New cycle
                  </Button>
                ) : (
                  <Button asChild>
                    <a href="/performance/feedback/requests?ask=1">Request feedback</a>
                  </Button>
                )}
              </>
            }
          />
          <Refusal error={act.error} />
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
                  <List>
                    {data.tasks.map((t) => (
                      <ListItem
                        key={t.id}
                        asChild
                        chevron
                        description={[t.summary, t.due === null ? null : `due ${day(t.due)}`]
                          .filter(Boolean)
                          .join(' · ')}
                        trailing={
                          t.tone === 'danger' ? (
                            <Badge size="sm" tone="danger">
                              Overdue
                            </Badge>
                          ) : null
                        }
                      >
                        <To href={t.link} onNavigate={props.onNavigate}>
                          {t.title}
                        </To>
                      </ListItem>
                    ))}
                  </List>
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
                <CardContent>
                  {data.owed.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Nobody is writing about you in a running cycle.
                    </p>
                  ) : (
                    <List>
                      {data.owed.map((o) => (
                        <ListItem
                          key={o.id}
                          description={`${o.cycle} · ${o.released === null ? 'You see it when it is released' : `Released ${day(o.released)}`}`}
                          trailing={<ReviewBadge state={o.state} />}
                        >
                          {`${kindLabel(o.kind)}${o.from === null ? '' : ` · ${o.from}`}`}
                        </ListItem>
                      ))}
                    </List>
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
                  <List>
                    {data.running.map((c) => (
                      <ListItem
                        key={c.id}
                        asChild
                        chevron
                        description={`${c.who} · from ${day(c.start)}`}
                        meta={<CycleBadge state={c.state} />}
                        trailing={
                          c.state === 'in_progress' ? (
                            <span className="w-32">
                              <Progress
                                value={c.progress}
                                label={`${c.name}: ${String(c.progress)}% submitted`}
                              />
                            </span>
                          ) : (
                            <span className="text-sm">
                              {c.state === 'launch_failed' ? 'Retry launch' : words(c.state)}
                            </span>
                          )
                        }
                      >
                        <To href={`/performance/cycles/${c.id}`} onNavigate={props.onNavigate}>
                          {c.name}
                        </To>
                      </ListItem>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </Loaded>
  );
}
