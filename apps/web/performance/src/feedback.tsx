import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  PageHeader,
  RadioCard,
  RadioGroup,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { FormView, Paragraphs } from './form-view';
import { Loaded } from './load';
import {
  Choose,
  Modal,
  Person,
  PersonPicker,
  Refusal,
  StepDialog,
  SwitchRow,
  To,
  day,
  plural,
  useAct,
  when,
  type Act,
  type Found,
} from './shared';
import type { Answers, FormDefinition, ScreenProps } from './types';

/**
 * Feedback and notes (PRD §12, §13; design PF14, PF21 v2): what reached me,
 * what I sent (undone within ten minutes), requests, praise, and giving in
 * three steps: to whom, what, and who sees it. A writer the company hides
 * reads "Someone at the company".
 */

type Audience = 'recipient' | 'recipient_manager' | 'manager_only' | 'everyone';

export interface FeedbackData {
  readonly tab: string;
  readonly received: readonly {
    readonly id: string;
    readonly from: string | null;
    readonly kind: string;
    readonly body: string;
    readonly value: string | null;
    readonly at: string;
    readonly audience: Audience;
    readonly template: string | null;
  }[];
  readonly sent: readonly {
    readonly id: string;
    readonly to: string;
    readonly kind: string;
    readonly body: string;
    readonly value: string | null;
    readonly at: string;
    readonly audience: Audience;
    readonly undone: boolean;
    readonly undoUntil: string | null;
  }[];
  readonly open: readonly {
    readonly id: string;
    readonly from: string;
    readonly about: string;
    readonly aboutId: string;
    readonly question: string | null;
    readonly topic: string | null;
    readonly due: string | null;
    readonly templateId: string | null;
  }[];
  readonly asked: readonly {
    readonly id: string;
    readonly to: readonly string[];
    readonly about: string;
    readonly topic: string | null;
    readonly answered: number;
    readonly of: number;
  }[];
  readonly praise: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly body: string;
    readonly value: string | null;
    readonly at: string;
  }[];
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly definition: FormDefinition | null;
  }[];
  readonly settings: {
    readonly names: 'never' | 'always' | 'writer';
    readonly sees: string;
    readonly audiences: readonly Audience[];
    readonly praiseAudiences: readonly Audience[];
    readonly values: readonly string[];
    readonly toneCheck: boolean;
    readonly on: boolean;
  };
}

