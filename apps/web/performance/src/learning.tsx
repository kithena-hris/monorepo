import {
  DatePicker,
  Dropzone,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  List,
  ListItem,
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
  DataTable,
  type DataColumn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
  TimePicker,
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
import { t as tr } from './i18n';

/**
 * Learning (PRD §15; design PF15 v2): what is assigned to me, the catalogue,
 * live sessions with attendance, and assigning in three steps. An item is
 * complete when every part, the acknowledgement, the quiz and attendance are.
 */

type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';
const STATE: Readonly<Record<string, readonly [string, Tone]>> = {
  not_started: [tr('learning.assigned', 'Assigned'), 'neutral'],
  in_progress: [tr('learning.in_progress', 'In progress'), 'warning'],
  done: [tr('learning.completed', 'Completed'), 'success'],
  going: [tr('learning.going', 'Going'), 'info'],
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
    ? ([tr('learning.overdue', 'Overdue'), 'danger'] as const)
    : (STATE[state] ?? [state, 'neutral']);
  return (
    <Badge size="sm" tone={tone}>
      {label}
    </Badge>
  );
}

const KINDS = [
  ['course', tr('learning.external_course', 'External course')],
  ['session', tr('learning.live_session', 'Live session')],
  ['recording', tr('learning.recording', 'Recording')],
  ['document', tr('learning.document', 'Document')],
  ['quiz', tr('learning.quiz', 'Quiz')],
  ['path', tr('learning.path', 'Path')],
  ['link', tr('learning.link', 'Link')],
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

type CatalogueRow = LearningData['catalogue'][number];
const itemId = (i: CatalogueRow): string => i.id;
const itemTitle = (i: CatalogueRow): string => i.title;

/** PF15's catalogue: every course, session and document, assigned from the row. */
function catalogueColumns(
  onNavigate: ScreenProps<LearningData>['onNavigate'],
  assign: ((itemId: string) => void) | null,
): readonly DataColumn<CatalogueRow>[] {
  return [
    {
      id: 'item',
      header: tr('learning.item', 'Item'),
      sortBy: (i) => i.title,
      cell: (i) => (
        <>
          <To href={`/performance/learning/items/${i.id}`} onNavigate={onNavigate}>
            {i.title}
          </To>
          <span className="block text-xs text-fg-muted">
            {[i.provider, ...i.skills].join(' · ')}
          </span>
        </>
      ),
    },
    {
      id: 'kind',
      header: tr('learning.kind', 'Kind'),
      sortBy: (i) => i.kind,
      cell: (i) => <span className="text-sm">{kindWord(i.kind)}</span>,
    },
    {
      id: 'length',
      header: tr('learning.length', 'Length'),
      numeric: true,
      hideOnCard: true,
      sortBy: (i) => i.minutes,
      cell: (i) => (
        <span className="text-sm">
          {i.minutes === 0
            ? '—'
            : tr('learning.min', '{{minutes}} min', { minutes: String(i.minutes) })}
        </span>
      ),
    },
    {
      id: 'assigned',
      header: tr('learning.assigned', 'Assigned'),
      numeric: true,
      sortBy: (i) => i.assigned,
      cell: (i) => <span className="text-sm">{plural(i.assigned, 'person', 'people')}</span>,
    },
    ...(assign === null
      ? []
      : [
          {
            id: 'assign',
            header: <span className="sr-only">{tr('learning.assign', 'Assign')}</span>,
            cardTrailing: true,
            cell: (i: CatalogueRow) => (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  assign(i.id);
                }}
              >
                {tr('learning.assign', 'Assign')}
              </Button>
            ),
          },
        ]),
  ];
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
            title={tr('learning.learning', 'Learning')}
            description={tr(
              'learning.courses_sessions_and_documents_what_is',
              'Courses, sessions and documents: what is assigned to you, and everything the company offers.',
            )}
            actions={
              <>
                {data.hr ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setImporting(true);
                    }}
                  >
                    {tr('learning.import_completions', 'Import completions')}
                  </Button>
                ) : null}
                {data.hr ? (
                  <Button
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      setAdding(true);
                    }}
                  >
                    {tr('learning.add_an_item', 'Add an item')}
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
                    title={tr('learning.nothing_assigned', 'Nothing assigned')}
                    description={tr(
                      'learning.what_your_company_or_your_manager',
                      'What your company or your manager assigns you shows here and in your Inbox.',
                    )}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr('learning.item', 'Item')}</TableHead>
                        <TableHead>{tr('learning.why', 'Why')}</TableHead>
                        <TableHead>{tr('learning.due', 'Due')}</TableHead>
                        <TableHead>{tr('learning.progress', 'Progress')}</TableHead>
                        <TableHead>{tr('learning.state', 'State')}</TableHead>
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
                              ? tr('learning.completed_2', 'Completed {{completedAt}}{{value}}', {
                                  completedAt: day(a.completedAt),
                                  value: a.expires === null ? '' : ` · expires ${day(a.expires)}`,
                                })
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
            <DataTable<CatalogueRow>
              label={tr('learning.catalogue', 'Catalogue')}
              rows={data.catalogue}
              rowId={itemId}
              describeRow={itemTitle}
              fill
              empty={tr('learning.nothing_in_the_catalogue_yet', 'Nothing in the catalogue yet')}
              columns={catalogueColumns(
                props.onNavigate,
                data.hr || data.manager ? setAssigning : null,
              )}
            />
          ) : null}
          {data.tab === 'sessions' ? (
            <Card>
              <CardContent>
                {data.sessions.length === 0 ? (
                  <EmptyState
                    icon={<icons.calendar aria-hidden />}
                    title={tr('learning.no_sessions_planned', 'No sessions planned')}
                    description={tr(
                      'learning.live_sessions_in_a_room_or',
                      'Live sessions, in a room or online, are listed with who is going.',
                    )}
                  />
                ) : (
                  <List>
                    {data.sessions.map((s) => (
                      <ListItem
                        key={s.sessionId}
                        icon={<icons.meeting />}
                        description={tr('learning.text', '{{start}} · {{value}}', {
                          start: when(s.start),
                          value: s.place ?? s.online ?? 'Online',
                        })}
                        meta={tr('learning.going_2', '{{going}} going', {
                          going: plural(s.going, 'person', 'people'),
                        })}
                        trailing={
                          data.hr ? (
                            <Button size="sm" variant="secondary" asChild>
                              <a
                                href={`/performance/learning/items/${s.itemId}/sessions/${s.sessionId}`}
                              >
                                {tr('learning.attendance', 'Attendance')}
                              </a>
                            </Button>
                          ) : null
                        }
                      >
                        {s.title}
                      </ListItem>
                    ))}
                  </List>
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
      title={tr('learning.assign_2', 'Assign {{title}}', { title })}
      steps={[
        tr('learning.what', 'What'),
        tr('learning.who', 'Who'),
        tr('learning.due_and_repeat', 'Due and repeat'),
      ]}
      step={step}
      onStep={setStep}
      pending={act.pending}
      canNext={step !== 1 || people.length > 0}
      finishLabel={tr('learning.assign_to', 'Assign to {{length}}', {
        length: plural(people.length, 'person', 'people'),
      })}
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
            <FieldLabel>
              {tr('learning.why_as_the_learner_reads_it', 'Why, as the learner reads it')}
            </FieldLabel>
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
        <PersonPicker
          act={act}
          label={tr('learning.who', 'Who')}
          value={people}
          onChange={setPeople}
          many
        />
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>{tr('learning.due', 'Due')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('learning.due', 'Due')}
                value={due === '' ? null : due}
                onChange={(date) => {
                  setDue(date ?? '');
                }}
              />
            </FieldControl>
          </Field>
          <p className="text-sm text-fg-muted">
            {tr(
              'learning.an_item_that_recurs_is_assigned',
              'An item that recurs is assigned again when it expires, on the item’s own schedule.',
            )}
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
      title={tr('learning.add_a_learning_item', 'Add a learning item')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tr('learning.cancel', 'Cancel')}
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
            {tr('learning.add', 'Add')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>{tr('learning.title', 'Title')}</FieldLabel>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </Field>
      <Choose label={tr('learning.kind', 'Kind')} value={kind} options={KINDS} onChange={setKind} />
      <Field>
        <FieldLabel>{tr('learning.provider', 'Provider')}</FieldLabel>
        <Input
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
          }}
        />
      </Field>
      <NumberField
        label={tr('learning.length', 'Length')}
        suffix={tr('learning.min_2', 'min')}
        value={minutes}
        min={0}
        onChange={setMinutes}
      />
      {kind === 'session' ? (
        <>
          <Field required>
            <FieldLabel>{tr('learning.starts', 'Starts')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('learning.starts', 'Starts')}
                value={start === '' ? null : start.slice(0, 10)}
                onChange={(d) => {
                  setStart(d === null ? '' : `${d}T${start.slice(11, 16) || '09:00'}`);
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('learning.at', 'At')}</FieldLabel>
            <FieldControl>
              <TimePicker
                label={tr('learning.at', 'At')}
                value={start === '' ? null : start.slice(11, 16)}
                onChange={(t) => {
                  if (t !== null && start !== '') setStart(`${start.slice(0, 10)}T${t}`);
                }}
              />
            </FieldControl>
          </Field>
        </>
      ) : (
        <Field>
          <FieldLabel>{tr('learning.link', 'Link')}</FieldLabel>
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
        <FieldLabel>
          {tr(
            'learning.acknowledgement_the_learner_confirms',
            'Acknowledgement the learner confirms',
          )}
        </FieldLabel>
        <Input
          value={ack}
          onChange={(e) => {
            setAck(e.target.value);
          }}
          placeholder={tr(
            'learning.i_have_read_and_understood_the',
            'I have read and understood the policy',
          )}
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
      title={tr('learning.import_completions', 'Import completions')}
      description={tr(
        'learning.one_row_per_completion_email_item',
        'One row per completion: email, item title, completed on. Rows that match nobody are listed, never guessed.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tr('learning.close', 'Close')}
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
            {tr('learning.import', 'Import')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Dropzone
        label={tr('learning.drop_a_csv_file_or_choose', 'Drop a CSV file, or choose one')}
        hint={tr('learning.or_paste_the_rows_below', 'Or paste the rows below.')}
        accept=".csv,text/csv"
        rejectMessage="Only a CSV file"
        onFiles={(files) => {
          void files[0]?.text().then(setCsv);
        }}
      />
      <Textarea
        aria-label={tr('learning.completions', 'Completions')}
        className="font-mono"
        rows={8}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
        }}
        placeholder={tr(
          'learning.email_item_completed_adam_acme_com',
          'email,item,completed adam@acme.com,Security basics,2026-10-01',
        )}
      />
      {result === null ? null : (
        <Alert
          tone={result.unmatched.length === 0 ? 'success' : 'warning'}
          title={tr('learning.matched_unmatched', '{{matched}} matched · {{length}} unmatched', {
            matched: String(result.matched),
            length: String(result.unmatched.length),
          })}
        >
          {tr(
            'learning.unmatched_rows_stay_out_until_someone',
            'Unmatched rows stay out until someone fixes the email or the item.',
          )}
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
            description={tr('learning.text_2', '{{kindWord}} · {{provider}}{{value}}', {
              kindWord: kindWord(item.kind),
              provider: item.provider,
              value: item.minutes === 0 ? '' : ` · ${String(item.minutes)} min`,
            })}
            actions={
              item.url === null ? null : (
                <Button asChild startIcon={<icons.externalLink aria-hidden />}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {tr('learning.open', 'Open')}
                  </a>
                </Button>
              )
            }
          />
          <Refusal error={act.error} />
          {a === null ? (
            <Alert tone="info" title={tr('learning.not_assigned_to_you', 'Not assigned to you')}>
              {hr
                ? tr('learning.assign_it_from_the_catalogue', 'Assign it from the catalogue.')
                : tr('learning.you_can_still_open_it', 'You can still open it.')}
            </Alert>
          ) : (
            <Card>
              <CardContent>
                <KeyValues
                  layout="split"
                  items={[
                    {
                      label: tr('learning.state', 'State'),
                      value: <StateBadge state={a.state} due={a.due} />,
                    },
                    { label: tr('learning.why', 'Why'), value: a.why },
                    { label: tr('learning.due', 'Due'), value: day(a.due) },
                    ...(a.completedAt === null
                      ? []
                      : [
                          {
                            label: tr('learning.completed', 'Completed'),
                            value: day(a.completedAt),
                          },
                        ]),
                    ...(a.expiresOn === null
                      ? []
                      : [{ label: tr('learning.expires', 'Expires'), value: day(a.expiresOn) }]),
                  ]}
                />
              </CardContent>
            </Card>
          )}
          {item.parts.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>
                  {tr('learning.parts_of', 'Parts · {{value}} of {{length}}', {
                    value: String(a?.done.length ?? 0),
                    length: String(item.parts.length),
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Progress
                  value={
                    item.parts.length === 0
                      ? 0
                      : Math.round(((a?.done.length ?? 0) / item.parts.length) * 100)
                  }
                  label={tr('learning.parts_done', 'Parts done')}
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
                    <FieldLabel>
                      {tr('learning.min_3', '{{title}} · {{minutes}} min', {
                        title: p.title,
                        minutes: String(p.minutes),
                      })}
                    </FieldLabel>
                  </Field>
                ))}
              </CardContent>
            </Card>
          )}
          {item.sessions.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>{tr('learning.sessions', 'Sessions')}</CardTitle>
              </CardHeader>
              <CardContent>
                <List>
                  {item.sessions.map((s) => {
                    const mine = a?.attendance.find((x) => x.sessionId === s.id);
                    return (
                      <ListItem
                        key={s.id}
                        icon={<icons.meeting />}
                        description={s.place ?? s.online ?? tr('learning.online', 'Online')}
                        trailing={
                          <span className="flex flex-wrap items-center gap-2">
                            {a === null ? null : (
                              <SegmentedControl
                                size="sm"
                                aria-label={tr('learning.going_on', 'Going on {{start}}', {
                                  start: when(s.start),
                                })}
                                value={mine?.invitation ?? ''}
                                onValueChange={(v) => {
                                  act.run('RespondPerformanceSession', {
                                    id: a.id,
                                    sessionId: s.id,
                                    input: { invitation: v },
                                  });
                                }}
                              >
                                <SegmentedControlItem value="accepted">
                                  {tr('learning.going', 'Going')}
                                </SegmentedControlItem>
                                <SegmentedControlItem value="tentative">
                                  {tr('learning.maybe', 'Maybe')}
                                </SegmentedControlItem>
                                <SegmentedControlItem value="declined">
                                  {tr('learning.not_going', 'Not going')}
                                </SegmentedControlItem>
                              </SegmentedControl>
                            )}
                            {hr ? (
                              <Button size="sm" variant="secondary" asChild>
                                <a href={`/performance/learning/items/${item.id}/sessions/${s.id}`}>
                                  {tr('learning.attendance', 'Attendance')}
                                </a>
                              </Button>
                            ) : null}
                          </span>
                        }
                      >
                        {when(s.start)}
                      </ListItem>
                    );
                  })}
                </List>
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
                    {tr('learning.i_confirm', 'I confirm')}
                  </Button>
                ) : (
                  <Badge tone="success">
                    {tr('learning.confirmed', 'Confirmed {{acknowledgedAt}}', {
                      acknowledgedAt: day(a.acknowledgedAt),
                    })}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}
          {item.quiz === null || a === null ? null : a.quiz?.passed === true ? (
            <Alert
              tone="success"
              title={tr('learning.quiz_passed_of', 'Quiz passed · {{correct}} of {{of}}', {
                correct: String(a.quiz.correct),
                of: String(a.quiz.of),
              })}
            >
              {tr('learning.the_pass_mark_is', 'The pass mark is')} {String(item.quiz.passMark)}%.
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              {a.quiz === null ? null : (
                <Alert
                  tone="warning"
                  title={tr('learning.of_not_passed_yet', '{{correct}} of {{of}}: not passed yet', {
                    correct: String(a.quiz.correct),
                    of: String(a.quiz.of),
                  })}
                >
                  {tr(
                    'learning.the_pass_mark_is_try_again',
                    'The pass mark is {{passMark}}%. Try again.',
                    { passMark: String(item.quiz.passMark) },
                  )}
                </Alert>
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
                {tr('learning.submit_the_quiz', 'Submit the quiz')}
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
      path += tr('learning.m_h_v1h_z', 'M{{start}} {{y}}h{{value}}v1h-{{value2}}z', {
        start: String(start),
        y: String(y),
        value: String(x - start),
        value2: String(x - start),
      });
    }
  });
  return { path, size };
}

function DoorQr({ code }: { readonly code: string }): JSX.Element {
  const qr = qrPath(code);
  return (
    <svg
      role="img"
      aria-label={tr('learning.the_sessions_code', 'The session’s code, {{code}}', { code })}
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
            description={tr('learning.text', '{{start}} · {{value}}', {
              start: when(data.session.start),
              value: data.session.place ?? data.session.online ?? 'Online',
            })}
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4">
              <DoorQr code={data.session.qr} />
              <span className="flex-1">
                <span className="block text-sm text-fg-muted">
                  {tr(
                    'learning.show_this_at_the_door_a',
                    'Show this at the door: a learner scans it with the Kithena app, or types the code, and is marked as attending',
                  )}
                </span>
                <span className="font-mono text-2xl font-bold tracking-widest">
                  {data.session.qr}
                </span>
              </span>
              <span className="text-sm text-fg-muted">
                {tr('learning.of_attended', '{{length}} of {{length2}} attended', {
                  length: String(data.rows.filter((r) => r.attended !== null).length),
                  length2: String(data.rows.length),
                })}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('learning.person', 'Person')}</TableHead>
                    <TableHead>{tr('learning.invitation', 'Invitation')}</TableHead>
                    <TableHead>{tr('learning.attended', 'Attended')}</TableHead>
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
                              ? tr('learning.no', 'No')
                              : tr('learning.yes', 'Yes, {{value}}', {
                                  value:
                                    r.attended.how === 'qr'
                                      ? 'by the code'
                                      : r.attended.how === 'hand'
                                        ? 'by hand'
                                        : 'from the meeting',
                                })}
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
