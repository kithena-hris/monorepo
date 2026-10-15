import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded } from './load';
import { CATEGORY_TONE, Refusal, Search, To, day, useAct, when, words } from './shared';
import type { Card as CardData, PipelineData, ScreenProps } from './types';

/**
 * R10, a job's pipeline (design R10–R10d): a board by stage or a table, the
 * view and every filter in the address. A move asks only what it needs and
 * can be undone for ten seconds; rejecting asks a reason, an email and when
 * to send it; several candidates at once from the table.
 */

const UNDO_SECONDS = 10;

function CandidateCard({
  card,
  onNavigate,
}: {
  readonly card: CardData;
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar name={card.name} size="sm" />
        <To
          href={`/recruiting/candidates/${card.candidateId}`}
          onNavigate={onNavigate}
          className="min-w-0 flex-1 truncate font-semibold text-fg hover:underline"
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

interface Rejecting {
  readonly ids: readonly string[];
  readonly names: readonly string[];
}

function RejectDialog({
  data,
  rejecting,
  onClose,
  props,
}: {
  readonly data: PipelineData;
  readonly rejecting: Rejecting | null;
  readonly onClose: () => void;
  readonly props: ScreenProps<PipelineData>;
}): JSX.Element {
  const act = useAct(props);
  const [reason, setReason] = useState(data.rejectionReasons[0] ?? 'not_qualified');
  const [template, setTemplate] = useState<string>(
    data.templates.find((t) => t.purpose === 'rejection')?.id ?? 'none',
  );
  const [send, setSend] = useState<'now' | 'later_today' | 'none'>('later_today');
  const [pool, setPool] = useState<string>('none');
  const many = (rejecting?.ids.length ?? 0) > 1;
  const submit = (): void => {
    if (rejecting === null) return;
    const templateId = template === 'none' ? null : template;
    if (many) {
      act.run(
        'BulkApplications',
        {
          input: {
            action: 'reject',
            ids: rejecting.ids,
            reasonKey: reason,
            templateId,
            send: templateId === null ? 'none' : send,
          },
        },
        onClose,
      );
    } else {
      act.run(
        'RejectApplication',
        {
          applicationId: rejecting.ids[0],
          input: {
            reasonKey: reason,
            templateId,
            send: templateId === null ? 'none' : send,
            poolId: pool === 'none' ? null : pool,
          },
        },
        onClose,
      );
    }
  };
  return (
    <Dialog
      open={rejecting !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {many
              ? `Reject ${String(rejecting?.ids.length ?? 0)} candidates`
              : `Reject ${rejecting?.names[0] ?? ''}`}
          </DialogTitle>
          <DialogDescription>{`${data.job.title}${many ? ` · ${rejecting?.names.join(', ') ?? ''}` : ''}`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={act.error} />
          <Field required>
            <FieldLabel>Reason</FieldLabel>
            <Select value={reason} onValueChange={setReason}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {data.rejectionReasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {words(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Internal. The email never states a reason the candidate hasn’t seen in writing.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Select value={template} onValueChange={setTemplate}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">No email</SelectItem>
                {data.templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {template === 'none' ? null : (
            <Field>
              <FieldLabel>Send</FieldLabel>
              <SegmentedControl
                value={send}
                onValueChange={(v) => {
                  setSend(v as typeof send);
                }}
              >
                <SegmentedControlItem value="now">Now</SegmentedControlItem>
                <SegmentedControlItem value="later_today">Later today</SegmentedControlItem>
              </SegmentedControl>
              <FieldDescription>
                Later today: a few hours on, and never between 21:00 and 08:00 in the candidate’s
                time zone.
              </FieldDescription>
            </Field>
          )}
          {many || data.pools.length === 0 ? null : (
            <Field>
              <FieldLabel>Add to a talent pool</FieldLabel>
              <Select value={pool} onValueChange={setPool}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value="none">Not now</SelectItem>
                  {data.pools.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Without pool consent the candidate is asked by email first.
              </FieldDescription>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={act.pending} onClick={submit}>
            {many ? `Reject ${String(rejecting?.ids.length ?? 0)}` : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export function Pipeline(props: ScreenProps<PipelineData>): JSX.Element {
  const view = props.search?.['view'] === 'table' ? 'table' : 'board';
  const act = useAct(props);
  const [rejecting, setRejecting] = useState<Rejecting | null>(null);
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

  return (
    <Loaded load={props.load} what="the pipeline">
      {(data) => {
        const active = data.cards.filter((c) => c.outcome === 'active');
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
                props.onNavigate?.(`/recruiting/candidates/${card.candidateId}?tab=offers`);
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
                </>
              }
            />
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
                </SelectContent>
              </Select>
            </div>
            <Refusal error={act.error} />
            {view === 'board' ? (
              <>
                <h2 className="sr-only">Candidates by stage</h2>
                <Kanban
                  label={`${data.job.title} pipeline`}
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
                <Card>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <Checkbox
                              aria-label="Select all"
                              checked={selected.size > 0 && selected.size === active.length}
                              onCheckedChange={(on) => {
                                setSelected(
                                  on === true
                                    ? new Set(active.map((c) => c.applicationId))
                                    : new Set(),
                                );
                              }}
                            />
                          </TableHead>
                          <TableHead>Candidate</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>In stage</TableHead>
                          <TableHead>Next</TableHead>
                          <TableHead>Applied</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {active.map((c) => (
                          <TableRow
                            key={c.applicationId}
                            data-state={selected.has(c.applicationId) ? 'selected' : undefined}
                          >
                            <TableCell>
                              <Checkbox
                                aria-label={`Select ${c.name}`}
                                checked={selected.has(c.applicationId)}
                                onCheckedChange={(on) => {
                                  const next = new Set(selected);
                                  if (on === true) next.add(c.applicationId);
                                  else next.delete(c.applicationId);
                                  setSelected(next);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <To
                                href={`/recruiting/candidates/${c.candidateId}`}
                                onNavigate={props.onNavigate}
                              >
                                {c.name}
                              </To>
                            </TableCell>
                            <TableCell>
                              <Badge size="sm">
                                {data.stages.find((s) => s.id === c.stageId)?.name ?? ''}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-fg-muted">
                              {words(c.source)}
                            </TableCell>
                            <TableCell>{`${String(c.daysInStage)} d`}</TableCell>
                            <TableCell className="text-sm text-fg-muted">
                              {c.nextInterview === null ? '' : when(c.nextInterview.startsAt)}
                            </TableCell>
                            <TableCell className="text-sm text-fg-muted">
                              {day(c.appliedAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
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
              data={data}
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
