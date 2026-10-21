import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  type DataColumn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Kanban,
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
import { useEffect, useMemo, useState, type JSX } from 'react';

import { Loaded } from './load';
import { RejectDialog, type Rejecting } from './reject-dialog';
import { CATEGORY_TONE, Refusal, Search, To, day, useAct, when, words } from './shared';
import type { Card as CardData, PipelineData, ScreenProps } from './types';

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
  onNavigate,
}: {
  readonly card: CardData;
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  // The ideal candidate (PRD §22.4, a strong match on every must): the board's border says it, this names it.
  const ideal = card.match?.band === 'strong';
  return (
    <div className="flex flex-col gap-2">
      {ideal ? (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-success-fg">
          <icons.starred aria-hidden className="size-3.5 fill-current" />
          Ideal candidate
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        <Avatar name={card.name} size="sm" />
        <To
          href={`/recruiting/candidates/${card.candidateId}`}
          onNavigate={onNavigate}
          className="min-w-0 flex-1 font-semibold text-fg hover:underline [overflow-wrap:anywhere]"
        >
          {card.name}
        </To>
        {card.unread > 0 ? (
          <Badge size="sm" tone="accent" aria-label={`${String(card.unread)} unread`}>
            {card.unread}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {card.flagged ? (
          <Badge size="sm" tone="warning">
            Knockout to review
          </Badge>
        ) : null}
        {card.duplicate ? (
          <Badge size="sm" tone="info">
            Possible duplicate
          </Badge>
        ) : null}
        {card.match == null ? null : (
          <Badge
            size="sm"
            tone={
              card.match.band === 'strong'
                ? 'success'
                : card.match.band === 'good'
                  ? 'accent'
                  : 'neutral'
            }
            variant="soft"
            aria-label={`AI match ${String(Math.round(card.match.scoreBp / 100))} percent, ${card.match.band}`}
          >
            {`${String(Math.round(card.match.scoreBp / 100))}% match`}
          </Badge>
        )}
        <span
          className={card.daysInStage > 4 ? 'text-[var(--reach-warning-text)]' : 'text-fg-muted'}
        >{`${String(card.daysInStage)} d in stage`}</span>
      </div>
      {card.nextInterview === null ? null : (
        <div className="flex items-center gap-1.5 border-t border-[var(--reach-line)] pt-2 text-sm text-fg-muted">
          <icons.meeting aria-hidden className="size-3.5" />
          {`${card.nextInterview.title} ${when(card.nextInterview.startsAt)}`}
        </div>
      )}
    </div>
  );
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
      <span className="flex-1">{`${undo.name} moved to ${undo.stage}`}</span>
      <Button size="sm" variant="secondary" onClick={onUndo}>{`Undo · ${String(left)} s`}</Button>
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
      header: 'Candidate',
      sortBy: (c) => c.name,
      cell: (c) => (
        <To href={`/recruiting/candidates/${c.candidateId}`} onNavigate={onNavigate}>
          {c.name}
        </To>
      ),
    },
    {
      id: 'stage',
      header: 'Stage',
      sortBy: (c) => stages.findIndex((s) => s.id === c.stageId),
      cell: (c) => <Badge size="sm">{stages.find((s) => s.id === c.stageId)?.name ?? ''}</Badge>,
    },
    {
      id: 'source',
      header: 'Source',
      hideOnCard: true,
      sortBy: (c) => c.source,
      cell: (c) => <span className="text-sm text-fg-muted">{words(c.source)}</span>,
    },
    {
      id: 'inStage',
      header: 'In stage',
      numeric: true,
      sortBy: (c) => c.daysInStage,
      cell: (c) => `${String(c.daysInStage)} d`,
    },
    {
      id: 'next',
      header: 'Next',
      sortBy: (c) => c.nextInterview?.startsAt ?? '',
      cell: (c) => (
        <span className="text-sm text-fg-muted">
          {c.nextInterview === null ? '' : when(c.nextInterview.startsAt)}
        </span>
      ),
    },
    {
      id: 'applied',
      header: 'Applied',
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
  const [assessed, setAssessed] = useState<{
    assessed: number;
    skipped: number;
    failed: readonly string[];
  } | null>(null);
  // Held while the stages and the navigation hold, so a selection redraws only its rows.
  const stages = props.load.status === 'ready' ? props.load.data.stages : NO_STAGES;
  const { onNavigate } = props;
  const columns = useMemo(() => pipelineColumns(stages, onNavigate), [stages, onNavigate]);

  return (
    <Loaded load={props.load} what="the pipeline">
      {(data) => {
        const band = props.search?.['band'] ?? '';
        const active = data.cards.filter(
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
            : data.cards.filter(
                (c) =>
                  c.outcome === 'active' && c.stageId === first.id && c.match?.band === 'strong',
              );
        const byStage = Object.fromEntries(
          data.stages.map((s) => [
            s.id,
            active.filter((c) => c.stageId === s.id).map((c) => ({ ...c, id: c.applicationId })),
          ]),
        );
        const canMove = data.may.includes('pipeline.move');
        const move = (card: CardData, to: string, type?: string): void => {
          const stage = data.stages.find((s) => s.id === to);
          if (stage === undefined) return;
          if (stage.category === 'interview' && type === undefined) {
            setAsking({ card, to });
            return;
          }
          act.run(
            'MoveApplication',
            {
              applicationId: card.applicationId,
              input: { to, ...(type === undefined ? {} : { interviewType: type }) },
            },
            (answer) => {
              const moved = answer as { moveId: string; opensOffer: boolean };
              setUndo({
                name: card.name,
                stage: stage.name,
                applicationId: card.applicationId,
                moveId: moved.moveId,
              });
              if (moved.opensOffer)
                props.onNavigate?.(`/recruiting/candidates/${card.candidateId}?tab=process`);
            },
          );
        };
        return (
          <div className="flex flex-col gap-3">
            <PageHeader
              title={data.job.title}
              description={`${String(active.length)} active candidates`}
              actions={
                <>
                  <SegmentedControl
                    value={view}
                    onValueChange={(v) => props.onFilter?.({ view: v === 'board' ? null : v })}
                    aria-label="View"
                  >
                    <SegmentedControlItem value="board">Board</SegmentedControlItem>
                    <SegmentedControlItem value="table">Table</SegmentedControlItem>
                  </SegmentedControl>
                  {/* R7, from the board: open the job if it is a draft, then put it on Kithena Jobs. */}
                  {data.job.onKithenaJobs ? (
                    <Button
                      asChild
                      variant="secondary"
                      startIcon={<icons.externalLink aria-hidden />}
                    >
                      <a href={data.job.publicUrl} target="_blank" rel="noreferrer">
                        On Kithena Jobs
                      </a>
                    </Button>
                  ) : data.may.includes('job.edit') ? (
                    <Button
                      startIcon={<icons.send aria-hidden />}
                      loading={act.pending}
                      onClick={() => {
                        const publish = (): void => {
                          act.run('PublishJob', { jobId: data.job.id, target: 'kithena_jobs' });
                        };
                        if (data.job.state === 'open') publish();
                        else
                          act.run(
                            'MoveJob',
                            { jobId: data.job.id, input: { to: 'open' } },
                            publish,
                          );
                      }}
                    >
                      {data.job.state === 'open' ? 'Publish on Kithena Jobs' : 'Open and publish'}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    startIcon={<icons.settings aria-hidden />}
                    onClick={() => props.onNavigate?.(`/recruiting/jobs/${data.job.id}/setup`)}
                  >
                    Job setup
                  </Button>
                  <Button
                    variant="secondary"
                    startIcon={<icons.analytics aria-hidden />}
                    onClick={() => props.onNavigate?.(`/recruiting/analytics?job=${data.job.id}`)}
                  >
                    Job dashboard
                  </Button>
                  {data.may.includes('job.edit') ? (
                    <>
                      <Button
                        variant="secondary"
                        startIcon={<icons.assistant aria-hidden />}
                        loading={act.pending}
                        onClick={() => {
                          act.run('AssessJob', { jobId: data.job.id }, (done) => {
                            setAssessed(done as typeof assessed);
                          });
                        }}
                      >
                        Read everyone with AI
                      </Button>
                      <Button
                        variant="secondary"
                        loading={act.pending}
                        onClick={() => {
                          act.run('Rediscover', { jobId: data.job.id }, (found) => {
                            setFound(found as readonly Rediscovered[]);
                          });
                        }}
                      >
                        Rediscover from pools
                      </Button>
                    </>
                  ) : null}
                </>
              }
            />
            {assessed === null ? null : (
              <Alert
                tone={assessed.failed.length === 0 ? 'success' : 'warning'}
                title={`${String(assessed.assessed)} read against the criteria, ${String(assessed.skipped)} already were`}
                onDismiss={() => {
                  setAssessed(null);
                }}
              >
                {assessed.failed.length === 0
                  ? 'A label on each card, not a decision: every finding cites the CV and a person agrees or not.'
                  : `${String(assessed.failed.length)} could not be read: ${[...new Set(assessed.failed)].join('; ')}`}
              </Alert>
            )}
            {found === null ? null : (
              <Card>
                <CardHeader>
                  <CardTitle level={2}>From your talent pools</CardTitle>
                  <CardDescription>
                    People who agreed to be kept, read against this job’s criteria. A label, not a
                    decision: invite the ones you choose.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {found.length === 0 ? (
                    <EmptyState
                      icon={<icons.people aria-hidden />}
                      title="Nobody in the pools yet"
                    />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {found.map((r) => (
                        <li key={r.candidateId} className="flex items-center gap-2">
                          <To
                            href={`/recruiting/candidates/${r.candidateId}`}
                            onNavigate={props.onNavigate}
                          >
                            {r.name}
                          </To>
                          <Badge size="sm" tone="neutral">{`${words(r.band)} match`}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Search
                label="Search candidates"
                placeholder="Search by name"
                initial={props.search?.['q'] ?? ''}
                onSearch={(q) => props.onFilter?.({ q: q === '' ? null : q })}
                className="w-64"
              />
              <Select
                value={props.search?.['sort'] ?? 'newest'}
                onValueChange={(v) => props.onFilter?.({ sort: v === 'newest' ? null : v })}
              >
                <SelectTrigger aria-label="Sort" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="days">Longest in stage</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="match">Match, strongest first</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={band === '' ? 'any' : band}
                onValueChange={(v) => props.onFilter?.({ band: v === 'any' ? null : v })}
              >
                <SelectTrigger aria-label="AI match" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any match</SelectItem>
                  <SelectItem value="strong">Ideal candidates</SelectItem>
                  <SelectItem value="good">Good matches</SelectItem>
                  <SelectItem value="weak">Weak matches</SelectItem>
                  <SelectItem value="none">Not read yet</SelectItem>
                </SelectContent>
              </Select>
              {strongAtStart.length > 0 && canMove && second !== undefined ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={act.pending}
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
                  {`Shortlist ${String(strongAtStart.length)} ideal to ${second.name}`}
                </Button>
              ) : null}
            </div>
            <Refusal error={act.error} />
            {view === 'board' ? (
              <>
                <h2 className="sr-only">Candidates by stage</h2>
                <Kanban
                  label={`${data.job.title} pipeline`}
                  columnWidth="300px"
                  columns={data.stages
                    .filter((s) => s.category !== 'hired')
                    .map((s) => ({
                      id: s.id,
                      title: s.name,
                      tone: CATEGORY_TONE[s.category],
                      locked: !canMove || s.category === 'works_council',
                    }))}
                  items={byStage}
                  describeItem={(c) => c.name}
                  renderCard={(c) => <CandidateCard card={c} onNavigate={props.onNavigate} />}
                  cardTone={(c) => (c.match?.band === 'strong' ? 'success' : null)}
                  onMove={(m) => {
                    const card = active.find((c) => c.applicationId === m.itemId);
                    if (card !== undefined && m.from !== m.to) move(card, m.to);
                  }}
                  cardActions={[
                    {
                      id: 'reject',
                      label: 'Reject…',
                      run: (cards: readonly (CardData & { id: string })[]) => {
                        setRejecting({
                          ids: cards.map((c) => c.applicationId),
                          names: cards.map((c) => c.name),
                        });
                      },
                    },
                  ]}
                />
              </>
            ) : (
              <>
                {selected.size === 0 ? null : (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--reach-fill)] p-2">
                    <span className="px-2 font-semibold">{`${String(selected.size)} selected`}</span>
                    <Select value={moveTo} onValueChange={setMoveTo}>
                      <SelectTrigger aria-label="Move to" className="w-48">
                        <SelectValue placeholder="Move to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.stages
                          .filter((s) => s.category !== 'hired' && s.category !== 'interview')
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
                      Move
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
                      Reject
                    </Button>
                  </div>
                )}
                {/* Infinite: the page's one scroll, only the rows on screen drawn. */}
                <DataTable<CardData>
                  label="Candidates"
                  rows={active}
                  rowId={applicationOf}
                  describeRow={nameOf}
                  fill
                  selectable
                  selected={[...selected]}
                  onSelectedChange={(ids) => {
                    setSelected(new Set(ids));
                  }}
                  empty="Nobody at this stage"
                  columns={columns}
                />
              </>
            )}
            <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto w-96 max-w-full">
                <UndoBar
                  undo={undo}
                  onUndo={() => {
                    if (undo === null) return;
                    act.run(
                      'UndoMove',
                      { applicationId: undo.applicationId, input: { moveId: undo.moveId } },
                      () => {
                        setUndo(null);
                      },
                    );
                  }}
                />
              </div>
            </div>
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
              onOpenChange={(open) => {
                if (!open) setAsking(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Which interview?</DialogTitle>
                  <DialogDescription>
                    {asking === null ? '' : `${asking.card.name} moves to an interview stage.`}
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <Field required>
                    <FieldLabel>Interview</FieldLabel>
                    <FieldControl>
                      <Input
                        value={interviewType}
                        onChange={(e) => {
                          setInterviewType(e.target.value);
                        }}
                        placeholder="Technical interview"
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
                    Cancel
                  </Button>
                  <Button
                    disabled={interviewType.trim() === ''}
                    onClick={() => {
                      if (asking !== null) move(asking.card, asking.to, interviewType.trim());
                      setAsking(null);
                      setInterviewType('');
                    }}
                  >
                    Move
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
