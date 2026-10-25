import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  type DataColumn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Kanban,
  ModalPage,
  ModalPageContent,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import { useEffect, useLayoutEffect, useMemo, useState, type JSX } from 'react';

import { Loaded } from './load';
import { RejectDialog, type Rejecting } from './reject-dialog';
import { Spotlight } from './candidate';
import { JobConfirm, jobCommands, type Confirming } from './job-actions';
import {
  CATEGORY_TONE,
  MoreMenu,
  Refusal,
  Search,
  StateBadge,
  To,
  day,
  useAct,
  when,
  words,
} from './shared';
import type { Card as CardData, PipelineData, ScreenProps } from './types';
import { t } from './i18n';

/**
 * R10, a job's pipeline (design R10–R10d): a board by stage or a table, the
 * view and every filter in the address. A move asks only what it needs and
 * can be undone for ten seconds; rejecting asks a reason, an email and when
 * to send it; several candidates at once from the table.
 */

const UNDO_SECONDS = 10;

interface Rediscovered {
  readonly candidateId: string;
  readonly name: string;
  readonly band: 'strong' | 'good' | 'weak';
}

function CandidateCard({
  card,
  href,
  onOpen,
}: {
  readonly card: CardData;
  readonly href: string;
  readonly onOpen: () => void;
}): JSX.Element {
  // The ideal candidate (PRD §22.4, a strong match on every must): the board's border says it, this names it.
  const ideal = card.match?.band === 'strong';
  const owed =
    card.scorecards === undefined ? 0 : card.scorecards.expected - card.scorecards.submitted;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Avatar name={card.name} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            className="font-semibold text-fg hover:underline [overflow-wrap:anywhere]"
          >
            {card.name}
          </a>
          <span
            className={
              card.daysInStage > 4
                ? 'text-xs text-[var(--reach-warning-text)] tabular-nums'
                : 'text-xs text-fg-muted tabular-nums'
            }
          >
            {t('pipeline.d_in_stage', '{{daysInStage}} d in stage', {
              daysInStage: String(card.daysInStage),
            })}
          </span>
        </span>
        {card.unread > 0 ? (
          <Badge
            size="sm"
            tone="accent"
            aria-label={t('pipeline.unread', '{{unread}} unread', { unread: String(card.unread) })}
          >
            {card.unread}
          </Badge>
        ) : null}
      </div>
      {ideal || card.match != null || card.flagged || card.duplicate ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {ideal ? (
            <Badge size="sm" tone="success" variant="soft">
              <icons.starred aria-hidden className="size-3 fill-current" />
              {t('pipeline.ideal_candidate', 'Ideal candidate')}
            </Badge>
          ) : card.match == null ? null : (
            <Badge
              size="sm"
              tone={card.match.band === 'good' ? 'accent' : 'neutral'}
              variant="soft"
              aria-label={t('pipeline.ai_match_percent', 'AI match {{round}} percent, {{band}}', {
                round: String(Math.round(card.match.scoreBp / 100)),
                band: card.match.band,
              })}
            >
              {t('pipeline.match', '{{round}}% match', {
                round: String(Math.round(card.match.scoreBp / 100)),
              })}
            </Badge>
          )}
          {card.flagged ? (
            <Badge size="sm" tone="warning">
              {t('pipeline.knockout_to_review', 'Knockout to review')}
            </Badge>
          ) : null}
          {card.duplicate ? (
            <Badge size="sm" tone="info">
              {t('pipeline.possible_duplicate', 'Possible duplicate')}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {card.nextInterview === null && owed <= 0 ? null : (
        <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-fg-muted">
          {card.nextInterview === null ? null : (
            <span className="flex items-center gap-1.5">
              <icons.meeting aria-hidden className="size-3.5" />
              {t('pipeline.text', '{{title}} {{startsAt}}', {
                title: card.nextInterview.title,
                startsAt: when(card.nextInterview.startsAt),
              })}
            </span>
          )}
          {owed <= 0 ? null : (
            <span className="flex items-center gap-1.5 text-[var(--reach-warning-text)]">
              <icons.assessment aria-hidden className="size-3.5" />
              {t(
                'pipeline.scorecards_owed',
                { one: '{{count}} scorecard owed', other: '{{count}} scorecards owed' },
                { count: owed },
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The board's height: from its top to the window's bottom, so each column scrolls on its own. */
function useFillHeight(): {
  readonly ref: (node: HTMLDivElement | null) => void;
  readonly height: number | null;
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (node === null) return undefined;
    const measure = (): void => {
      setHeight(Math.max(420, window.innerHeight - node.getBoundingClientRect().top - 24));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [node]);
  return { ref: setNode, height };
}

/** The ten seconds after a move, as a bar the move can be undone from. */
function UndoBar({
  undo,
  onUndo,
}: {
  readonly undo: { name: string; stage: string } | null;
  readonly onUndo: () => void;
}): JSX.Element | null {
  const [left, setLeft] = useState(UNDO_SECONDS);
  useEffect(() => {
    if (undo === null) return undefined;
    setLeft(UNDO_SECONDS);
    const timer = setInterval(() => {
      setLeft((s) => s - 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [undo]);
  if (undo === null || left <= 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl bg-[var(--reach-surface-raised)] p-3 shadow-lg"
    >
      <span className="flex-1">
        {t('pipeline.moved_to', '{{name}} moved to {{stage}}', {
          name: undo.name,
          stage: undo.stage,
        })}
      </span>
      <Button size="sm" variant="secondary" onClick={onUndo}>
        {t('pipeline.undo_s', 'Undo · {{left}} s', { left: String(left) })}
      </Button>
    </div>
  );
}

const NO_STAGES: PipelineData['stages'] = [];
const applicationOf = (c: CardData): string => c.applicationId;
const nameOf = (c: CardData): string => c.name;

/** The table view's columns (R10): the candidate, where they are and since when. */
function pipelineColumns(
  stages: PipelineData['stages'],
  onNavigate: ScreenProps<PipelineData>['onNavigate'],
): readonly DataColumn<CardData>[] {
  return [
    {
      id: 'candidate',
      header: t('pipeline.candidate', 'Candidate'),
      sortBy: (c) => c.name,
      cell: (c) => (
        <To href={`/recruiting/candidates/${c.candidateId}`} onNavigate={onNavigate}>
          {c.name}
        </To>
      ),
    },
    {
      id: 'stage',
      header: t('pipeline.stage', 'Stage'),
      sortBy: (c) => stages.findIndex((s) => s.id === c.stageId),
      cell: (c) => <Badge size="sm">{stages.find((s) => s.id === c.stageId)?.name ?? ''}</Badge>,
    },
    {
      id: 'source',
      header: t('pipeline.source', 'Source'),
      hideOnCard: true,
      sortBy: (c) => c.source,
      cell: (c) => <span className="text-sm text-fg-muted">{words(c.source)}</span>,
    },
    {
      id: 'inStage',
      header: t('pipeline.in_stage', 'In stage'),
      numeric: true,
      sortBy: (c) => c.daysInStage,
      cell: (c) => t('pipeline.d', '{{daysInStage}} d', { daysInStage: String(c.daysInStage) }),
    },
    {
      id: 'next',
      header: t('pipeline.next', 'Next'),
      sortBy: (c) => c.nextInterview?.startsAt ?? '',
      cell: (c) => (
        <span className="text-sm text-fg-muted">
          {c.nextInterview === null ? '' : when(c.nextInterview.startsAt)}
        </span>
      ),
    },
    {
      id: 'applied',
      header: t('pipeline.applied', 'Applied'),
      sortBy: (c) => c.appliedAt,
      cell: (c) => <span className="text-sm text-fg-muted">{day(c.appliedAt)}</span>,
    },
  ];
}

export function Pipeline(props: ScreenProps<PipelineData>): JSX.Element {
  const view = props.search?.['view'] === 'table' ? 'table' : 'board';
  const act = useAct(props);
  const [rejecting, setRejecting] = useState<Rejecting | null>(null);
  const [found, setFound] = useState<readonly Rediscovered[] | null>(null);
  const [asking, setAsking] = useState<{ card: CardData; to: string } | null>(null);
  const [interviewType, setInterviewType] = useState('');
  const [undo, setUndo] = useState<{
    name: string;
    stage: string;
    applicationId: string;
    moveId: string;
  } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moveTo, setMoveTo] = useState('');
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [assessed, setAssessed] = useState<{
    assessed: number;
    skipped: number;
    failed: readonly string[];
  } | null>(null);
  const fill = useFillHeight();
  /*
   * A dropped card stays where it was dropped while the move is saved, rather
   * than going back to its column until the board is read again: the drop is
   * the answer the person sees. Undone if the move is refused; forgotten once
   * the board says the same.
   */
  const [placed, setPlaced] = useState<Readonly<Record<string, string>>>({});
  const unplace = (applicationId: string): void => {
    setPlaced(({ [applicationId]: _gone, ...rest }) => rest);
  };
  useEffect(() => {
    if (props.load.status !== 'ready') return;
    const cards = props.load.data.cards;
    setPlaced((held) => {
      const still = Object.entries(held).filter(
        ([id, to]) => cards.find((c) => c.applicationId === id)?.stageId !== to,
      );
      return still.length === Object.keys(held).length ? held : Object.fromEntries(still);
    });
  }, [props.load]);
  // Held while the stages and the navigation hold, so a selection redraws only its rows.
  const stages = props.load.status === 'ready' ? props.load.data.stages : NO_STAGES;
  const { onNavigate } = props;
  const columns = useMemo(() => pipelineColumns(stages, onNavigate), [stages, onNavigate]);

  return (
    <Loaded load={props.load} what={t('pipeline.the_pipeline', 'the pipeline')}>
      {(data) => {
        const band = props.search?.['band'] ?? '';
        const cards = data.cards.map((c) => {
          const to = placed[c.applicationId];
          return to === undefined ? c : { ...c, stageId: to, daysInStage: 0 };
        });
        const active = cards.filter(
          (c) =>
            c.outcome === 'active' &&
            (band === '' || (band === 'none' ? c.match == null : c.match?.band === band)),
        );
        // The strong matches still at the first stage: one press moves them on (PRD §22.4).
        const first = data.stages[0];
        const second = data.stages[1];
        const strongAtStart =
          first === undefined || second === undefined
            ? []
            : cards.filter(
                (c) =>
                  c.outcome === 'active' && c.stageId === first.id && c.match?.band === 'strong',
              );
        const shown = data.stages.filter((s) => s.category !== 'hired');
        const byStage = Object.fromEntries(
          shown.map((s) => [
            s.id,
            active.filter((c) => c.stageId === s.id).map((c) => ({ ...c, id: c.applicationId })),
          ]),
        );
        // The board's order, column by column: what J and K walk in the spotlight.
        const order = shown.flatMap((s) => byStage[s.id] ?? []);
        const canMove = data.may.includes('pipeline.move');
        const mayEdit = data.may.includes('job.edit');
        const spotHref = (c: CardData): string =>
          `/recruiting/jobs/${data.job.id}?candidate=${c.candidateId}&application=${c.applicationId}`;
        const open = (c: CardData): void => {
          props.onFilter?.({ candidate: c.candidateId, application: c.applicationId });
        };
        const openId = props.search?.['application'];
        const at = order.findIndex((c) => c.applicationId === openId);
        const previous = at > 0 ? order[at - 1] : undefined;
        const following = at >= 0 ? order[at + 1] : undefined;
        const move = (card: CardData, to: string, type?: string): void => {
          const stage = data.stages.find((s) => s.id === to);
          if (stage === undefined) return;
          if (stage.category === 'interview' && type === undefined) {
            setAsking({ card, to });
            return;
          }
          setPlaced((held) => ({ ...held, [card.applicationId]: to }));
          act.run(
            'MoveApplication',
            {
              applicationId: card.applicationId,
              input: { to, ...(type === undefined ? {} : { interviewType: type }) },
            },
            (answer) => {
              const moved = answer as {
                moveId: string;
                opensOffer: boolean;
                offerId?: string | null;
              };
              setUndo({
                name: card.name,
                stage: stage.name,
                applicationId: card.applicationId,
                moveId: moved.moveId,
              });
              // Arriving at the offer stage drafted the offer from the job: open it, filled in.
              if (moved.opensOffer && moved.offerId != null)
                props.onFilter?.({ offer: moved.offerId });
            },
            () => {
              unplace(card.applicationId);
            },
          );
        };
        const job = {
          id: data.job.id,
          title: data.job.title,
          active: active.length,
          archived: (data.job.archivedAt ?? null) !== null,
          may: { edit: mayEdit, archive: mayEdit, delete: mayEdit && data.cards.length === 0 },
        };
        const publish = (): void => {
          const live = (): void => {
            act.run('PublishJob', { jobId: data.job.id, target: 'kithena_jobs' });
          };
          if (data.job.state === 'open') live();
          else act.run('MoveJob', { jobId: data.job.id, input: { to: 'open' } }, live);
        };
        return (
          <div className="flex flex-col gap-3">
            <PageHeader
              title={data.job.title}
              meta={
                <span className="flex items-center gap-2">
                  {job.archived ? (
                    <Badge tone="neutral">{t('pipeline.archived', 'Archived')}</Badge>
                  ) : (
                    <StateBadge state={data.job.state} />
                  )}
                  <span className="text-sm text-fg-muted tabular-nums">
                    {t('pipeline.active_candidates', '{{length}} active candidates', {
                      length: String(active.length),
                    })}
                  </span>
                </span>
              }
              actions={
                <>
                  {/* R7, from the board: open the job if it is a draft, then put it on Kithena Jobs. */}
                  {data.job.onKithenaJobs ? (
                    <Button
                      asChild
                      variant="secondary"
                      startIcon={<icons.externalLink aria-hidden />}
                    >
                      <a href={data.job.publicUrl} target="_blank" rel="noreferrer">
                        {t('pipeline.on_kithena_jobs', 'On Kithena Jobs')}
                      </a>
                    </Button>
                  ) : mayEdit && !job.archived ? (
                    <Button
                      variant="primary"
                      startIcon={<icons.send aria-hidden />}
                      loading={act.pending}
                      onClick={publish}
                    >
                      {data.job.state === 'open'
                        ? t('pipeline.publish_on_kithena_jobs', 'Publish on Kithena Jobs')
                        : t('pipeline.open_and_publish', 'Open and publish')}
                    </Button>
                  ) : null}
                  <MoreMenu
                    label={t('pipeline.more_for_the_job', 'More for {{title}}', {
                      title: data.job.title,
                    })}
                    items={[
                      ...jobCommands(job, {
                        onNavigate: props.onNavigate,
                        onConfirm: setConfirming,
                        act,
                      }),
                      {
                        id: 'assess',
                        label: t('pipeline.read_everyone_with_ai', 'Read everyone with AI'),
                        icon: <icons.assistant aria-hidden />,
                        hidden: !mayEdit,
                        group: 'ai',
                        onSelect: () => {
                          act.run('AssessJob', { jobId: data.job.id }, (done) => {
                            setAssessed(done as typeof assessed);
                          });
                        },
                      },
                      {
                        id: 'rediscover',
                        label: t('pipeline.rediscover_from_pools', 'Rediscover from pools'),
                        icon: <icons.people aria-hidden />,
                        hidden: !mayEdit,
                        group: 'ai',
                        onSelect: () => {
                          act.run('Rediscover', { jobId: data.job.id }, (got) => {
                            setFound(got as readonly Rediscovered[]);
                          });
                        },
                      },
                    ]}
                  />
                </>
              }
            />
            {assessed === null ? null : (
              <Alert
                tone={assessed.failed.length === 0 ? 'success' : 'warning'}
                title={t(
                  'pipeline.read_against_the_criteria_already_were',
                  '{{assessed}} read against the criteria, {{skipped}} already were',
                  { assessed: String(assessed.assessed), skipped: String(assessed.skipped) },
                )}
                onDismiss={() => {
                  setAssessed(null);
                }}
              >
                {assessed.failed.length === 0
                  ? t(
                      'pipeline.a_label_on_each_card_not',
                      'A label on each card, not a decision: every finding cites the CV and a person agrees or not.',
                    )
                  : t('pipeline.could_not_be_read', '{{length}} could not be read: {{join}}', {
                      length: String(assessed.failed.length),
                      join: [...new Set(assessed.failed)].join('; '),
                    })}
              </Alert>
            )}
            {found === null ? null : (
              <Alert
                tone="info"
                title={t('pipeline.from_your_talent_pools', 'From your talent pools')}
                onDismiss={() => {
                  setFound(null);
                }}
              >
                {found.length === 0 ? (
                  t('pipeline.nobody_in_the_pools_yet', 'Nobody in the pools yet')
                ) : (
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {found.map((r) => (
                      <li key={r.candidateId} className="flex items-center gap-2">
                        <To
                          href={`/recruiting/candidates/${r.candidateId}`}
                          onNavigate={props.onNavigate}
                        >
                          {r.name}
                        </To>
                        <Badge size="sm" tone="neutral">
                          {t('pipeline.match_2', '{{band}} match', { band: words(r.band) })}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
            {/* The toolbar: find, order, filter, and the view; nothing here is a header button. */}
            <div className="flex flex-wrap items-center gap-2">
              <Search
                label={t('pipeline.search_candidates', 'Search candidates')}
                placeholder={t('pipeline.search_by_name', 'Search by name')}
                initial={props.search?.['q'] ?? ''}
                onSearch={(q) => props.onFilter?.({ q: q === '' ? null : q })}
                className="w-60"
              />
              <Select
                value={props.search?.['sort'] ?? 'newest'}
                onValueChange={(v) => props.onFilter?.({ sort: v === 'newest' ? null : v })}
              >
                <SelectTrigger aria-label={t('pipeline.sort', 'Sort')} className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">
                    {t('pipeline.newest_first', 'Newest first')}
                  </SelectItem>
                  <SelectItem value="days">
                    {t('pipeline.longest_in_stage', 'Longest in stage')}
                  </SelectItem>
                  <SelectItem value="name">{t('pipeline.name', 'Name')}</SelectItem>
                  <SelectItem value="match">
                    {t('pipeline.match_strongest_first', 'Match, strongest first')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={band === '' ? 'any' : band}
                onValueChange={(v) => props.onFilter?.({ band: v === 'any' ? null : v })}
              >
                <SelectTrigger aria-label={t('pipeline.ai_match', 'AI match')} className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('pipeline.any_match', 'Any match')}</SelectItem>
                  <SelectItem value="strong">
                    {t('pipeline.ideal_candidates', 'Ideal candidates')}
                  </SelectItem>
                  <SelectItem value="good">{t('pipeline.good_matches', 'Good matches')}</SelectItem>
                  <SelectItem value="weak">{t('pipeline.weak_matches', 'Weak matches')}</SelectItem>
                  <SelectItem value="none">{t('pipeline.not_read_yet', 'Not read yet')}</SelectItem>
                </SelectContent>
              </Select>
              {strongAtStart.length > 0 && canMove && second !== undefined ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={act.pending}
                  startIcon={<icons.starred aria-hidden />}
                  onClick={() => {
                    act.run('BulkApplications', {
                      input: {
                        action: 'move',
                        ids: strongAtStart.map((c) => c.applicationId),
                        to: second.id,
                      },
                    });
                  }}
                >
                  {t('pipeline.shortlist_ideal_to', 'Shortlist {{length}} ideal to {{name}}', {
                    length: String(strongAtStart.length),
                    name: second.name,
                  })}
                </Button>
              ) : null}
              <span className="flex-1" />
              <SegmentedControl
                value={view}
                onValueChange={(v) => props.onFilter?.({ view: v === 'board' ? null : v })}
                aria-label={t('pipeline.view', 'View')}
              >
                <SegmentedControlItem value="board">
                  {t('pipeline.board', 'Board')}
                </SegmentedControlItem>
                <SegmentedControlItem value="table">
                  {t('pipeline.table', 'Table')}
                </SegmentedControlItem>
              </SegmentedControl>
            </div>
            <Refusal error={act.error} />
            {view === 'board' ? (
              <div
                ref={fill.ref}
                className="flex min-h-[26rem] flex-col"
                // Measured on the client: from the board's top to the window's bottom. Until then a
                // fair guess, so the first paint already scrolls inside its columns.
                style={{ height: fill.height ?? 'calc(100dvh - 16rem)' }}
              >
                <h2 className="sr-only">
                  {t('pipeline.candidates_by_stage', 'Candidates by stage')}
                </h2>
                <Kanban
                  label={t('pipeline.pipeline', '{{title}} pipeline', { title: data.job.title })}
                  columnWidth="296px"
                  className="min-h-0 flex-1"
                  dragActivator={canMove ? { mode: 'card' } : { mode: 'none' }}
                  columns={shown.map((s) => ({
                    id: s.id,
                    title: s.name,
                    tone: CATEGORY_TONE[s.category],
                    locked: !canMove || s.category === 'works_council' || s.category === 'contract',
                  }))}
                  items={byStage}
                  describeItem={(c) => c.name}
                  renderCard={(c) => (
                    <CandidateCard
                      card={c}
                      href={spotHref(c)}
                      onOpen={() => {
                        open(c);
                      }}
                    />
                  )}
                  onCardOpen={open}
                  cardTone={(c) => (c.match?.band === 'strong' ? 'success' : null)}
                  onMove={(m) => {
                    const card = active.find((c) => c.applicationId === m.itemId);
                    if (card !== undefined && m.from !== m.to) move(card, m.to);
                  }}
                  cardActions={[
                    {
                      id: 'open',
                      label: t('pipeline.open', 'Open'),
                      icon: <icons.person aria-hidden />,
                      run: (cards: readonly (CardData & { id: string })[]) => {
                        const c = cards[0];
                        if (c !== undefined) open(c);
                      },
                    },
                    {
                      id: 'reject',
                      label: t('pipeline.reject', 'Reject…'),
                      icon: <icons.reject aria-hidden />,
                      destructive: true,
                      hidden: () => !canMove,
                      run: (cards: readonly (CardData & { id: string })[]) => {
                        setRejecting({
                          ids: cards.map((c) => c.applicationId),
                          names: cards.map((c) => c.name),
                        });
                      },
                    },
                  ]}
                />
              </div>
            ) : (
              <>
                {selected.size === 0 ? null : (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--reach-fill)] p-2">
                    <span className="px-2 font-semibold">
                      {t('pipeline.selected', '{{size}} selected', { size: String(selected.size) })}
                    </span>
                    <Select value={moveTo} onValueChange={setMoveTo}>
                      <SelectTrigger aria-label={t('pipeline.move_to', 'Move to')} className="w-48">
                        <SelectValue placeholder={t('pipeline.move_to_2', 'Move to…')} />
                      </SelectTrigger>
                      <SelectContent>
                        {data.stages
                          .filter(
                            (s) =>
                              s.category !== 'hired' &&
                              s.category !== 'contract' &&
                              s.category !== 'interview',
                          )
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={moveTo === ''}
                      loading={act.pending}
                      onClick={() => {
                        act.run(
                          'BulkApplications',
                          { input: { action: 'move', ids: [...selected], to: moveTo } },
                          () => {
                            setSelected(new Set());
                          },
                        );
                      }}
                    >
                      {t('pipeline.move', 'Move')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const cards = active.filter((c) => selected.has(c.applicationId));
                        setRejecting({
                          ids: cards.map((c) => c.applicationId),
                          names: cards.map((c) => c.name),
                        });
                      }}
                    >
                      {t('pipeline.reject_2', 'Reject')}
                    </Button>
                  </div>
                )}
                {/* Infinite: the page's one scroll, only the rows on screen drawn. */}
                <DataTable<CardData>
                  label={t('pipeline.candidates', 'Candidates')}
                  rows={active}
                  rowId={applicationOf}
                  describeRow={nameOf}
                  fill
                  selectable
                  selected={[...selected]}
                  onSelectedChange={(ids) => {
                    setSelected(new Set(ids));
                  }}
                  onRowClick={open}
                  activeRowId={openId ?? null}
                  empty={t('pipeline.nobody_at_this_stage', 'Nobody at this stage')}
                  columns={columns}
                />
              </>
            )}
            <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
              <div className="pointer-events-auto w-96 max-w-full">
                <UndoBar
                  undo={undo}
                  onUndo={() => {
                    if (undo === null) return;
                    act.run(
                      'UndoMove',
                      { applicationId: undo.applicationId, input: { moveId: undo.moveId } },
                      () => {
                        // Back where it was: the card follows the board again, not the drop.
                        unplace(undo.applicationId);
                        setUndo(null);
                      },
                    );
                  }}
                />
              </div>
            </div>
            {/* The spotlight: the application over the board, its own address, J and K to walk the board. */}
            <ModalPage
              open={data.spotlight != null && openId !== undefined}
              onOpenChange={(isOpen) => {
                if (!isOpen) props.onFilter?.({ candidate: null, application: null });
              }}
            >
              {data.spotlight == null ? null : (
                <ModalPageContent size="full">
                  <Spotlight
                    data={data.spotlight}
                    offerOpen={data.openOffer}
                    actions={props}
                    applicationId={openId}
                    onApplication={(id) => props.onFilter?.({ application: id })}
                    overlay={{
                      onPrevious:
                        previous === undefined
                          ? null
                          : () => {
                              open(previous);
                            },
                      onNext:
                        following === undefined
                          ? null
                          : () => {
                              open(following);
                            },
                      position:
                        at < 0
                          ? null
                          : t('pipeline.of', '{{at}} of {{count}}', {
                              at: String(at + 1),
                              count: String(order.length),
                            }),
                    }}
                  />
                </ModalPageContent>
              )}
            </ModalPage>
            <JobConfirm
              confirming={confirming}
              onClose={() => {
                setConfirming(null);
              }}
              act={act}
              onDeleted={() => props.onNavigate?.('/recruiting/jobs')}
            />
            <RejectDialog
              options={{
                jobTitle: data.job.title,
                rejectionReasons: data.rejectionReasons,
                templates: data.templates,
                pools: data.pools,
              }}
              rejecting={rejecting}
              onClose={() => {
                setRejecting(null);
              }}
              props={props}
            />
            <Dialog
              open={asking !== null}
              onOpenChange={(isOpen) => {
                if (!isOpen) setAsking(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('pipeline.which_interview', 'Which interview?')}</DialogTitle>
                  <DialogDescription>
                    {asking === null
                      ? ''
                      : t(
                          'pipeline.moves_to_an_interview_stage',
                          '{{name}} moves to an interview stage.',
                          { name: asking.card.name },
                        )}
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <Field required>
                    <FieldLabel>{t('pipeline.interview', 'Interview')}</FieldLabel>
                    <FieldControl>
                      <Input
                        value={interviewType}
                        onChange={(e) => {
                          setInterviewType(e.target.value);
                        }}
                        placeholder={t('pipeline.technical_interview', 'Technical interview')}
                      />
                    </FieldControl>
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAsking(null);
                    }}
                  >
                    {t('pipeline.cancel', 'Cancel')}
                  </Button>
                  <Button
                    disabled={interviewType.trim() === ''}
                    onClick={() => {
                      if (asking !== null) move(asking.card, asking.to, interviewType.trim());
                      setAsking(null);
                      setInterviewType('');
                    }}
                  >
                    {t('pipeline.move', 'Move')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        );
      }}
    </Loaded>
  );
}
