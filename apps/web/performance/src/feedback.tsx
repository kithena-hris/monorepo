import {
  FieldControl,
  DatePicker,
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
  List,
  ListItem,
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

import { FormView, Paragraphs, paragraphs } from './form-view';
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
  useAct,
  when,
  type Act,
  type Found,
} from './shared';
import type { Answers, FormDefinition, ScreenProps } from './types';
import { t as tr } from './i18n';

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

const plain = (html: string): string => paragraphs(html).join(' ');

const audienceWords = (a: Audience, name: string): string =>
  a === 'recipient'
    ? tr('feedback.only', 'Only {{name}}', { name })
    : a === 'recipient_manager'
      ? tr('feedback.and_their_manager', '{{name}} and their manager', { name })
      : a === 'manager_only'
        ? tr('feedback.only_s_manager', 'Only {{name}}’s manager', { name })
        : tr('feedback.everyone_at_the_company', 'Everyone at the company');

export function Feedback(props: ScreenProps<FeedbackData>): JSX.Element {
  const act = useAct(props);
  const [giving, setGiving] = useState<{
    to: string | null;
    requestId: string | null;
    templateId: string | null;
  } | null>(
    // `?give=1`, and `&to=<person>` from another module (People's "Give feedback").
    props.search?.['give'] === '1'
      ? { to: props.search['to'] ?? null, requestId: null, templateId: null }
      : null,
  );
  const [asking, setAsking] = useState(props.search?.['ask'] === '1');
  return (
    <Loaded load={props.load} what="feedback">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={
              data.tab === 'praise'
                ? tr('feedback.recognition', 'Recognition')
                : tr('feedback.feedback', 'Feedback')
            }
            description={tr(
              'feedback.given_whenever_it_is_useful_outside',
              'Given whenever it is useful, outside any cycle. Praise can be seen by everyone; the rest only by who the writer chose.',
            )}
            actions={
              data.settings.on ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAsking(true);
                    }}
                  >
                    {tr('feedback.request_feedback', 'Request feedback')}
                  </Button>
                  <Button
                    onClick={() => {
                      setGiving({ to: null, requestId: null, templateId: null });
                    }}
                  >
                    {tr('feedback.give_feedback', 'Give feedback')}
                  </Button>
                </>
              ) : null
            }
          />
          <Refusal error={act.error} />
          {data.settings.on ? null : (
            <Alert
              tone="info"
              title={tr(
                'feedback.feedback_is_off_at_this_company',
                'Feedback is off at this company',
              )}
            >
              {tr(
                'feedback.an_administrator_turns_it_on_in',
                'An administrator turns it on in Settings › Performance › Feedback.',
              )}
            </Alert>
          )}
          {data.tab === 'received' ? (
            <Posts
              empty={tr(
                'feedback.feedback_you_receive_shows_here',
                'Feedback you receive shows here.',
              )}
              rows={data.received.map((f) => ({
                id: f.id,
                who: f.from ?? tr('feedback.someone_at_the_company', 'Someone at the company'),
                sub: [
                  f.kind === 'praise'
                    ? tr('feedback.praise', 'Praise')
                    : (f.template ?? tr('feedback.feedback', 'Feedback')),
                  ...(f.value === null ? [] : [f.value]),
                  day(f.at),
                ].join(' · '),
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
                    title={tr('feedback.nothing_sent_yet', 'Nothing sent yet')}
                    description={tr(
                      'feedback.feedback_you_give_shows_here_you',
                      'Feedback you give shows here; you can take it back for ten minutes.',
                    )}
                  />
                ) : (
                  data.sent.map((f) => (
                    <div key={f.id} className="flex flex-col gap-2 py-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <Person
                          name={f.to}
                          sub={tr('feedback.text_2', '{{value}} · {{audienceWords}} · {{at}}', {
                            value:
                              f.kind === 'praise'
                                ? tr('feedback.praise', 'Praise')
                                : tr('feedback.feedback', 'Feedback'),
                            audienceWords: audienceWords(f.audience, f.to),
                            at: day(f.at),
                          })}
                        />
                        {f.undone ? (
                          <Badge size="sm">{tr('feedback.taken_back', 'Taken back')}</Badge>
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
                            {tr('feedback.delete_until', 'Delete until {{value}}', {
                              value: when(f.undoUntil).split(', ').at(-1) ?? '',
                            })}
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
                  <CardTitle level={2}>{tr('feedback.asked_of_you', 'Asked of you')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.open.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {tr('feedback.nobody_is_waiting_on_you', 'Nobody is waiting on you.')}
                    </p>
                  ) : (
                    data.open.map((r) => (
                      <div key={r.id} className="flex flex-col gap-2 py-3">
                        <Person
                          name={r.from}
                          sub={
                            r.due === null
                              ? tr('feedback.about', 'About {{about}}', { about: r.about })
                              : tr('feedback.about_by', 'About {{about}} · by {{due}}', {
                                  about: r.about,
                                  due: day(r.due),
                                })
                          }
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
                            {tr('feedback.answer', 'Answer')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={act.pending}
                            onClick={() => {
                              act.run('DeclinePerformanceRequest', { id: r.id });
                            }}
                          >
                            {tr('feedback.decline', 'Decline')}
                          </Button>
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle level={2}>{tr('feedback.you_asked', 'You asked')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.asked.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {tr(
                        'feedback.ask_people_you_work_with_how',
                        'Ask people you work with how something went.',
                      )}
                    </p>
                  ) : (
                    <List>
                      {data.asked.map((r) => (
                        <ListItem
                          key={r.id}
                          description={r.to.join(', ')}
                          trailing={
                            <Badge size="sm" tone={r.answered === r.of ? 'success' : 'neutral'}>
                              {tr('feedback.of', '{{answered}} of {{of}}', {
                                answered: String(r.answered),
                                of: String(r.of),
                              })}
                            </Badge>
                          }
                        >
                          {r.topic ?? tr('feedback.about_2', 'About {{about}}', { about: r.about })}
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
          {data.tab === 'praise' ? (
            <Posts
              empty={tr(
                'feedback.praise_given_in_public_shows_here',
                'Praise given in public shows here, for everyone.',
              )}
              rows={data.praise.map((p) => ({
                id: p.id,
                who: tr('feedback.text_3', '{{from}} → {{to}}', { from: p.from, to: p.to }),
                sub: tr('feedback.text_4', '{{value}} · {{at}}', {
                  value: p.value ?? tr('feedback.praise', 'Praise'),
                  at: day(p.at),
                }),
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

function Posts({
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
            title={tr('feedback.nothing_yet', 'Nothing yet')}
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
    flags: readonly { sentence: string; title: string; advice: string | null }[];
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
      title={
        start.requestId === null
          ? tr('feedback.give_feedback', 'Give feedback')
          : tr('feedback.answer_a_request', 'Answer a request')
      }
      steps={[
        tr('feedback.to', 'To'),
        tr('feedback.write', 'Write'),
        tr('feedback.who_sees_it', 'Who sees it'),
      ]}
      step={step}
      onStep={setStep}
      finish={send}
      finishLabel={tr('feedback.send', 'Send')}
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
          label={tr('feedback.who_is_it_for', 'Who is it for?')}
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
            aria-label={tr('feedback.how', 'How')}
            value={how}
            onValueChange={(v) => {
              setHow(v === 'template' ? 'template' : v === 'praise' ? 'praise' : 'write');
            }}
          >
            <SegmentedControlItem value="write">
              {tr('feedback.write', 'Write')}
            </SegmentedControlItem>
            <SegmentedControlItem value="template" disabled={data.templates.length === 0}>
              {tr('feedback.use_a_template', 'Use a template')}
            </SegmentedControlItem>
            <SegmentedControlItem value="praise">
              {tr('feedback.praise', 'Praise')}
            </SegmentedControlItem>
          </SegmentedControl>
          {how === 'template' ? (
            <>
              <Choose
                label={tr('feedback.template', 'Template')}
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
                <ChipRow aria-label={tr('feedback.company_value', 'Company value')}>
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
                aria-label={tr('feedback.your_feedback', 'Your feedback')}
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
                    {tr('feedback.check_the_tone', 'Check the tone')}
                  </Button>
                  {tone === null ? null : (
                    <Alert
                      tone={tone.flags.length === 0 ? 'success' : 'warning'}
                      title={tone.verdict}
                    >
                      {tone.flags.map((f) => (
                        <p key={f.sentence}>
                          {tr('feedback.text_5', '“{{sentence}}”: {{title}}.{{value}}', {
                            sentence: f.sentence,
                            title: f.title,
                            value: f.advice === null ? '' : ` ${f.advice}`,
                          })}
                        </p>
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
              label={tr('feedback.show_my_name', 'Show my name')}
              hint={
                showName
                  ? tr('feedback.sees_it_is_from_you', '{{toName}} sees it is from you', { toName })
                  : tr(
                      'feedback.reads_someone_at_the_company',
                      '{{toName}} reads “Someone at the company”; their manager and HR still see your name',
                      { toName },
                    )
              }
              checked={showName}
              onChange={setShowName}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              {praise || data.settings.names === 'always'
                ? tr('feedback.your_name_is_shown', 'Your name is shown.')
                : tr(
                    'feedback.your_name_is_hidden_from_the_person',
                    'Your name is hidden from the person; their manager and HR see it.',
                  )}
            </p>
          )}
          <RadioGroup
            aria-label={tr('feedback.who_sees_it', 'Who sees it')}
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
      title={tr('feedback.request_feedback', 'Request feedback')}
      description={tr(
        'feedback.each_person_gets_it_in_their',
        'Each person gets it in their Inbox; answers come back to you.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tr('feedback.cancel', 'Cancel')}
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
            {tr('feedback.send_requests', 'Send requests')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <SegmentedControl
        aria-label={tr('feedback.about_3', 'About')}
        value={about}
        onValueChange={(v) => {
          setAbout(v === 'report' ? 'report' : 'me');
        }}
      >
        <SegmentedControlItem value="me">
          {tr('feedback.about_me', 'About me')}
        </SegmentedControlItem>
        <SegmentedControlItem value="report">
          {tr('feedback.about_a_report', 'About a report')}
        </SegmentedControlItem>
      </SegmentedControl>
      {about === 'report' ? (
        <PersonPicker
          act={act}
          label={tr('feedback.which_report', 'Which report?')}
          value={report}
          onChange={setReport}
        />
      ) : null}
      <PersonPicker
        act={act}
        label={tr('feedback.who_to_ask_up_to_10', 'Who to ask (up to 10)')}
        value={to}
        onChange={(ids) => {
          setTo(ids.slice(0, 10));
        }}
        many
      />
      <Field>
        <FieldLabel>{tr('feedback.topic', 'Topic')}</FieldLabel>
        <Input
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
          }}
          placeholder={tr('feedback.the_ledger_migration', 'The ledger migration')}
        />
      </Field>
      <Field>
        <FieldLabel>{tr('feedback.your_question', 'Your question')}</FieldLabel>
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
          label={tr('feedback.or_a_template', 'Or a template')}
          value={templateId === '' ? 'none' : templateId}
          options={[
            ['none', tr('feedback.no_template', 'No template')],
            ...data.templates.map((t) => [t.id, t.name] as const),
          ]}
          onChange={(v) => {
            setTemplateId(v === 'none' ? '' : v);
          }}
        />
      )}
      <Field>
        <FieldLabel>{tr('feedback.answer_by', 'Answer by')}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={tr('feedback.answer_by', 'Answer by')}
            value={due === '' ? null : due}
            onChange={(date) => {
              setDue(date ?? '');
            }}
          />
        </FieldControl>
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
    <Loaded load={props.load} what={tr('feedback.your_notes', 'your notes')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('feedback.private_notes', 'Private notes')}
            description={tr(
              'feedback.only_you_see_your_notes_until',
              'Only you see your notes, until you share one. They are evidence when you write a review.',
            )}
            actions={
              data.about === null ? null : (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setEditing('new');
                  }}
                >
                  {tr('feedback.new_note', 'New note')}
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
                    {tr(
                      'feedback.notes_about_your_reports_and_anyone',
                      'Notes about your reports, and anyone you note, are listed here.',
                    )}
                  </p>
                ) : (
                  data.people.map((p) => (
                    <To
                      key={p.personId}
                      href={`/performance/notes?about=${p.personId}`}
                      onNavigate={props.onNavigate}
                      className={`rounded-md px-2 py-1.5 ${p.personId === data.about ? 'bg-surface-sunken font-semibold' : ''}`}
                    >
                      {tr('feedback.text_6', '{{name}} · {{notes}}', {
                        name: p.name,
                        notes: String(p.notes),
                      })}
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
                    data.aboutName === null
                      ? tr('feedback.no_notes_yet', 'No notes yet')
                      : tr('feedback.no_notes_about', 'No notes about {{aboutName}}', {
                          aboutName: data.aboutName,
                        })
                  }
                  description={tr(
                    'feedback.write_down_what_happened_while_you',
                    'Write down what happened while you remember it.',
                  )}
                />
              ) : (
                data.notes.map((n) => (
                  <Card key={n.id}>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                      <CardTitle level={2}>{n.title === '' ? day(n.at) : n.title}</CardTitle>
                      <span className="flex flex-wrap gap-2">
                        <Badge size="sm" tone={n.shared ? 'accent' : 'neutral'}>
                          {n.shared
                            ? tr('feedback.shared', 'Shared')
                            : tr('feedback.only_you', 'Only you')}
                        </Badge>
                        {n.source === 'slack' ? (
                          <Badge size="sm">
                            {tr('feedback.saved_from_slack', 'Saved from Slack')}
                          </Badge>
                        ) : null}
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
                          {tr('feedback.edit', 'Edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            props.onNavigate?.(`/performance/feedback/sent?give=1`);
                          }}
                        >
                          {tr('feedback.turn_into_feedback', 'Turn into feedback')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={act.pending}
                          onClick={() => {
                            act.run('DeletePerformanceNote', { id: n.id });
                          }}
                        >
                          {tr('feedback.delete', 'Delete')}
                        </Button>
                      </span>
                    </CardContent>
                  </Card>
                ))
              )}
              {data.sharedWithMe.length === 0 ? null : (
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>
                      {tr('feedback.shared_with_you', 'Shared with you')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {data.sharedWithMe.map((n) => (
                      <div key={n.id} className="flex flex-col gap-1">
                        <Person
                          name={n.authorName}
                          sub={tr('feedback.text_7', '{{title}} · {{at}}', {
                            title: n.title,
                            at: day(n.at),
                          })}
                        />
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
      title={
        note === null ? tr('feedback.new_note', 'New note') : tr('feedback.edit_note', 'Edit note')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tr('feedback.cancel', 'Cancel')}
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
            {tr('feedback.save', 'Save')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field>
        <FieldLabel>{tr('feedback.title', 'Title')}</FieldLabel>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </Field>
      <RichTextEditor
        aria-label={tr('feedback.note', 'Note')}
        value={body}
        onChange={setBody}
        toolbar={['inline', 'lists']}
        minHeight="8rem"
      />
      <SwitchRow
        label={tr('feedback.share_with_the_person', 'Share with the person')}
        hint={
          shared
            ? tr('feedback.they_see_this_note', 'They see this note')
            : tr('feedback.only_you', 'Only you')
        }
        checked={shared}
        onChange={setShared}
      />
      <p className="text-xs text-fg-muted">
        {tr(
          'feedback.count_words',
          { one: '{{count}} word', other: '{{count}} words' },
          { count: plain(body).split(' ').filter(Boolean).length },
        )}
      </p>
    </Modal>
  );
}
