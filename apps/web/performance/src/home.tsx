import {
  Badge,
  Button,
  EmptyState,
  List,
  ListItem,
  PageHeader,
  Progress,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  icons,
  Widget,
  WidgetGrid,
  WIDGET_LIMIT,
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
import { t as tr } from './i18n';

/**
 * PF1 and PF1b (v2): what the person owes, what is owed to them and their
 * goals; HR also sees the cycles they own, live. Every number is Performance's.
 * Each widget shows its top five as its filter and sort cut them (in the
 * address), what they add up to above the rows, and See all only when there
 * are more.
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
    /** Where the figure is worked on. */
    readonly href?: string;
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

export const CONFIDENCE = (): Readonly<
  Record<string, readonly [string, 'success' | 'warning' | 'danger' | 'accent']>
> => ({
  on_track: [tr('home.on_track', 'On track'), 'success'],
  at_risk: [tr('home.at_risk', 'At risk'), 'warning'],
  off_track: [tr('home.off_track', 'Off track'), 'danger'],
  done: [tr('home.done', 'Done'), 'accent'],
});

type Props = ScreenProps<HomeData>;

const pick = <T extends string>(all: readonly T[], value: string | undefined, fallback: T): T =>
  all.find((v) => v === value) ?? fallback;

/** A widget's "See all", only when it holds more than it shows. */
function SeeAll({
  count,
  href,
  props,
}: {
  readonly count: number;
  readonly href: string;
  readonly props: Props;
}): JSX.Element | undefined {
  if (count <= WIDGET_LIMIT) return undefined;
  return (
    <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
      <To href={href} onNavigate={props.onNavigate} className="">
        {tr('home.see_all', 'See all {{count}}', { count: String(count) })}
      </To>
    </Button>
  );
}

/** One widget's cut: a filter of a few values and a sort, both in the address. */
function Cut<F extends string, S extends string>({
  props,
  label,
  filterKey,
  filters,
  filter,
  sortKey,
  sorts,
  sort,
}: {
  readonly props: Props;
  readonly label: string;
  readonly filterKey: string;
  readonly filters: Readonly<Record<F, string>>;
  readonly filter: F;
  readonly sortKey: string;
  readonly sorts: Readonly<Record<S, string>>;
  readonly sort: S;
}): JSX.Element {
  const [firstFilter] = Object.keys(filters) as F[];
  const [firstSort] = Object.keys(sorts) as S[];
  return (
    <>
      <SegmentedControl
        size="sm"
        aria-label={tr('home.show_label', 'Show {{label}}', { label })}
        value={filter}
        onValueChange={(v) => {
          if (v !== '') props.onFilter?.({ [filterKey]: v === firstFilter ? null : v });
        }}
      >
        {(Object.keys(filters) as F[]).map((f) => (
          <SegmentedControlItem key={f} value={f}>
            {filters[f]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <Select
        value={sort}
        onValueChange={(v) => props.onFilter?.({ [sortKey]: v === firstSort ? null : v })}
      >
        <SelectTrigger
          size="sm"
          aria-label={tr('home.sort_label', 'Sort {{label}}', { label })}
          className="ms-auto w-auto"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(sorts) as S[]).map((o) => (
            <SelectItem key={o} value={o}>
              {sorts[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

const WEEK = 7 * 86_400_000;

function Tasks({ data, props }: { readonly data: HomeData; readonly props: Props }): JSX.Element {
  type Task = HomeData['tasks'][number];
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + WEEK).toISOString().slice(0, 10);
  const late = (t: Task): boolean => t.tone === 'danger' || (t.due !== null && t.due < today);
  const soon = (t: Task): boolean => !late(t) && t.due !== null && t.due <= week;
  const FILTERS = {
    all: tr('home.filter_all', 'All'),
    overdue: tr('home.filter_overdue', 'Overdue'),
    week: tr('home.filter_this_week', 'This week'),
  };
  const SORTS = {
    due: tr('home.sort_due', 'Due first'),
    title: tr('home.sort_title', 'Title, A–Z'),
  };
  const filter = pick(
    Object.keys(FILTERS) as (keyof typeof FILTERS)[],
    props.search?.['tasks'],
    'all',
  );
  const sort = pick(
    Object.keys(SORTS) as (keyof typeof SORTS)[],
    props.search?.['taskSort'],
    'due',
  );
  const shown = data.tasks
    .filter((t) => (filter === 'overdue' ? late(t) : filter === 'week' ? soon(t) || late(t) : true))
    .toSorted(
      sort === 'title'
        ? (a, b) => a.title.localeCompare(b.title)
        : (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'),
    );
  const overdue = shown.filter(late).length;
  const thisWeek = shown.filter(soon).length;
  return (
    <Widget
      title={tr('home.assigned_to_you', 'Assigned to you')}
      description={tr('home.from_the_inbox', 'From the Inbox, for Performance')}
      icon={<icons.review aria-hidden />}
      tone="chart-1"
      {...(shown.length === 0 ? {} : { meta: shown.length })}
      action={<SeeAll count={shown.length} href="/inbox?source=performance" props={props} />}
      toolbar={
        data.tasks.length === 0 ? undefined : (
          <Cut
            props={props}
            label={tr('home.tasks_lower', 'tasks')}
            filterKey="tasks"
            filters={FILTERS}
            filter={filter}
            sortKey="taskSort"
            sorts={SORTS}
            sort={sort}
          />
        )
      }
      insight={
        shown.length === 0 ? undefined : (
          <Progress
            label={tr('home.tasks_by_when', 'Tasks by when they are due')}
            max={shown.length}
            showValue
            valueLabel={tr('home.waiting', '{{count}} waiting', { count: String(shown.length) })}
            segments={[
              {
                value: overdue,
                label: tr('home.overdue_count', '{{count}} overdue', { count: String(overdue) }),
                tone: 'chart-5',
              },
              {
                value: thisWeek,
                label: tr('home.this_week_count', '{{count}} this week', {
                  count: String(thisWeek),
                }),
                tone: 'chart-4',
              },
              {
                value: shown.length - overdue - thisWeek,
                label: tr('home.later_count', '{{count}} later', {
                  count: String(shown.length - overdue - thisWeek),
                }),
                tone: 'chart-1',
              },
            ]}
          />
        )
      }
      span={2}
      flush={shown.length > 0}
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={<icons.success aria-hidden />}
          title={
            data.tasks.length === 0
              ? tr('home.nothing_needs_you', 'Nothing needs you')
              : tr('home.none_of_these', 'None of these')
          }
          description={tr(
            'home.reviews_to_write_nominations_and_learning',
            'Reviews to write, nominations and learning due land here and in your Inbox.',
          )}
        />
      ) : (
        <List aria-label={tr('home.assigned_to_you', 'Assigned to you')}>
          {shown.slice(0, WIDGET_LIMIT).map((t) => (
            <ListItem
              key={t.id}
              asChild
              chevron
              icon={<icons.review aria-hidden />}
              iconTone={late(t) ? 'chart-5' : 'chart-1'}
              {...(t.summary === null ? {} : { description: t.summary })}
              {...(t.due === null
                ? {}
                : { meta: tr('home.due', 'due {{due}}', { due: day(t.due) }) })}
              trailing={
                late(t) ? (
                  <Badge size="sm" tone="danger">
                    {tr('home.overdue', 'Overdue')}
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
    </Widget>
  );
}

function AboutYou({
  data,
  props,
}: {
  readonly data: HomeData;
  readonly props: Props;
}): JSX.Element {
  const FILTERS = {
    all: tr('home.filter_all', 'All'),
    released: tr('home.filter_released', 'Released'),
    writing: tr('home.filter_being_written', 'Being written'),
  };
  const SORTS = {
    newest: tr('home.sort_newest', 'Newest'),
    cycle: tr('home.sort_cycle', 'By cycle'),
  };
  const filter = pick(
    Object.keys(FILTERS) as (keyof typeof FILTERS)[],
    props.search?.['reviews'],
    'all',
  );
  const sort = pick(
    Object.keys(SORTS) as (keyof typeof SORTS)[],
    props.search?.['reviewSort'],
    'newest',
  );
  const shown = data.owed
    .filter((o) =>
      filter === 'released'
        ? o.released !== null
        : filter === 'writing'
          ? o.released === null
          : true,
    )
    .toSorted(
      sort === 'cycle'
        ? (a, b) => a.cycle.localeCompare(b.cycle)
        : (a, b) => (b.released ?? '9999').localeCompare(a.released ?? '9999'),
    );
  const released = shown.filter((o) => o.released !== null).length;
  return (
    <Widget
      title={tr('home.reviews_about_you', 'Reviews about you')}
      description={tr('home.in_running_cycles', 'In the cycles running now')}
      icon={<icons.person aria-hidden />}
      tone="chart-2"
      {...(shown.length === 0 ? {} : { meta: shown.length })}
      action={<SeeAll count={shown.length} href="/performance/reviews/owed" props={props} />}
      toolbar={
        data.owed.length === 0 ? undefined : (
          <Cut
            props={props}
            label={tr('home.reviews_lower', 'reviews')}
            filterKey="reviews"
            filters={FILTERS}
            filter={filter}
            sortKey="reviewSort"
            sorts={SORTS}
            sort={sort}
          />
        )
      }
      insight={
        shown.length === 0 ? undefined : (
          <Progress
            label={tr('home.reviews_released', 'Reviews released to you')}
            max={shown.length}
            showValue
            valueLabel={tr('home.released_of', '{{released}} of {{count}} released', {
              released: String(released),
              count: String(shown.length),
            })}
            segments={[
              {
                value: released,
                label: tr('home.released_count', '{{count}} released', {
                  count: String(released),
                }),
                tone: 'chart-2',
              },
              {
                value: shown.length - released,
                label: tr('home.writing_count', '{{count}} being written', {
                  count: String(shown.length - released),
                }),
                tone: 'chart-6',
                pattern: 'hatched',
              },
            ]}
          />
        )
      }
      span={2}
      flush={shown.length > 0}
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={<icons.person aria-hidden />}
          title={tr('home.nothing_about_you', 'Nothing about you yet')}
          description={tr(
            'home.nobody_is_writing_about_you_in',
            'Nobody is writing about you in a running cycle.',
          )}
        />
      ) : (
        <List aria-label={tr('home.reviews_about_you', 'Reviews about you')}>
          {shown.slice(0, WIDGET_LIMIT).map((o) => (
            <ListItem
              key={o.id}
              icon={<icons.person aria-hidden />}
              iconTone="chart-2"
              description={o.cycle}
              meta={
                o.released === null
                  ? tr('home.seen_when_released', 'You see it when it is released')
                  : tr('home.released_on', 'Released {{day}}', { day: day(o.released) })
              }
              trailing={<ReviewBadge state={o.state} />}
            >
              {`${kindLabel(o.kind)}${o.from === null ? '' : ` · ${o.from}`}`}
            </ListItem>
          ))}
        </List>
      )}
    </Widget>
  );
}

function Goals({ data, props }: { readonly data: HomeData; readonly props: Props }): JSX.Element {
  const confidence = CONFIDENCE();
  const FILTERS = {
    all: tr('home.filter_all', 'All'),
    risk: tr('home.filter_at_risk', 'At risk'),
    track: tr('home.on_track', 'On track'),
  };
  const SORTS = {
    least: tr('home.sort_least_progress', 'Least progress'),
    most: tr('home.sort_most_progress', 'Most progress'),
    title: tr('home.sort_title', 'Title, A–Z'),
  };
  const filter = pick(
    Object.keys(FILTERS) as (keyof typeof FILTERS)[],
    props.search?.['goals'],
    'all',
  );
  const sort = pick(
    Object.keys(SORTS) as (keyof typeof SORTS)[],
    props.search?.['goalSort'],
    'least',
  );
  const risky = (c: string): boolean => c === 'at_risk' || c === 'off_track';
  const shown = data.goals
    .filter((g) =>
      filter === 'risk' ? risky(g.confidence) : filter === 'track' ? !risky(g.confidence) : true,
    )
    .toSorted(
      sort === 'title'
        ? (a, b) => a.title.localeCompare(b.title)
        : sort === 'most'
          ? (a, b) => b.progress - a.progress
          : (a, b) => a.progress - b.progress,
    );
  const average =
    shown.length === 0 ? 0 : Math.round(shown.reduce((n, g) => n + g.progress, 0) / shown.length);
  const count = (keys: readonly string[]): number =>
    shown.filter((g) => keys.includes(g.confidence)).length;
  return (
    <Widget
      title={tr('home.your_goals', 'Your goals')}
      description={tr('home.active_this_period', 'Active this period')}
      icon={<icons.goal aria-hidden />}
      tone="chart-4"
      {...(shown.length === 0 ? {} : { meta: shown.length })}
      action={<SeeAll count={shown.length} href="/performance/goals" props={props} />}
      toolbar={
        data.goals.length === 0 ? undefined : (
          <Cut
            props={props}
            label={tr('home.goals_lower', 'goals')}
            filterKey="goals"
            filters={FILTERS}
            filter={filter}
            sortKey="goalSort"
            sorts={SORTS}
            sort={sort}
          />
        )
      }
      insight={
        shown.length === 0 ? undefined : (
          <Progress
            label={tr('home.goals_by_confidence', 'Goals by confidence')}
            max={shown.length}
            showValue
            valueLabel={tr('home.average_progress', '{{average}}% on average', {
              average: String(average),
            })}
            segments={[
              {
                value: count(['on_track', 'done']),
                label: tr('home.on_track_count', '{{count}} on track', {
                  count: String(count(['on_track', 'done'])),
                }),
                tone: 'chart-2',
              },
              {
                value: count(['at_risk']),
                label: tr('home.at_risk_count', '{{count}} at risk', {
                  count: String(count(['at_risk'])),
                }),
                tone: 'chart-4',
              },
              {
                value: count(['off_track']),
                label: tr('home.off_track_count', '{{count}} off track', {
                  count: String(count(['off_track'])),
                }),
                tone: 'chart-5',
              },
            ]}
          />
        )
      }
      span={2}
      flush={shown.length > 0}
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={<icons.goal aria-hidden />}
          title={
            data.goals.length === 0
              ? tr('home.no_goals_for_this_period_yet', 'No goals for this period yet.')
              : tr('home.none_of_these', 'None of these')
          }
          action={
            <Button asChild size="sm" variant="secondary">
              <To href="/performance/goals" onNavigate={props.onNavigate} className="">
                {tr('home.open_goals', 'Open goals')}
              </To>
            </Button>
          }
        />
      ) : (
        <List aria-label={tr('home.your_goals', 'Your goals')}>
          {shown.slice(0, WIDGET_LIMIT).map((g) => {
            const [label, tone] = confidence[g.confidence] ?? [
              tr('home.on_track', 'On track'),
              'success',
            ];
            return (
              <ListItem
                key={g.id}
                asChild
                chevron
                icon={<icons.goal aria-hidden />}
                iconTone="chart-4"
                description={tr('home.progress_done', '{{progress}}% done', {
                  progress: String(g.progress),
                })}
                trailing={
                  <Badge size="sm" tone={tone}>
                    {label}
                  </Badge>
                }
              >
                <To href={`/performance/goals/${g.id}`} onNavigate={props.onNavigate}>
                  {g.title}
                </To>
              </ListItem>
            );
          })}
        </List>
      )}
    </Widget>
  );
}

function Cycles({ data, props }: { readonly data: HomeData; readonly props: Props }): JSX.Element {
  const FILTERS = {
    all: tr('home.filter_all', 'All'),
    running: tr('home.filter_running', 'Running'),
    upcoming: tr('home.filter_upcoming', 'Upcoming'),
  };
  const SORTS = {
    start: tr('home.sort_start', 'Starts latest'),
    behind: tr('home.sort_behind', 'Furthest behind'),
    name: tr('home.sort_name', 'Name, A–Z'),
  };
  const filter = pick(
    Object.keys(FILTERS) as (keyof typeof FILTERS)[],
    props.search?.['cycles'],
    'all',
  );
  const sort = pick(
    Object.keys(SORTS) as (keyof typeof SORTS)[],
    props.search?.['cycleSort'],
    'start',
  );
  const shown = data.running
    .filter((c) =>
      filter === 'running'
        ? c.state === 'in_progress'
        : filter === 'upcoming'
          ? c.state !== 'in_progress'
          : true,
    )
    .toSorted(
      sort === 'name'
        ? (a, b) => a.name.localeCompare(b.name)
        : sort === 'behind'
          ? (a, b) => a.progress - b.progress
          : (a, b) => b.start.localeCompare(a.start),
    );
  const live = shown.filter((c) => c.state === 'in_progress');
  const average =
    live.length === 0 ? 0 : Math.round(live.reduce((n, c) => n + c.progress, 0) / live.length);
  return (
    <Widget
      title={tr('home.cycles_you_own', 'Cycles you own')}
      description={tr('home.updates_as_reviews_come_in', 'Updates as reviews come in')}
      icon={<icons.calendar aria-hidden />}
      tone="chart-3"
      meta={<Live />}
      action={<SeeAll count={shown.length} href="/performance/cycles" props={props} />}
      toolbar={
        data.running.length === 0 ? undefined : (
          <Cut
            props={props}
            label={tr('home.cycles_lower', 'cycles')}
            filterKey="cycles"
            filters={FILTERS}
            filter={filter}
            sortKey="cycleSort"
            sorts={SORTS}
            sort={sort}
          />
        )
      }
      insight={
        live.length === 0 ? undefined : (
          <Progress
            label={tr('home.reviews_submitted_on_average', 'Reviews submitted, on average')}
            value={average}
            showValue
            valueLabel={tr(
              'home.submitted_average',
              '{{average}}% submitted across {{count}} running',
              {
                average: String(average),
                count: String(live.length),
              },
            )}
          />
        )
      }
      span={2}
      flush={shown.length > 0}
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={<icons.review aria-hidden />}
          title={
            data.running.length === 0
              ? tr('home.no_cycle_is_running', 'No cycle is running')
              : tr('home.none_of_these', 'None of these')
          }
          description={tr(
            'home.start_one_from_cycles_it_updates',
            'Start one from Cycles; it updates here as reviews come in.',
          )}
        />
      ) : (
        <List aria-label={tr('home.cycles_you_own', 'Cycles you own')}>
          {shown.slice(0, WIDGET_LIMIT).map((c) => (
            <ListItem
              key={c.id}
              asChild
              chevron
              icon={<icons.calendar aria-hidden />}
              iconTone="chart-3"
              description={tr('home.from', '{{who}} · from {{start}}', {
                who: c.who,
                start: day(c.start),
              })}
              meta={<CycleBadge state={c.state} />}
              trailing={
                c.state === 'in_progress' ? (
                  <span className="w-28">
                    <Progress
                      value={c.progress}
                      showValue
                      label={tr('home.submitted', '{{name}}: {{progress}}% submitted', {
                        name: c.name,
                        progress: String(c.progress),
                      })}
                    />
                  </span>
                ) : (
                  <span className="text-sm">
                    {c.state === 'launch_failed'
                      ? tr('home.retry_launch', 'Retry launch')
                      : words(c.state)}
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
    </Widget>
  );
}

/** A figure's glyph, by where it is worked on. */
const STAT_ICON = (href: string | undefined): JSX.Element =>
  href?.startsWith('/performance/feedback') === true ? (
    <icons.message aria-hidden />
  ) : (
    <icons.review aria-hidden />
  );

export function Home(props: ScreenProps<HomeData>): JSX.Element {
  const act = useAct(props);
  return (
    <Loaded load={props.load} what={tr('home.performance', 'Performance')}>
      {(data) => (
        <div className="flex flex-col gap-5">
          <PageHeader
            title={tr('home.performance', 'Performance')}
            description={
              data.hr
                ? tr(
                    'home.reviews_feedback_goals_and_learning_as_hr',
                    'Reviews, feedback, goals and learning. As HR.',
                  )
                : tr(
                    'home.reviews_feedback_goals_and_learning',
                    'Reviews, feedback, goals and learning.',
                  )
            }
            actions={
              <>
                <Button variant="secondary" asChild>
                  <a href="/performance/feedback?give=1">
                    {tr('home.give_feedback', 'Give feedback')}
                  </a>
                </Button>
                {data.hr ? (
                  <Button
                    variant="primary"
                    loading={act.pending}
                    onClick={() => {
                      // Straight into setup: its Basics step names the cycle and sets its start.
                      act.run(
                        'CreatePerformanceCycle',
                        {
                          input: {
                            name: tr('home.new_cycle', 'New cycle'),
                            start: null,
                            copyFrom: null,
                          },
                        },
                        (d) => {
                          props.onNavigate?.(
                            `/performance/cycles/${(d as { id: string }).id}/setup`,
                          );
                        },
                      );
                    }}
                  >
                    {tr('home.new_cycle', 'New cycle')}
                  </Button>
                ) : (
                  <Button asChild variant="primary">
                    <a href="/performance/feedback/requests?ask=1">
                      {tr('home.request_feedback', 'Request feedback')}
                    </a>
                  </Button>
                )}
              </>
            }
          />
          <Refusal error={act.error} />
          {/* The figures: tiles of one size, never stretched to the row. */}
          {data.stats.length === 0 ? null : (
            <WidgetGrid size="sm">
              {data.stats.map((s) => (
                <Stat
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  icon={STAT_ICON(s.href)}
                  description={s.detail}
                  {...(s.href === undefined ? {} : { href: s.href })}
                  {...(s.warning === true ? { sentiment: 'negative' as const } : {})}
                />
              ))}
            </WidgetGrid>
          )}
          <WidgetGrid>
            <Tasks data={data} props={props} />
            <AboutYou data={data} props={props} />
            <Goals data={data} props={props} />
            {data.hr ? <Cycles data={data} props={props} /> : null}
          </WidgetGrid>
        </div>
      )}
    </Loaded>
  );
}
