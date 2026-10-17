import {
  DatePicker,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  KeyValues,
  NumberField,
  PageHeader,
  Progress,
  SegmentedControl,
  SegmentedControlItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
} from '@reach/ui';
import { encode } from 'uqr';
import { useState, type JSX } from 'react';

import { FormView } from './form-view';
import { Loaded } from './load';
import {
  Choose,
  Modal,
  PersonPicker,
  Refusal,
  StepDialog,
  To,
  day,
  plural,
  useAct,
  when,
  type Act,
} from './shared';
import type { Answers, FormDefinition, ScreenProps } from './types';

/**
 * Learning (PRD §15; design PF15 v2): what is assigned to me, the catalogue,
 * live sessions with attendance, and assigning in three steps. An item is
 * complete when every part, the acknowledgement, the quiz and attendance are.
 */

type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';
const STATE: Readonly<Record<string, readonly [string, Tone]>> = {
  not_started: ['Assigned', 'neutral'],
  in_progress: ['In progress', 'warning'],
  done: ['Completed', 'success'],
  going: ['Going', 'info'],
};

function StateBadge({
  state,
  due,
}: {
  readonly state: string;
  readonly due?: string | null;
}): JSX.Element {
  const late =
    due !== null &&
    due !== undefined &&
    state !== 'done' &&
    due < new Date().toISOString().slice(0, 10);
  const [label, tone] = late
    ? (['Overdue', 'danger'] as const)
    : (STATE[state] ?? [state, 'neutral']);
  return (
    <Badge size="sm" tone={tone}>
      {label}
    </Badge>
  );
}

const KINDS = [
  ['course', 'External course'],
  ['session', 'Live session'],
  ['recording', 'Recording'],
  ['document', 'Document'],
  ['quiz', 'Quiz'],
  ['path', 'Path'],
  ['link', 'Link'],
] as const;
const kindWord = (k: string): string => KINDS.find(([v]) => v === k)?.[1] ?? k;

export interface LearningData {
  readonly tab: string;
  readonly assigned: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly title: string;
    readonly kind: string;
    readonly why: string;
    readonly due: string | null;
    readonly recurs: string | null;
    readonly expires: string | null;
    readonly state: string;
    readonly progress: string | null;
    readonly completedAt: string | null;
  }[];
  readonly catalogue: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly provider: string;
    readonly minutes: number;
    readonly assigned: number;
    readonly skills: readonly string[];
  }[];
  readonly sessions: readonly {
    readonly itemId: string;
    readonly sessionId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly place: string | null;
    readonly online: string | null;
    readonly going: number;
  }[];
  readonly providers: readonly {
    readonly name: string;
    readonly connected: boolean;
    readonly items: number;
  }[];
  readonly hr: boolean;
  readonly manager: boolean;
}