const plain = (html: string): string =>
  html
    .replaceAll(/<[^>]*>/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const audienceWords = (a: Audience, name: string): string =>
  a === 'recipient'
    ? `Only ${name}`
    : a === 'recipient_manager'
      ? `${name} and their manager`
      : a === 'manager_only'
        ? `Only ${name}’s manager`
        : 'Everyone at the company';

export function Feedback(props: ScreenProps<FeedbackData>): JSX.Element {
  const act = useAct(props);
  const [giving, setGiving] = useState<{
    to: string | null;
    requestId: string | null;
    templateId: string | null;
  } | null>(
    props.search?.['give'] === '1' ? { to: null, requestId: null, templateId: null } : null,
  );
  const [asking, setAsking] = useState(props.search?.['ask'] === '1');
  return (
    <Loaded load={props.load} what="feedback">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Feedback"
            description="Given whenever it is useful, outside any cycle. Praise can be seen by everyone; the rest only by who the writer chose."
            actions={
              data.settings.on ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAsking(true);
                    }}
                  >
                    Request feedback
                  </Button>
                  <Button
                    onClick={() => {
                      setGiving({ to: null, requestId: null, templateId: null });
                    }}
                  >
                    Give feedback
                  </Button>
                </>
              ) : null
            }
          />
          <Refusal error={act.error} />
          {data.settings.on ? null : (
            <Alert tone="info" title="Feedback is off at this company">
              An administrator turns it on in Settings › Performance › Feedback.
            </Alert>
          )}
          {data.tab === 'received' ? (
            <List
              empty="Feedback you receive shows here."
              rows={data.received.map((f) => ({
                id: f.id,
                who: f.from ?? 'Someone at the company',
                sub: `${f.kind === 'praise' ? 'Praise' : (f.template ?? 'Feedback')}${f.value === null ? '' : ` · ${f.value}`} · ${day(f.at)}`,
                body: f.body,
              }))}
            />
          ) : null}
          {data.tab === 'sent' ? (
            <Card>
              <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                {data.sent.length === 0 ? (
                  <EmptyState
                    icon={<icons.message aria-hidden />}
                    title="Nothing sent yet"
                    description="Feedback you give shows here; you can take it back for ten minutes."
                  />
                ) : (
                  data.sent.map((f) => (
                    <div key={f.id} className="flex flex-col gap-2 py-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <Person
                          name={f.to}
                          sub={`${f.kind === 'praise' ? 'Praise' : 'Feedback'} · ${audienceWords(f.audience, f.to)} · ${day(f.at)}`}
                        />
                        {f.undone ? (
                          <Badge size="sm">Taken back</Badge>
                        ) : f.undoUntil !== null && Date.parse(f.undoUntil) > Date.now() ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-auto"
                            loading={act.pending}
                            onClick={() => {
                              act.run('UndoPerformanceFeedback', { id: f.id });
                            }}
                          >
                            {`Delete until ${when(f.undoUntil).split(', ').at(-1) ?? ''}`}
                          </Button>
                        ) : null}
                      </span>
                      <Paragraphs html={f.body} muted={f.undone} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
          {data.tab === 'requests' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle level={2}>Asked of you</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.open.length === 0 ? (
                    <p className="text-sm text-fg-muted">Nobody is waiting on you.</p>
                  ) : (
                    data.open.map((r) => (
                      <div key={r.id} className="flex flex-col gap-2 py-3">
                        <Person
                          name={r.from}
                          sub={`About ${r.about}${r.due === null ? '' : ` · by ${day(r.due)}`}`}
                        />
                        {r.question === null ? null : <p className="text-sm">{r.question}</p>}
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setGiving({
                                to: r.aboutId,
                                requestId: r.id,
                                templateId: r.templateId,
                              });
                            }}
                          >
                            Answer
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={act.pending}
                            onClick={() => {
                              act.run('DeclinePerformanceRequest', { id: r.id });
                            }}
                          >
                            Decline
                          </Button>
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle level={2}>You asked</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.asked.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Ask people you work with how something went.
                    </p>
                  ) : (
                    data.asked.map((r) => (
                      <div key={r.id} className="py-3">
                        <p className="font-medium">{r.topic ?? `About ${r.about}`}</p>
                        <p className="text-sm text-fg-muted">{`${r.to.join(', ')} · ${String(r.answered)} of ${String(r.of)} answered`}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
          {data.tab === 'praise' ? (
            <List
              empty="Praise given in public shows here, for everyone."
              rows={data.praise.map((p) => ({
                id: p.id,
                who: `${p.from} → ${p.to}`,
                sub: `${p.value ?? 'Praise'} · ${day(p.at)}`,
                body: p.body,
              }))}
            />
          ) : null}
          {giving === null ? null : (
            <Give
              data={data}
              act={act}
              start={giving}
              onClose={() => {
                setGiving(null);
                props.onFilter?.({ give: null });
              }}
            />
          )}
          {asking ? (
            <Ask
              data={data}
              act={act}
              onClose={() => {
                setAsking(false);
                props.onFilter?.({ ask: null });
              }}
            />
          ) : null}
        </div>
      )}
    </Loaded>
  );
}

function List({
  rows,
  empty,
}: {
  readonly rows: readonly { id: string; who: string; sub: string; body: string }[];
  readonly empty: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
        {rows.length === 0 ? (
          <EmptyState
            icon={<icons.message aria-hidden />}
            title="Nothing yet"
            description={empty}
          />
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 py-3">
              <Person name={r.who} sub={r.sub} />
              <Paragraphs html={r.body} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** PF14b v2: To · Write · Who sees it. */
function Give({
  data,
  act,
  start,
  onClose,
}: {
  readonly data: FeedbackData;
  readonly act: Act;
  readonly start: { to: string | null; requestId: string | null; templateId: string | null };
  readonly onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState(start.to === null ? 0 : 1);
  const [to, setTo] = useState<readonly string[]>(start.to === null ? [] : [start.to]);
  const [toName, setToName] = useState('them');
  const [how, setHow] = useState<'write' | 'template' | 'praise'>(
    start.templateId === null ? 'write' : 'template',
  );
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState(start.templateId ?? data.templates[0]?.id ?? '');
  const [answers, setAnswers] = useState<Answers>({});
  const [value, setValue] = useState<string | null>(null);
  const praise = how === 'praise';
  const choices = praise ? data.settings.praiseAudiences : data.settings.audiences;
  const [audience, setAudience] = useState<Audience>(choices[0] ?? 'recipient_manager');
  const [showName, setShowName] = useState(data.settings.names !== 'never');
  const [tone, setTone] = useState<{
    verdict: string;
    flags: readonly { sentence: string; title: string; suggestion: string }[];
  } | null>(null);
  const template = data.templates.find((t) => t.id === templateId);
  const send = (): void => {
    act.run(
      'GivePerformanceFeedback',
      {
        input: {
          to: to[0],
          kind: praise ? 'praise' : 'feedback',
          body: how === 'template' ? '' : body,
          audience: choices.includes(audience) ? audience : (choices[0] ?? 'recipient'),
          showName:
            praise ||
            data.settings.names === 'always' ||
            (data.settings.names === 'writer' && showName),
          value: praise ? value : null,
          templateId: how === 'template' ? templateId : null,
          answers: how === 'template' ? answers : null,
          requestId: start.requestId,
        },
      },
      onClose,
    );
  };
  return (
    <StepDialog
      open
      wide
      onClose={onClose}
      title={start.requestId === null ? 'Give feedback' : 'Answer a request'}
      steps={['To', 'Write', 'Who sees it']}
      step={step}
      onStep={setStep}
      finish={send}
      finishLabel="Send"
      pending={act.pending}
      canNext={
        step === 0
          ? to.length === 1
          : step === 1
            ? how === 'template'
              ? templateId !== ''
              : plain(body).length > 0
            : true
      }
    >
      <Refusal error={act.error} />
      {step === 0 ? (
        <PersonPicker
          act={act}
          label="Who is it for?"
          value={to}
          onChange={(ids, people: readonly Found[]) => {
            setTo(ids);
            setToName(people[0]?.name.split(' ')[0] ?? 'them');
          }}
        />
      ) : null}
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <SegmentedControl
            aria-label="How"
            value={how}
            onValueChange={(v) => {
              setHow(v === 'template' ? 'template' : v === 'praise' ? 'praise' : 'write');
            }}
          >
            <SegmentedControlItem value="write">Write</SegmentedControlItem>
            <SegmentedControlItem value="template" disabled={data.templates.length === 0}>
              Use a template
            </SegmentedControlItem>
            <SegmentedControlItem value="praise">Praise</SegmentedControlItem>
          </SegmentedControl>
          {how === 'template' ? (
            <>
              <Choose
                label="Template"
                value={templateId}
                options={data.templates.map((t) => [t.id, t.name] as const)}
                onChange={setTemplateId}
              />
              {template?.definition === null || template === undefined ? null : (
                <FormView
                  definition={template.definition}
                  answers={answers}
                  editable
                  onChange={(id, a) => {
                    setAnswers({ ...answers, [id]: a });
                  }}
                  subject={toName}
                />
              )}
            </>
          ) : (
            <>
              {praise && data.settings.values.length > 0 ? (
                <ChipRow aria-label="Company value">
                  {data.settings.values.map((v) => (
                    <Chip
                      key={v}
                      selected={value === v}
                      onClick={() => {
                        setValue(value === v ? null : v);
                      }}
                    >
                      {v}
                    </Chip>
                  ))}
                </ChipRow>
              ) : null}
              <RichTextEditor
                aria-label="Your feedback"
                value={body}
                onChange={setBody}
                toolbar={['inline', 'lists']}
                minHeight="8rem"
              />
              {data.settings.toneCheck && !praise ? (
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    disabled={plain(body).length < 10}
                    loading={act.pending}
                    onClick={() => {
                      void act.call('PerformanceToneCheck', { input: { text: body } }).then((d) => {
                        if (d.ok) setTone(d.data as NonNullable<typeof tone>);
                      });
                    }}
                  >
                    Check the tone
                  </Button>
                  {tone === null ? null : (
                    <Alert
                      tone={tone.flags.length === 0 ? 'success' : 'warning'}
                      title={tone.verdict}
                    >
                      {tone.flags.map((f) => (
                        <p key={f.sentence}>{`“${f.sentence}”: ${f.title}. ${f.suggestion}`}</p>
                      ))}
                    </Alert>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-3">
          {data.settings.names === 'writer' && !praise ? (
            <SwitchRow
              label="Show my name"
              hint={
                showName
                  ? `${toName} sees it is from you`
                  : `${toName} reads “Someone at the company”; their manager and HR still see your name`
              }
              checked={showName}
              onChange={setShowName}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              {praise || data.settings.names === 'always'
                ? 'Your name is shown.'
                : 'Your name is hidden from the person; their manager and HR see it.'}
            </p>
          )}
          <RadioGroup
            aria-label="Who sees it"
            value={audience}
            onValueChange={(v) => {
              setAudience(v as Audience);
            }}
          >
            {choices.map((a) => (
              <RadioCard key={a} value={a}>
                {audienceWords(a, toName)}
              </RadioCard>
            ))}
          </RadioGroup>
        </div>
      ) : null}
    </StepDialog>
  );
}

/** PF14e: ask for feedback about me or about a report. */
function Ask({
  data,
  act,
  onClose,
}: {
  readonly data: FeedbackData;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [about, setAbout] = useState<'me' | 'report'>('me');
  const [report, setReport] = useState<readonly string[]>([]);
  const [to, setTo] = useState<readonly string[]>([]);
  const [question, setQuestion] = useState('');
  const [topic, setTopic] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [due, setDue] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Request feedback"
      description="Each person gets it in their Inbox; answers come back to you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={to.length === 0 || (about === 'report' && report.length === 0)}
            loading={act.pending}
            onClick={() => {
              act.run(
                'RequestPerformanceFeedback',
                {
                  input: {
                    to,
                    about: about === 'report' ? (report[0] ?? null) : null,
                    question: question.trim() === '' ? null : question,
                    templateId: templateId === '' ? null : templateId,
                    topic: topic.trim() === '' ? null : topic,
                    due: due === '' ? null : due,
                  },
                },
                onClose,
              );
            }}
          >
            Send requests
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <SegmentedControl
        aria-label="About"
        value={about}
        onValueChange={(v) => {
          setAbout(v === 'report' ? 'report' : 'me');
        }}
      >
        <SegmentedControlItem value="me">About me</SegmentedControlItem>
        <SegmentedControlItem value="report">About a report</SegmentedControlItem>
      </SegmentedControl>
      {about === 'report' ? (
        <PersonPicker act={act} label="Which report?" value={report} onChange={setReport} />
      ) : null}
      <PersonPicker
        act={act}
        label="Who to ask (up to 10)"
        value={to}
        onChange={(ids) => {
          setTo(ids.slice(0, 10));
        }}
        many
      />
      <Field>
        <FieldLabel>Topic</FieldLabel>
        <Input
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
          }}
          placeholder="The ledger migration"
        />
      </Field>
      <Field>
        <FieldLabel>Your question</FieldLabel>
        <Textarea
          autoResize
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
        />
      </Field>
      {data.templates.length === 0 ? null : (
        <Choose
          label="Or a template"
          value={templateId === '' ? 'none' : templateId}
          options={[['none', 'No template'], ...data.templates.map((t) => [t.id, t.name] as const)]}
          onChange={(v) => {
            setTemplateId(v === 'none' ? '' : v);
          }}
        />
      )}
      <Field>
        <FieldLabel>Answer by</FieldLabel>
        <Input
          type="date"
          value={due}
          onChange={(e) => {
            setDue(e.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}

/* --------------------------------------------------------------- notes -- */

interface Note {
  readonly id: string;
  readonly about: string;
  readonly title: string;
  readonly body: string;
  readonly shared: boolean;
  readonly at: string;
  readonly source?: string | null;
}

export interface NotesData {
  readonly people: readonly {
    readonly personId: string;
    readonly name: string;
    readonly title: string;
    readonly notes: number;
  }[];
  readonly about: string | null;
  readonly aboutName: string | null;
  readonly notes: readonly Note[];
  readonly sharedWithMe: readonly (Note & { readonly authorName: string })[];
}

/** PF21: notes about my own work and each report; only me, unless I share one. */
export function Notes(props: ScreenProps<NotesData>): JSX.Element {
  const act = useAct(props);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  return (
    <Loaded load={props.load} what="your notes">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Notes"
            description="Only you see your notes, until you share one. They are evidence when you write a review."
            actions={
              data.about === null ? null : (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setEditing('new');
                  }}
                >
                  New note
                </Button>
              )
            }
          />
          <Refusal error={act.error} />
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardContent className="flex flex-col gap-1">
                {data.people.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    Notes about your reports, and anyone you note, are listed here.
                  </p>
                ) : (
                  data.people.map((p) => (
                    <To
                      key={p.personId}
                      href={`/performance/notes?about=${p.personId}`}
                      onNavigate={props.onNavigate}
                      className={`rounded-md px-2 py-1.5 ${p.personId === data.about ? 'bg-surface-sunken font-semibold' : ''}`}
                    >
                      {`${p.name} · ${String(p.notes)}`}
                    </To>
                  ))
                )}
              </CardContent>
            </Card>
            <div className="flex flex-col gap-3">
              {data.notes.length === 0 ? (
                <EmptyState
                  icon={<icons.edit aria-hidden />}
                  title={
                    data.aboutName === null ? 'No notes yet' : `No notes about ${data.aboutName}`
                  }
                  description="Write down what happened while you remember it."
                />
              ) : (
                data.notes.map((n) => (
                  <Card key={n.id}>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                      <CardTitle level={2}>{n.title === '' ? day(n.at) : n.title}</CardTitle>
                      <span className="flex flex-wrap gap-2">
                        <Badge size="sm" tone={n.shared ? 'accent' : 'neutral'}>
                          {n.shared ? 'Shared' : 'Only you'}
                        </Badge>
                        {n.source === 'slack' ? <Badge size="sm">Saved from Slack</Badge> : null}
                      </span>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <Paragraphs html={n.body} />
                      <span className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(n);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            props.onNavigate?.(`/performance/feedback/sent?give=1`);
                          }}
                        >
                          Turn into feedback
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={act.pending}
                          onClick={() => {
                            act.run('DeletePerformanceNote', { id: n.id });
                          }}
                        >
                          Delete
                        </Button>
                      </span>
                    </CardContent>
                  </Card>
                ))
              )}
              {data.sharedWithMe.length === 0 ? null : (
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>Shared with you</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {data.sharedWithMe.map((n) => (
                      <div key={n.id} className="flex flex-col gap-1">
                        <Person name={n.authorName} sub={`${n.title} · ${day(n.at)}`} />
                        <Paragraphs html={n.body} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
          {editing === null || data.about === null ? null : (
            <NoteDialog
              act={act}
              about={data.about}
              note={editing === 'new' ? null : editing}
              onClose={() => {
                setEditing(null);
              }}
            />
          )}
        </div>
      )}
    </Loaded>
  );
}

function NoteDialog({
  act,
  about,
  note,
  onClose,
}: {
  readonly act: Act;
  readonly about: string;
  readonly note: Note | null;
  readonly onClose: () => void;
}): JSX.Element {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [shared, setShared] = useState(note?.shared ?? false);
  return (
    <Modal
      open
      onClose={onClose}
      title={note === null ? 'New note' : 'Edit note'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={plain(body) === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'SavePerformanceNote',
                { input: { id: note?.id ?? null, about, title, body, shared } },
                onClose,
              );
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field>
        <FieldLabel>Title</FieldLabel>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </Field>
      <RichTextEditor
        aria-label="Note"
        value={body}
        onChange={setBody}
        toolbar={['inline', 'lists']}
        minHeight="8rem"
      />
      <SwitchRow
        label="Share with the person"
        hint={shared ? 'They see this note' : 'Only you'}
        checked={shared}
        onChange={setShared}
      />
      <p className="text-xs text-fg-muted">
        {plural(plain(body).split(' ').filter(Boolean).length, 'word')}
      </p>
    </Modal>
  );
}