export function Learning(props: ScreenProps<LearningData>): JSX.Element {
  const act = useAct(props);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  return (
    <Loaded load={props.load} what="learning">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Learning"
            description="Courses, sessions and documents: what is assigned to you, and everything the company offers."
            actions={
              <>
                {data.hr ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setImporting(true);
                    }}
                  >
                    Import completions
                  </Button>
                ) : null}
                {data.hr ? (
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setAdding(true);
                    }}
                  >
                    Add an item
                  </Button>
                ) : null}
              </>
            }
          />
          <Refusal error={act.error} />
          {data.tab === 'assigned' ? (
            <Card>
              <CardContent className="overflow-x-auto">
                {data.assigned.length === 0 ? (
                  <EmptyState
                    icon={<icons.document aria-hidden />}
                    title="Nothing assigned"
                    description="What your company or your manager assigns you shows here and in your Inbox."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Why</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.assigned.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <To
                              href={`/performance/learning/items/${a.itemId}`}
                              onNavigate={props.onNavigate}
                            >
                              {a.title}
                            </To>
                            <span className="block text-xs text-fg-muted">
                              {[a.kind, a.recurs].filter(Boolean).join(' · ')}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{a.why}</TableCell>
                          <TableCell className="text-sm">{day(a.due)}</TableCell>
                          <TableCell className="text-sm">
                            {a.state === 'done'
                              ? `Completed ${day(a.completedAt)}${a.expires === null ? '' : ` · expires ${day(a.expires)}`}`
                              : (a.progress ?? '—')}
                          </TableCell>
                          <TableCell>
                            <StateBadge state={a.state} due={a.due} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
          {data.tab === 'catalogue' ? (
            <Card>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Length</TableHead>
                      <TableHead>Assigned</TableHead>
                      {data.hr || data.manager ? (
                        <TableHead>
                          <span className="sr-only">Assign</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.catalogue.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <To
                            href={`/performance/learning/items/${i.id}`}
                            onNavigate={props.onNavigate}
                          >
                            {i.title}
                          </To>
                          <span className="block text-xs text-fg-muted">
                            {[i.provider, ...i.skills].join(' · ')}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{kindWord(i.kind)}</TableCell>
                        <TableCell className="text-sm">
                          {i.minutes === 0 ? '—' : `${String(i.minutes)} min`}
                        </TableCell>
                        <TableCell className="text-sm">
                          {plural(i.assigned, 'person', 'people')}
                        </TableCell>
                        {data.hr || data.manager ? (
                          <TableCell>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setAssigning(i.id);
                              }}
                            >
                              Assign
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
          {data.tab === 'sessions' ? (
            <Card>
              <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                {data.sessions.length === 0 ? (
                  <EmptyState
                    icon={<icons.calendar aria-hidden />}
                    title="No sessions planned"
                    description="Live sessions, in a room or online, are listed with who is going."
                  />
                ) : (
                  data.sessions.map((s) => (
                    <div key={s.sessionId} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{s.title}</span>
                        <span className="text-sm text-fg-muted">{`${when(s.start)} · ${s.place ?? s.online ?? 'Online'} · ${plural(s.going, 'person', 'people')} going`}</span>
                      </span>
                      {data.hr ? (
                        <Button size="sm" variant="secondary" asChild>
                          <a
                            href={`/performance/learning/items/${s.itemId}/sessions/${s.sessionId}`}
                          >
                            Attendance
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
          {assigning === null ? null : (
            <Assign
              act={act}
              itemId={assigning}
              title={data.catalogue.find((i) => i.id === assigning)?.title ?? ''}
              onClose={() => {
                setAssigning(null);
              }}
            />
          )}
          {adding ? (
            <NewItem
              act={act}
              onClose={() => {
                setAdding(false);
              }}
              onNavigate={props.onNavigate}
            />
          ) : null}
          {importing ? (
            <ImportCompletions
              act={act}
              onClose={() => {
                setImporting(false);
              }}
            />
          ) : null}
        </div>
      )}
    </Loaded>
  );
}

/** PF15c v2: What · Who · Due and repeat. */
function Assign({
  act,
  itemId,
  title,
  onClose,
}: {
  readonly act: Act;
  readonly itemId: string;
  readonly title: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [people, setPeople] = useState<readonly string[]>([]);
  const [due, setDue] = useState('');
  const [why, setWhy] = useState('Required');
  return (
    <StepDialog
      open
      onClose={onClose}
      title={`Assign ${title}`}
      steps={['What', 'Who', 'Due and repeat']}
      step={step}
      onStep={setStep}
      pending={act.pending}
      canNext={step !== 1 || people.length > 0}
      finishLabel={`Assign to ${plural(people.length, 'person', 'people')}`}
      finish={() => {
        act.run(
          'AssignPerformanceLearning',
          {
            id: itemId,
            input: { people, filter: [], cycleId: null, due: due === '' ? null : due, why },
          },
          onClose,
        );
      }}
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="font-semibold">{title}</p>
          <Field>
            <FieldLabel>Why, as the learner reads it</FieldLabel>
            <Input
              value={why}
              onChange={(e) => {
                setWhy(e.target.value);
              }}
            />
          </Field>
        </div>
      ) : null}
      {step === 1 ? (
        <PersonPicker act={act} label="Who" value={people} onChange={setPeople} many />
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>Due</FieldLabel>
            <FieldControl>
              <DatePicker
                label="Due"
                value={due === '' ? null : due}
                onChange={(date) => {
                  setDue(date ?? '');
                }}
              />
            </FieldControl>
          </Field>
          <p className="text-sm text-fg-muted">
            An item that recurs is assigned again when it expires, on the item’s own schedule.
          </p>
        </div>
      ) : null}
    </StepDialog>
  );
}

function NewItem({
  act,
  onClose,
  onNavigate,
}: {
  readonly act: Act;
  readonly onClose: () => void;
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('course');
  const [provider, setProvider] = useState('Your company');
  const [minutes, setMinutes] = useState<number | null>(30);
  const [url, setUrl] = useState('');
  const [ack, setAck] = useState('');
  const [start, setStart] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a learning item"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={title.trim() === '' || (kind === 'session' && start === '')}
            loading={act.pending}
            onClick={() => {
              const at = start === '' ? null : new Date(start);
              act.run(
                'CreatePerformanceItem',
                {
                  input: {
                    title,
                    kind,
                    provider,
                    minutes: minutes ?? 0,
                    parts: [],
                    acknowledgement: ack.trim() === '' ? null : ack,
                    quiz: null,
                    recursMonths: null,
                    certificateYears: null,
                    sessions:
                      at === null
                        ? []
                        : [
                            {
                              id: null,
                              start: at.toISOString(),
                              end: new Date(at.getTime() + (minutes ?? 60) * 60_000).toISOString(),
                              place: null,
                              online: null,
                            },
                          ],
                    skills: [],
                    url: url.trim() === '' ? null : url,
                  },
                },
                (d) => {
                  onNavigate?.(`/performance/learning/items/${(d as { id: string }).id}`);
                },
              );
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>Title</FieldLabel>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </Field>
      <Choose label="Kind" value={kind} options={KINDS} onChange={setKind} />
      <Field>
        <FieldLabel>Provider</FieldLabel>
        <Input
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
          }}
        />
      </Field>
      <NumberField label="Length" suffix="min" value={minutes} min={0} onChange={setMinutes} />
      {kind === 'session' ? (
        <Field required>
          <FieldLabel>Starts</FieldLabel>
          <Input
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
            }}
          />
        </Field>
      ) : (
        <Field>
          <FieldLabel>Link</FieldLabel>
          <Input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
            placeholder="https://"
          />
        </Field>
      )}
      <Field>
        <FieldLabel>Acknowledgement the learner confirms</FieldLabel>
        <Input
          value={ack}
          onChange={(e) => {
            setAck(e.target.value);
          }}
          placeholder="I have read and understood the policy"
        />
      </Field>
    </Modal>
  );
}

/** PF15g: completions from another platform, by email and item. */
function ImportCompletions({
  act,
  onClose,
}: {
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<{ matched: number; unmatched: readonly unknown[] } | null>(
    null,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Import completions"
      description="One row per completion: email, item title, completed on. Rows that match nobody are listed, never guessed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={csv.trim() === ''}
            loading={act.pending}
            onClick={() => {
              act.run('ImportPerformanceCompletions', { input: { csv } }, (d) => {
                setResult(d as NonNullable<typeof result>);
              });
            }}
          >
            Import
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Textarea
        aria-label="Completions"
        className="font-mono"
        rows={8}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
        }}
        placeholder={'email,item,completed\nadam@acme.com,Security basics,2026-10-01'}
      />
      {result === null ? null : (
        <Alert
          tone={result.unmatched.length === 0 ? 'success' : 'warning'}
          title={`${String(result.matched)} matched · ${String(result.unmatched.length)} unmatched`}
        >
          Unmatched rows stay out until someone fixes the email or the item.
        </Alert>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------- one item -- */

export interface ItemData {
  readonly item: {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly provider: string;
    readonly minutes: number;
    readonly parts: readonly {
      readonly id: string;
      readonly title: string;
      readonly minutes: number;
    }[];
    readonly acknowledgement: string | null;
    readonly quiz: {
      readonly definition: FormDefinition;
      readonly passMark: number;
      readonly questions: number;
    } | null;
    readonly recursMonths: number | null;
    readonly certificateYears: number | null;
    readonly sessions: readonly {
      readonly id: string;
      readonly start: string;
      readonly end: string;
      readonly place: string | null;
      readonly online: string | null;
    }[];
    readonly skills: readonly string[];
    readonly url: string | null;
  };
  readonly assignment: {
    readonly id: string;
    readonly why: string;
    readonly due: string | null;
    readonly done: readonly string[];
    readonly acknowledgedAt: string | null;
    readonly quiz: {
      readonly correct: number;
      readonly of: number;
      readonly passed: boolean;
    } | null;
    readonly attendance: readonly {
      readonly sessionId: string;
      readonly invitation: string;
      readonly attended: unknown;
    }[];
    readonly completedAt: string | null;
    readonly expiresOn: string | null;
    readonly state: string;
  } | null;
  readonly hr: boolean;
}

export function Item(props: ScreenProps<ItemData>): JSX.Element {
  const act = useAct(props);
  const [answers, setAnswers] = useState<Answers>({});
  return (
    <Loaded load={props.load} what="the item">
      {({ item, assignment: a, hr }) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={item.title}
            description={`${kindWord(item.kind)} · ${item.provider}${item.minutes === 0 ? '' : ` · ${String(item.minutes)} min`}`}
            actions={
              item.url === null ? null : (
                <Button asChild startIcon={<icons.externalLink aria-hidden />}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </Button>
              )
            }
          />
          <Refusal error={act.error} />
          {a === null ? (
            <Alert tone="info" title="Not assigned to you">
              {hr ? 'Assign it from the catalogue.' : 'You can still open it.'}
            </Alert>
          ) : (
            <Card>
              <CardContent>
                <KeyValues
                  layout="split"
                  items={[
                    { label: 'State', value: <StateBadge state={a.state} due={a.due} /> },
                    { label: 'Why', value: a.why },
                    { label: 'Due', value: day(a.due) },
                    ...(a.completedAt === null
                      ? []
                      : [{ label: 'Completed', value: day(a.completedAt) }]),
                    ...(a.expiresOn === null
                      ? []
                      : [{ label: 'Expires', value: day(a.expiresOn) }]),
                  ]}
                />
              </CardContent>
            </Card>
          )}
          {item.parts.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle
                  level={2}
                >{`Parts · ${String(a?.done.length ?? 0)} of ${String(item.parts.length)}`}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Progress
                  value={
                    item.parts.length === 0
                      ? 0
                      : Math.round(((a?.done.length ?? 0) / item.parts.length) * 100)
                  }
                  label="Parts done"
                />
                {item.parts.map((p) => (
                  <Field key={p.id} orientation="horizontal">
                    <FieldControl>
                      <Checkbox
                        checked={a?.done.includes(p.id) === true}
                        disabled={a === null || a.done.includes(p.id)}
                        onCheckedChange={() => {
                          if (a !== null)
                            act.run('MarkPerformancePart', { id: a.id, partId: p.id });
                        }}
                      />
                    </FieldControl>
                    <FieldLabel>{`${p.title} · ${String(p.minutes)} min`}</FieldLabel>
                  </Field>
                ))}
              </CardContent>
            </Card>
          )}
          {item.sessions.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>Sessions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                {item.sessions.map((s) => {
                  const mine = a?.attendance.find((x) => x.sessionId === s.id);
                  return (
                    <div key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{when(s.start)}</span>
                        <span className="block text-sm text-fg-muted">
                          {s.place ?? s.online ?? 'Online'}
                        </span>
                      </span>
                      {a === null ? null : (
                        <SegmentedControl
                          size="sm"
                          aria-label={`Going on ${when(s.start)}`}
                          value={mine?.invitation ?? ''}
                          onValueChange={(v) => {
                            act.run('RespondPerformanceSession', {
                              id: a.id,
                              sessionId: s.id,
                              input: { invitation: v },
                            });
                          }}
                        >
                          <SegmentedControlItem value="accepted">Going</SegmentedControlItem>
                          <SegmentedControlItem value="tentative">Maybe</SegmentedControlItem>
                          <SegmentedControlItem value="declined">Not going</SegmentedControlItem>
                        </SegmentedControl>
                      )}
                      {hr ? (
                        <Button size="sm" variant="secondary" asChild>
                          <a href={`/performance/learning/items/${item.id}/sessions/${s.id}`}>
                            Attendance
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
          {item.acknowledgement === null || a === null ? null : (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3">
                <p className="flex-1">{item.acknowledgement}</p>
                {a.acknowledgedAt === null ? (
                  <Button
                    loading={act.pending}
                    onClick={() => {
                      act.run('AcknowledgePerformanceLearning', { id: a.id });
                    }}
                  >
                    I confirm
                  </Button>
                ) : (
                  <Badge tone="success">{`Confirmed ${day(a.acknowledgedAt)}`}</Badge>
                )}
              </CardContent>
            </Card>
          )}
          {item.quiz === null || a === null ? null : a.quiz?.passed === true ? (
            <Alert
              tone="success"
              title={`Quiz passed · ${String(a.quiz.correct)} of ${String(a.quiz.of)}`}
            >
              The pass mark is {String(item.quiz.passMark)}%.
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              {a.quiz === null ? null : (
                <Alert
                  tone="warning"
                  title={`${String(a.quiz.correct)} of ${String(a.quiz.of)}: not passed yet`}
                >{`The pass mark is ${String(item.quiz.passMark)}%. Try again.`}</Alert>
              )}
              <FormView
                definition={item.quiz.definition}
                answers={answers}
                editable
                onChange={(id, x) => {
                  setAnswers({ ...answers, [id]: x });
                }}
              />
              <Button
                className="self-start"
                loading={act.pending}
                onClick={() => {
                  act.run('SubmitPerformanceQuiz', { id: a.id, input: { answers } });
                }}
              >
                Submit the quiz
              </Button>
            </div>
          )}
        </div>
      )}
    </Loaded>
  );
}

export interface SessionData {
  readonly item: { readonly id: string; readonly title: string };
  readonly session: {
    readonly id: string;
    readonly start: string;
    readonly end: string;
    readonly place: string | null;
    readonly online: string | null;
    readonly qr: string;
  };
  readonly rows: readonly {
    readonly assignmentId: string;
    readonly personId: string;
    readonly name: string;
    readonly invitation: string;
    readonly attended: { readonly how: string; readonly minutes: number | null } | null;
  }[];
}

/**
 * The door's code as a QR, one SVG path: a rectangle per run of dark modules,
 * the standard quiet zone. Time Off's kiosk code's way (`kiosk/code.tsx`):
 * Reach has no QR, so the encoder is this module's.
 */
function qrPath(text: string): { path: string; size: number } {
  const { data, size } = encode(text, { border: 4 });
  let path = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (row[x]) x++;
      path += `M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`;
    }
  });
  return { path, size };
}

function DoorQr({ code }: { readonly code: string }): JSX.Element {
  const qr = qrPath(code);
  return (
    <svg
      role="img"
      aria-label={`The session’s code, ${code}`}
      viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
      shapeRendering="crispEdges"
      className="aspect-square w-40 rounded-md bg-white"
    >
      <path d={qr.path} fill="black" />
    </svg>
  );
}

/** PF15d: who was invited, who came, and the door's code; attendance by hand. */
export function Session(props: ScreenProps<SessionData>): JSX.Element {
  const act = useAct(props);
  return (
    <Loaded load={props.load} what="the session">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={data.item.title}
            description={`${when(data.session.start)} · ${data.session.place ?? data.session.online ?? 'Online'}`}
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4">
              <DoorQr code={data.session.qr} />
              <span className="flex-1">
                <span className="block text-sm text-fg-muted">
                  Show this at the door: a learner scans it with the Kithena app, or types the code,
                  and is marked as attending
                </span>
                <span className="font-mono text-2xl font-bold tracking-widest">
                  {data.session.qr}
                </span>
              </span>
              <span className="text-sm text-fg-muted">{`${String(data.rows.filter((r) => r.attended !== null).length)} of ${String(data.rows.length)} attended`}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Invitation</TableHead>
                    <TableHead>Attended</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.assignmentId}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-sm">
                        {r.invitation.charAt(0).toUpperCase() + r.invitation.slice(1)}
                      </TableCell>
                      <TableCell>
                        <Field orientation="horizontal">
                          <FieldControl>
                            <Checkbox
                              checked={r.attended !== null}
                              onCheckedChange={(on) => {
                                act.run('MarkPerformanceAttendance', {
                                  id: r.assignmentId,
                                  input: { sessionId: data.session.id, attended: on === true },
                                });
                              }}
                            />
                          </FieldControl>
                          <FieldLabel>
                            {r.attended === null
                              ? 'No'
                              : `Yes, ${r.attended.how === 'qr' ? 'by the code' : r.attended.how === 'hand' ? 'by hand' : 'from the meeting'}`}
                          </FieldLabel>
                        </Field>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}
