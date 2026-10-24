import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  KeyValues,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  TimelineItem,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, day, money, useAct, when, words } from './shared';
import { EmailComposer, type ComposedEmail } from './composer';
import { AskList } from './interviews';
import { RejectDialog, type Rejecting } from './reject-dialog';
import type { CandidateData, CandidatesData, PoolsData, ScreenProps } from './types';
import { t as tr } from './i18n';

/**
 * R11, R12, a candidate (design R11–R12): one record across applications.
 * The applications on the left; on the right the chosen one's stage and
 * actions, then tabs for the profile, answers, interviews, messages,
 * activity and offers, each as the viewer's role allows. The tab is in the
 * address.
 */

const TABS = ['profile', 'process', 'messages'] as const;
type Tab = (typeof TABS)[number];

const VERDICT: Readonly<Record<string, { label: string; tone: 'success' | 'info' | 'neutral' }>> = {
  met: { label: tr('candidate.met', 'Met'), tone: 'success' },
  partly_met: { label: tr('candidate.partly_met', 'Partly met'), tone: 'info' },
  not_met: { label: tr('candidate.not_met', 'Not met'), tone: 'neutral' },
  not_evidenced: { label: tr('candidate.not_evidenced', 'Not evidenced'), tone: 'neutral' },
};

/**
 * PRD §14.3, §22.4, §22.5: the evidence matrix beside the person's own view.
 * Each verdict shows its quotes, the model and the date, and asks whether it
 * was right; the band is a label beside the stage, never instead of it.
 */
function Evidence({
  application,
  props,
}: {
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const matrix = application.matrix ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>
          {tr('candidate.evidence_against_the_criteria', 'Evidence against the criteria')}
        </CardTitle>
        <CardDescription>
          {matrix === null
            ? tr(
                'candidate.a_model_reads_the_masked_application',
                'A model reads the masked application against the job’s criteria and quotes what it found. You decide.',
              )
            : tr(
                'candidate.match_a_label_not_a_decision',
                '{{model}} · {{at}} · {{band}} match. A label, not a decision.',
                { model: matrix.model, at: day(matrix.at), band: words(matrix.band) },
              )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {matrix === null ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('candidate.criterion', 'Criterion')}</TableHead>
                <TableHead>{tr('candidate.verdict', 'Verdict')}</TableHead>
                <TableHead>{tr('candidate.what_it_read', 'What it read')}</TableHead>
                <TableHead>{tr('candidate.was_this_right', 'Was this right?')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.findings.map((f) => (
                <TableRow key={f.criterionId}>
                  <TableCell>
                    {f.criterion}
                    {f.must ? (
                      <span className="block text-xs text-fg-muted">
                        {tr('candidate.must_have', 'Must-have')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" tone={VERDICT[f.verdict]?.tone ?? 'neutral'}>
                      {VERDICT[f.verdict]?.label ?? f.verdict}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.passages.map((q) => (
                      <q key={q} className="block">
                        {q}
                      </q>
                    ))}
                    {f.why === '' ? null : <span className="block text-fg-muted">{f.why}</span>}
                  </TableCell>
                  <TableCell>
                    <SegmentedControl
                      aria-label={tr(
                        'candidate.was_the_verdict_on_right',
                        'Was the verdict on {{criterion}} right?',
                        { criterion: f.criterion },
                      )}
                      value={f.agreed === null ? '' : f.agreed ? 'yes' : 'no'}
                      disabled={act.pending}
                      onValueChange={(v) => {
                        act.run('AgreeWithFinding', {
                          applicationId: application.applicationId,
                          assessmentId: matrix.assessmentId,
                          criterionId: f.criterionId,
                          input: { agreed: v === 'yes' },
                        });
                      }}
                    >
                      <SegmentedControlItem value="yes">
                        {tr('candidate.yes', 'Yes')}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="no">
                        {tr('candidate.no', 'No')}
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Button
          variant="secondary"
          loading={act.pending}
          onClick={() => {
            act.run('AssessMatrix', { applicationId: application.applicationId });
          }}
        >
          {matrix === null
            ? tr('candidate.read_against_the_criteria', 'Read against the criteria')
            : tr('candidate.read_again', 'Read again')}
        </Button>
      </CardContent>
    </Card>
  );
}

interface Said {
  readonly value: string;
  readonly passage: string;
}
interface Parsed {
  readonly profile: {
    readonly work: readonly {
      readonly employer: Said;
      readonly title: Said;
      readonly from: Said;
      readonly to: Said | null;
    }[];
    readonly skills: readonly Said[];
    readonly languages: readonly (Said & { readonly level: string | null })[];
    readonly certifications: readonly Said[];
  };
  readonly issues: readonly { readonly code: string; readonly path: string }[];
  readonly confirmedAt: string | null;
  readonly note: string | null;
}

/** PRD §14.2: what the model read from the masked CV, each line with its passage; a person checks it. */
function ReadCv({
  application,
  props,
}: {
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const { call } = act;
  useEffect(() => {
    void call('RecruitingParsedProfile', { applicationId: application.applicationId }).then(
      (done) => {
        setParsed(done.ok ? (done.data as Parsed | null) : null);
      },
    );
  }, [call, application.applicationId]);
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('candidate.read_from_the_cv', 'Read from the CV')}</CardTitle>
        <CardDescription>
          {tr(
            'candidate.a_model_read_the_masked_text',
            'A model read the masked text; anything it could not quote was left out.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {parsed === null ? (
          <Button
            variant="secondary"
            loading={act.pending}
            onClick={() => {
              act.run('ParseCv', { applicationId: application.applicationId }, (data) => {
                setParsed(data as Parsed);
              });
            }}
          >
            {tr('candidate.read_the_cv', 'Read the CV')}
          </Button>
        ) : (
          <>
            {parsed.confirmedAt === null ? (
              <Badge size="sm" tone="neutral">
                {tr(
                  'candidate.not_yet_checked_by_the_candidate',
                  'Not yet checked by the candidate',
                )}
              </Badge>
            ) : (
              <Badge size="sm" tone="success">
                {tr(
                  'candidate.checked_by_the_candidate',
                  'Checked by the candidate {{confirmedAt}}',
                  { confirmedAt: day(parsed.confirmedAt) },
                )}
              </Badge>
            )}
            {parsed.note === null ? null : (
              <Alert tone="info" title={tr('candidate.the_candidate_says', 'The candidate says')}>
                {parsed.note}
              </Alert>
            )}
            {parsed.issues.some((i) => i.code !== 'not_in_text') ? (
              <Alert tone="warning" title={tr('candidate.dates_to_check', 'Dates to check')}>
                {tr(
                  'candidate.some_dates_are_out_of_order',
                  'Some dates are out of order or after today; they are shown as written.',
                )}
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2">
              {parsed.profile.work.map((w) => (
                <li key={`${w.employer.value}:${w.from.value}`}>
                  <span className="font-medium">
                    {tr('candidate.text', '{{value}}, {{value2}}', {
                      value: w.title.value,
                      value2: w.employer.value,
                    })}
                  </span>
                  <span className="block text-sm text-fg-muted">
                    {w.to === null || w.to === undefined
                      ? tr('candidate.from_to_now', '{{value}} – now · “{{passage}}”', {
                          value: w.from.value,
                          passage: w.employer.passage,
                        })
                      : tr('candidate.text_2', '{{value}} – {{value2}} · “{{passage}}”', {
                          value: w.from.value,
                          value2: w.to.value,
                          passage: w.employer.passage,
                        })}
                  </span>
                </li>
              ))}
            </ul>
            <ChipRow>
              {[...parsed.profile.skills, ...parsed.profile.certifications].map((x) => (
                <Chip key={x.value}>{x.value}</Chip>
              ))}
              {parsed.profile.languages.map((l) => (
                <Chip key={l.value}>
                  {l.level === null
                    ? l.value
                    : tr('candidate.text_3', '{{value}} {{level}}', {
                        value: l.value,
                        level: l.level,
                      })}
                </Chip>
              ))}
            </ChipRow>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** R18: the referees the candidate named; each is asked only when someone here says so. */
function References({
  application,
  props,
}: {
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const can = application.may.includes('candidate.message');
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {application.references.length === 0 ? (
          <EmptyState
            icon={<icons.people aria-hidden />}
            title={tr('candidate.no_referees_named', 'No referees named')}
            description={tr(
              'candidate.the_candidate_names_referees_on_their',
              'The candidate names referees on their page; nobody is contacted before that.',
            )}
          />
        ) : null}
        {application.references.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 border-b border-[var(--reach-line)] pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{r.refereeName}</span>
              <span className="text-sm text-fg-muted">
                {[r.relationship, r.refereeEmail].filter(Boolean).join(' · ')}
              </span>
              <StateBadge state={r.state} />
              {can && r.state === 'named' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={act.pending}
                  onClick={() => {
                    act.run('RequestReference', {
                      applicationId: application.applicationId,
                      referenceId: r.id,
                    });
                  }}
                >
                  {tr('candidate.ask_for_the_reference', 'Ask for the reference')}
                </Button>
              ) : null}
            </div>
            {r.answers === null ? null : (
              <KeyValues
                items={Object.entries(r.answers).map(([k, v]) => ({ label: words(k), value: v }))}
              />
            )}
          </div>
        ))}
        <Refusal error={act.error} />
      </CardContent>
    </Card>
  );
}

function Messages({
  data,
  application,
  props,
}: {
  readonly data: CandidateData;
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState('');
  const can = application.may.includes('candidate.message');
  return (
    <div className="flex flex-col gap-4">
      {data.messages.length === 0 ? (
        <EmptyState
          icon={<icons.message aria-hidden />}
          title={tr('candidate.no_messages_yet', 'No messages yet')}
          description={tr(
            'candidate.emails_to_and_from_the_candidate',
            'Emails to and from the candidate land here; replies arrive on the thread.',
          )}
        />
      ) : null}
      <ol className="flex flex-col gap-3">
        {data.messages.map((m) => (
          <li key={m.id} className={m.direction === 'out' ? 'flex justify-end' : 'flex'}>
            <div
              className={`max-w-[70%] rounded-2xl p-3 ${m.direction === 'out' ? 'bg-[var(--reach-accent-soft)]' : 'bg-[var(--reach-surface)] shadow-sm'}`}
            >
              <div className="text-sm font-semibold">{m.subject}</div>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <div className="text-xs text-fg-muted">
                {m.direction === 'out'
                  ? m.sentAt === null
                    ? tr('candidate.sends', 'Sends {{sendAt}}', { sendAt: when(m.sendAt) })
                    : tr('candidate.sent', 'Sent {{sentAt}}', { sentAt: when(m.sentAt) })
                  : tr('candidate.received', 'Received {{createdAt}}', {
                      createdAt: when(m.createdAt),
                    })}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {can ? (
        <Card padded>
          <div className="flex flex-col gap-3">
            <Refusal error={act.error} />
            <div className="flex flex-wrap items-end gap-2">
              <Field className="min-w-0 flex-1">
                <FieldLabel>{tr('candidate.draft_it_for_me', 'Draft it for me')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={intent}
                    placeholder={tr(
                      'candidate.invite_to_a_second_interview_next',
                      'Invite to a second interview next week',
                    )}
                    onChange={(e) => {
                      setIntent(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <Button
                variant="secondary"
                loading={act.pending}
                disabled={intent.trim() === ''}
                onClick={() => {
                  act.run(
                    'DraftEmail',
                    {
                      applicationId: application.applicationId,
                      input: { intent },
                    },
                    (d) => {
                      const draft = d as { subject: string; body: string };
                      setSubject(draft.subject);
                      setBody(draft.body);
                    },
                  );
                }}
              >
                {tr('candidate.draft', 'Draft')}
              </Button>
            </div>
            <Field required>
              <FieldLabel>{tr('candidate.subject', 'Subject')}</FieldLabel>
              <FieldControl>
                <Input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <Field required>
              <FieldLabel>{tr('candidate.message', 'Message')}</FieldLabel>
              <FieldControl>
                <Textarea
                  rows={5}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <div className="flex justify-end">
              <Button
                startIcon={<icons.send aria-hidden />}
                loading={act.pending}
                disabled={subject.trim() === '' || body.trim() === ''}
                onClick={() => {
                  act.run(
                    'SendMessage',
                    {
                      applicationId: application.applicationId,
                      input: { subject, body, templateId: null },
                    },
                    () => {
                      setSubject('');
                      setBody('');
                    },
                  );
                }}
              >
                {tr('candidate.send', 'Send')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Notes({
  data,
  application,
  props,
}: {
  readonly data: CandidateData;
  readonly application: CandidateData['applications'][number];
  readonly props: ScreenProps<CandidateData>;
}): JSX.Element {
  const act = useAct(props);
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('candidate.notes', 'Notes')}</CardTitle>
        <CardDescription>
          {tr(
            'candidate.private_to_the_hiring_team_interviewers',
            'Private to the hiring team; interviewers see them only after their scorecard',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.notes.map((n) => (
          <div key={n.id} className="flex gap-2">
            <Avatar name={n.authorId} size="sm" />
            <div>
              <div className="text-xs text-fg-muted">{day(n.createdAt)}</div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </div>
          </div>
        ))}
        <Refusal error={act.error} />
        <Field>
          <FieldLabel>{tr('candidate.add_a_note', 'Add a note')}</FieldLabel>
          <FieldControl>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </FieldControl>
        </Field>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={note.trim() === ''}
            loading={act.pending}
            onClick={() => {
              act.run(
                'AddNote',
                {
                  candidateId: data.candidate.id,
                  input: { applicationId: application.applicationId, body: note, mentions: [] },
                },
                () => {
                  setNote('');
                },
              );
            }}
          >
            {tr('candidate.add_note', 'Add note')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function Candidate(props: ScreenProps<CandidateData>): JSX.Element {
  const tab: Tab = TABS.find((t) => t === props.search?.['tab']) ?? 'profile';
  const act = useAct(props);
  const [rejecting, setRejecting] = useState<Rejecting | null>(null);
  const [poolId, setPoolId] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [telling, setTelling] = useState<string | null>(null);
  const [tellMessage, setTellMessage] = useState<ComposedEmail | null>(null);
  const [moving, setMoving] = useState<{ applicationId: string; to: string; name: string } | null>(
    null,
  );
  const [moveEmailing, setMoveEmailing] = useState(true);
  const [moveMessage, setMoveMessage] = useState<ComposedEmail | null>(null);
  const [askLabel, setAskLabel] = useState('');
  const [askDetail, setAskDetail] = useState('');
  return (
    <Loaded load={props.load} what={tr('candidate.the_candidate', 'the candidate')}>
      {(data) => {
        const chosen =
          data.applications.find((a) => a.applicationId === props.search?.['application']) ??
          data.applications[0];
        const stage = chosen?.stages.find((s) => s.id === chosen.stageId);
        const nextStage =
          chosen === undefined
            ? undefined
            : chosen.stages[chosen.stages.findIndex((s) => s.id === chosen.stageId) + 1];
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={data.candidate.name}
              description={[data.candidate.email, data.candidate.location]
                .filter(Boolean)
                .join(' · ')}
              actions={
                <span className="flex flex-wrap items-center gap-2">
                  {/* PRD §13: into a pool by a recruiter's hand; without consent the candidate is asked by email first. */}
                  {data.allPools.length === 0 ? null : (
                    <>
                      <Select
                        value={poolId === '' ? 'none' : poolId}
                        onValueChange={(v) => {
                          setPoolId(v === 'none' ? '' : v);
                        }}
                      >
                        <SelectTrigger
                          aria-label={tr('candidate.talent_pool', 'Talent pool')}
                          size="sm"
                          className="w-48"
                        >
                          <SelectValue
                            placeholder={tr(
                              'candidate.add_to_a_talent_pool',
                              'Add to a talent pool…',
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {tr('candidate.add_to_a_talent_pool', 'Add to a talent pool…')}
                          </SelectItem>
                          {data.allPools
                            .filter((p) => !data.pools.some((m) => m.poolId === p.id))
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={poolId === ''}
                        loading={act.pending}
                        onClick={() => {
                          act.run(
                            'AddToPool',
                            {
                              poolId,
                              input: {
                                candidateId: data.candidate.id,
                                reason: 'Added from the profile',
                              },
                            },
                            () => {
                              setPoolId('');
                            },
                          );
                        }}
                      >
                        {tr('candidate.ask_to_join', 'Ask to join')}
                      </Button>
                    </>
                  )}
                  {data.candidate.email === undefined ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      startIcon={<icons.email aria-hidden />}
                      onClick={() => props.onFilter?.({ tab: 'messages' })}
                    >
                      {tr('candidate.email', 'Email')}
                    </Button>
                  )}
                </span>
              }
            />
            <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <aside
                className="flex flex-col gap-3"
                aria-label={tr('candidate.applications', 'Applications')}
              >
                <h2 className="text-sm font-semibold text-fg-muted">
                  {tr('candidate.applications', 'Applications')}
                </h2>
                {data.applications.map((a) => {
                  const on = a.applicationId === chosen?.applicationId;
                  return (
                    <Card
                      key={a.applicationId}
                      padded
                      variant={on ? 'outline' : 'raised'}
                      interactive
                      className="relative"
                    >
                      <a
                        href={`/recruiting/candidates/${data.candidate.id}?application=${a.applicationId}`}
                        aria-current={on ? 'true' : undefined}
                        className="flex flex-col gap-1 after:absolute after:inset-0"
                        onClick={(e) => {
                          if (props.onFilter === undefined) return;
                          e.preventDefault();
                          props.onFilter({ application: a.applicationId });
                        }}
                      >
                        <span className="font-semibold">{a.job.title}</span>
                        <span className="text-sm text-fg-muted">
                          {a.outcome === 'active'
                            ? (a.stages.find((s) => s.id === a.stageId)?.name ?? '')
                            : words(a.outcome)}
                        </span>
                        <span className="text-xs text-fg-muted">
                          {tr('candidate.source', 'Source: {{source}}', {
                            source: words(a.source),
                          })}
                        </span>
                      </a>
                    </Card>
                  );
                })}
                {(data.candidate.tags ?? []).length === 0 ? null : (
                  <div className="flex flex-wrap gap-1">
                    {(data.candidate.tags ?? []).map((t) => (
                      <Badge key={t} size="sm">
                        {words(t)}
                      </Badge>
                    ))}
                  </div>
                )}
              </aside>
              {chosen === undefined ? (
                <EmptyState
                  icon={<icons.person aria-hidden />}
                  title={tr('candidate.no_application_you_can_see', 'No application you can see')}
                />
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  <Card padded>
                    <div className="flex flex-wrap items-center gap-2">
                      {chosen.outcome === 'active' ? (
                        <Badge tone="accent">{stage?.name ?? ''}</Badge>
                      ) : (
                        <StateBadge state={chosen.outcome} />
                      )}
                      {chosen.flagged ? (
                        <Badge size="sm" tone="warning">
                          {tr('candidate.knockout_to_review', 'Knockout to review')}
                        </Badge>
                      ) : null}
                      <span className="flex-1" />
                      <Refusal error={act.error} />
                      {chosen.outcome === 'active' && chosen.may.includes('interview.schedule') ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          startIcon={<icons.meeting aria-hidden />}
                          onClick={() =>
                            props.onNavigate?.(
                              `/recruiting/applications/${chosen.applicationId}/schedule`,
                            )
                          }
                        >
                          {tr('candidate.schedule', 'Schedule')}
                        </Button>
                      ) : null}
                      {chosen.outcome === 'active' && chosen.may.includes('candidate.message') ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          startIcon={<icons.help aria-hidden />}
                          onClick={() => {
                            setAsking(chosen.applicationId);
                          }}
                        >
                          {tr('candidate.ask_for_information', 'Ask for information…')}
                        </Button>
                      ) : null}
                      {chosen.outcome === 'active' && chosen.may.includes('candidate.message') ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          startIcon={<icons.email aria-hidden />}
                          onClick={() => {
                            setTellMessage(null);
                            setTelling(chosen.applicationId);
                          }}
                        >
                          {tr('candidate.what_to_expect', 'What to expect…')}
                        </Button>
                      ) : null}
                      {chosen.may.includes('scorecards.all') ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            props.onNavigate?.(
                              `/recruiting/applications/${chosen.applicationId}/debrief`,
                            )
                          }
                        >
                          {tr('candidate.debrief', 'Debrief')}
                        </Button>
                      ) : null}
                      {chosen.outcome === 'active' &&
                      chosen.may.includes('pipeline.move') &&
                      nextStage !== undefined &&
                      nextStage.category !== 'hired' &&
                      nextStage.category !== 'interview' ? (
                        <Button
                          size="sm"
                          startIcon={<icons.next aria-hidden />}
                          onClick={() => {
                            setMoveMessage(null);
                            setMoving({
                              applicationId: chosen.applicationId,
                              to: nextStage.id,
                              name: nextStage.name,
                            });
                          }}
                        >
                          {tr('candidate.move_to', 'Move to {{name}}', { name: nextStage.name })}
                        </Button>
                      ) : null}
                      {chosen.outcome === 'active' && chosen.may.includes('pipeline.move') ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setRejecting({
                              ids: [chosen.applicationId],
                              names: [data.candidate.name],
                            });
                          }}
                        >
                          {tr('candidate.reject', 'Reject…')}
                        </Button>
                      ) : null}
                      {chosen.outcome === 'active' &&
                      chosen.may.includes('offer.edit') &&
                      (stage?.category === 'offer' || chosen.offers.length > 0) ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            props.onNavigate?.(
                              chosen.offers[0] === undefined
                                ? `/recruiting/offers/new?application=${chosen.applicationId}`
                                : `/recruiting/offers/${chosen.offers[0].id}`,
                            )
                          }
                        >
                          {chosen.offers[0] === undefined
                            ? tr('candidate.make_an_offer', 'Make an offer')
                            : tr('candidate.open_the_offer', 'Open the offer')}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                  <Tabs
                    value={tab}
                    onValueChange={(v) => props.onFilter?.({ tab: v === 'profile' ? null : v })}
                  >
                    <TabsList>
                      <TabsTrigger value="profile">
                        {tr('candidate.profile', 'Profile')}
                      </TabsTrigger>
                      <TabsTrigger value="process">
                        {tr('candidate.process', 'Process{{value}}', {
                          value:
                            chosen.interviews.length > 0
                              ? ` (${String(chosen.interviews.length)})`
                              : '',
                        })}
                      </TabsTrigger>
                      <TabsTrigger value="messages">
                        {tr('candidate.messages', 'Messages{{value}}', {
                          value:
                            data.messages.length > 0 ? ` (${String(data.messages.length)})` : '',
                        })}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="profile">
                      <div className="flex flex-col gap-6">
                        <div className="grid gap-4 xl:grid-cols-2">
                          <Card>
                            <CardHeader>
                              <CardTitle level={2}>{tr('candidate.profile', 'Profile')}</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <KeyValues
                                layout="aligned"
                                items={[
                                  {
                                    label: tr('candidate.email', 'Email'),
                                    value: data.candidate.email ?? '—',
                                  },
                                  {
                                    label: tr('candidate.phone', 'Phone'),
                                    value: data.candidate.phone ?? '—',
                                  },
                                  {
                                    label: tr('candidate.location', 'Location'),
                                    value: data.candidate.location ?? '—',
                                  },
                                  {
                                    label: tr('candidate.links', 'Links'),
                                    value: (data.candidate.links ?? []).join(' · ') || '—',
                                  },
                                  {
                                    label: tr('candidate.files', 'Files'),
                                    value:
                                      data.files
                                        .map((f) => `${f.fileName} (${words(f.kind)})`)
                                        .join(', ') || '—',
                                  },
                                  {
                                    label: tr('candidate.consent', 'Consent'),
                                    value:
                                      data.consents
                                        .filter((c) => c.withdrawnAt === null)
                                        .map(
                                          (c) =>
                                            `${words(c.purpose)}${c.expiresOn === null ? '' : ` until ${day(c.expiresOn)}`}`,
                                        )
                                        .join(' · ') || '—',
                                  },
                                  {
                                    label: tr('candidate.adjustments', 'Adjustments'),
                                    value: chosen.adjustments ?? 'None asked',
                                  },
                                ]}
                              />
                            </CardContent>
                          </Card>
                          <Notes data={data} application={chosen} props={props} />
                          {chosen.may.includes('candidate.profile') ? (
                            <ReadCv application={chosen} props={props} />
                          ) : null}
                        </div>
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">
                            {tr('candidate.answers', 'Answers')}
                          </h3>
                          <Card>
                            <CardContent>
                              {Object.keys(chosen.answers).length === 0 ? (
                                <EmptyState
                                  icon={<icons.list aria-hidden />}
                                  title={tr(
                                    'candidate.no_answers_you_can_see',
                                    'No answers you can see',
                                  )}
                                />
                              ) : (
                                <KeyValues
                                  layout="aligned"
                                  items={Object.entries(chosen.answers).map(([k, v]) => ({
                                    label: words(k.replace(/^q_/u, '')),
                                    value:
                                      typeof v === 'object' && v !== null && 'name' in v
                                        ? (v as { name: string }).name
                                        : String(v),
                                  }))}
                                />
                              )}
                            </CardContent>
                          </Card>
                        </section>
                        {chosen.may.includes('candidate.profile') ? (
                          <section className="flex flex-col gap-3">
                            <h3 className="text-sm font-semibold text-fg-muted">
                              {tr(
                                'candidate.evidence_against_the_criteria',
                                'Evidence against the criteria',
                              )}
                            </h3>
                            <Evidence application={chosen} props={props} />
                          </section>
                        ) : null}
                      </div>
                    </TabsContent>
                    <TabsContent value="process">
                      <div className="flex flex-col gap-6">
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">
                            {tr('candidate.interviews', 'Interviews')}
                          </h3>
                          <Card>
                            <CardContent className="flex flex-col gap-3">
                              {chosen.interviews.length === 0 ? (
                                <EmptyState
                                  icon={<icons.meeting aria-hidden />}
                                  title={tr('candidate.no_interviews_yet', 'No interviews yet')}
                                />
                              ) : null}
                              {chosen.asks.length === 0 ? null : (
                                <div className="flex flex-col gap-2">
                                  <h3 className="text-sm font-semibold text-fg-muted">
                                    {tr('candidate.with_the_candidate', 'With the candidate')}
                                  </h3>
                                  <AskList
                                    asks={chosen.asks}
                                    applicationId={chosen.applicationId}
                                    act={act}
                                  />
                                </div>
                              )}
                              {chosen.interviews.map((i) => {
                                const cards = chosen.scorecards.filter(
                                  (c) => c.interviewId === i.id && c.submittedAt !== null,
                                );
                                return (
                                  <div
                                    key={i.id}
                                    className="flex flex-wrap items-center gap-3 border-b border-[var(--reach-line)] pb-3"
                                  >
                                    <To
                                      href={`/recruiting/interviews/${i.id}`}
                                      onNavigate={props.onNavigate}
                                    >
                                      {i.title}
                                    </To>
                                    <span className="text-sm text-fg-muted">
                                      {when(i.startsAt)}
                                    </span>
                                    <StateBadge state={i.state} />
                                    <span className="text-sm text-fg-muted">
                                      {tr(
                                        'candidate.of_scorecards',
                                        '{{length}} of {{length2}} scorecards',
                                        {
                                          length: String(cards.length),
                                          length2: String(i.interviewerIds.length),
                                        },
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </CardContent>
                          </Card>
                        </section>
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">
                            {tr('candidate.references', 'References')}
                          </h3>
                          <References application={chosen} props={props} />
                        </section>
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">
                            {tr('candidate.offers', 'Offers')}
                          </h3>
                          <Card>
                            <CardContent className="flex flex-col gap-3">
                              {chosen.offers.length === 0 ? (
                                <EmptyState
                                  icon={<icons.agreement aria-hidden />}
                                  title={tr('candidate.no_offer_yet', 'No offer yet')}
                                />
                              ) : null}
                              {chosen.offers.map((o) => (
                                <div key={o.id} className="flex flex-wrap items-center gap-3">
                                  <To
                                    href={`/recruiting/offers/${o.id}`}
                                    onNavigate={props.onNavigate}
                                  >
                                    {tr('candidate.offer_v', 'Offer v{{version}}', {
                                      version: String(o.version),
                                    })}
                                  </To>
                                  <StateBadge state={o.state} />
                                  <span className="text-sm text-fg-muted">
                                    {tr(
                                      'candidate.starts',
                                      '{{baseMinor}} · starts {{startDate}}',
                                      {
                                        baseMinor: money(o.baseMinor, o.currency),
                                        startDate: day(o.startDate),
                                      },
                                    )}
                                  </span>
                                </div>
                              ))}
                              {chosen.prehire === null ? null : (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold">
                                      {tr('candidate.pre_hire', 'Pre-hire')}
                                    </span>
                                    <StateBadge state={chosen.prehire.state} />
                                  </div>
                                  {chosen.prehire.conditions.map((c) => (
                                    <div key={c.kind} className="flex items-center gap-2 text-sm">
                                      {words(c.kind)} <StateBadge state={c.state} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </section>
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">
                            {tr('candidate.activity', 'Activity')}
                          </h3>
                          <Card>
                            <CardContent>
                              <Timeline>
                                {chosen.history.map((m) => (
                                  <TimelineItem
                                    key={m.id}
                                    title={
                                      chosen.stages.find((s) => s.id === m.to)?.name ??
                                      tr('candidate.moved', 'Moved')
                                    }
                                    timestamp={when(m.at)}
                                  >
                                    {m.supersedes === null
                                      ? null
                                      : m.reason === 'undone'
                                        ? tr('candidate.undone', 'Undone')
                                        : tr('candidate.corrected', 'Corrected: {{value}}', {
                                            value: m.reason ?? '',
                                          })}
                                  </TimelineItem>
                                ))}
                              </Timeline>
                              {chosen.rejection === null ? null : (
                                <p className="mt-3 text-sm">
                                  {tr('candidate.rejected', 'Rejected {{at}}: {{reasonKey}}', {
                                    at: day(chosen.rejection.at),
                                    reasonKey: words(chosen.rejection.reasonKey),
                                  })}
                                </p>
                              )}
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>
                    <TabsContent value="messages">
                      <Messages data={data} application={chosen} props={props} />
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
            <Dialog
              open={asking !== null}
              onOpenChange={(open) => {
                if (!open) setAsking(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {tr(
                      'candidate.ask_the_candidate_for_something',
                      'Ask the candidate for something',
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    {tr(
                      'candidate.it_lands_on_their_page',
                      'It lands on {{name}}’s page and in their inbox the moment you send it; the answer comes back here.',
                      { name: data.candidate.name },
                    )}
                  </DialogDescription>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3">
                  <Field required>
                    <FieldLabel>{tr('candidate.what_you_need', 'What you need')}</FieldLabel>
                    <FieldControl>
                      <Input
                        value={askLabel}
                        onChange={(e) => {
                          setAskLabel(e.target.value);
                        }}
                        placeholder={tr(
                          'candidate.your_notice_period_a_portfolio_link',
                          'Your notice period, a portfolio link, two references…',
                        )}
                      />
                    </FieldControl>
                  </Field>
                  <Field>
                    <FieldLabel>
                      {tr('candidate.more_detail_optional', 'More detail (optional)')}
                    </FieldLabel>
                    <FieldControl>
                      <Textarea
                        autoResize
                        value={askDetail}
                        onChange={(e) => {
                          setAskDetail(e.target.value);
                        }}
                      />
                    </FieldControl>
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setAsking(null);
                    }}
                  >
                    {tr('candidate.cancel', 'Cancel')}
                  </Button>
                  <Button
                    disabled={askLabel.trim() === ''}
                    loading={act.pending}
                    onClick={() => {
                      act.run(
                        'RequestInformation',
                        {
                          applicationId: asking,
                          input: {
                            label: askLabel.trim(),
                            detail: askDetail.trim() === '' ? null : askDetail.trim(),
                          },
                        },
                        () => {
                          setAsking(null);
                          setAskLabel('');
                          setAskDetail('');
                        },
                      );
                    }}
                  >
                    {tr('candidate.send', 'Send')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog
              open={moving !== null}
              onOpenChange={(open) => {
                if (!open) setMoving(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {tr('candidate.move_to_2', 'Move to {{value}}', { value: moving?.name ?? '' })}
                  </DialogTitle>
                  <DialogDescription>
                    {tr(
                      'candidate.moves_on_tell_them_in_the',
                      '{{name}} moves on. Tell them, in the company’s words or your own.',
                      { name: data.candidate.name },
                    )}
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <EmailComposer
                    applicationId={moving?.applicationId}
                    purpose="selection"
                    templates={data.templates}
                    act={act}
                    enabled={moveEmailing}
                    onEnabledChange={setMoveEmailing}
                    value={moveMessage}
                    onChange={setMoveMessage}
                  />
                </DialogBody>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMoving(null);
                    }}
                  >
                    {tr('candidate.cancel', 'Cancel')}
                  </Button>
                  <Button
                    loading={act.pending}
                    disabled={
                      moveEmailing &&
                      (moveMessage === null ||
                        moveMessage.subject.trim() === '' ||
                        moveMessage.body.trim() === '')
                    }
                    onClick={() => {
                      if (moving === null) return;
                      act.run(
                        'MoveApplication',
                        {
                          applicationId: moving.applicationId,
                          input: {
                            to: moving.to,
                            message: moveEmailing ? moveMessage : null,
                          },
                        },
                        () => {
                          setMoving(null);
                        },
                      );
                    }}
                  >
                    {moveEmailing
                      ? tr('candidate.move_and_send', 'Move and send')
                      : tr('candidate.move_without_an_email', 'Move without an email')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog
              open={telling !== null}
              onOpenChange={(open) => {
                if (!open) setTelling(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {tr('candidate.tell_them_what_to_expect', 'Tell them what to expect')}
                  </DialogTitle>
                  <DialogDescription>
                    {tr(
                      'candidate.what_happens_at_s_current_stage',
                      'What happens at {{name}}’s current stage, from the job’s own plan. Change anything before it goes.',
                      { name: data.candidate.name },
                    )}
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <EmailComposer
                    applicationId={telling ?? undefined}
                    purpose="stage_expectations"
                    templates={data.templates}
                    act={act}
                    enabled
                    optional={false}
                    onEnabledChange={() => undefined}
                    value={tellMessage}
                    onChange={setTellMessage}
                  />
                </DialogBody>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setTelling(null);
                    }}
                  >
                    {tr('candidate.cancel', 'Cancel')}
                  </Button>
                  <Button
                    loading={act.pending}
                    disabled={
                      tellMessage === null ||
                      tellMessage.subject.trim() === '' ||
                      tellMessage.body.trim() === ''
                    }
                    onClick={() => {
                      if (telling === null || tellMessage === null) return;
                      act.run(
                        'SendStageExpectations',
                        { applicationId: telling, input: tellMessage },
                        () => {
                          setTelling(null);
                        },
                      );
                    }}
                  >
                    {tr('candidate.send', 'Send')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <RejectDialog
              options={{
                jobTitle: chosen?.job.title ?? '',
                rejectionReasons: data.rejectionReasons,
                templates: data.templates,
                pools: data.allPools,
              }}
              rejecting={rejecting}
              onClose={() => {
                setRejecting(null);
              }}
              props={props}
            />
          </div>
        );
      }}
    </Loaded>
  );
}

/** R26, every candidate: searchable by CV text without any AI key. */
export function Candidates(props: ScreenProps<CandidatesData>): JSX.Element {
  const [adding, setAdding] = useState(false);
  return (
    <Loaded load={props.load} what="candidates">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('candidate.candidates', 'Candidates')}
            description={tr(
              'candidate.everyone_who_applied_was_referred_submitted',
              'Everyone who applied, was referred, submitted or sourced. Search reads CV text.',
            )}
            actions={
              <Button
                startIcon={<icons.hire aria-hidden />}
                onClick={() => {
                  setAdding(!adding);
                }}
              >
                {tr('candidate.add_sourced_profile', 'Add sourced profile')}
              </Button>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              initial={data.q}
              onSearch={(q) => props.onFilter?.({ q: q === '' ? null : q })}
            />
            <span className="flex-1" />
            <span className="text-sm text-fg-muted">
              {tr('candidate.shown', '{{length}} shown', { length: String(data.rows.length) })}
            </span>
          </div>
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.people aria-hidden />}
                  title={tr('candidate.nobody_matches', 'Nobody matches')}
                />
              ) : (
                <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.rows.map((r) => (
                    <li key={r.candidateId} className="flex flex-wrap items-center gap-3 py-3">
                      <Avatar name={r.name} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <To
                          href={`/recruiting/candidates/${r.candidateId}`}
                          onNavigate={props.onNavigate}
                        >
                          {r.name}
                        </To>
                        <span className="text-sm text-fg-muted">{r.email}</span>
                      </span>
                      <span className="text-sm">{r.latest?.job ?? '—'}</span>
                      {r.latest === null ? null : <StateBadge state={r.latest.outcome} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

function SearchBox({
  initial,
  onSearch,
}: {
  readonly initial: string;
  readonly onSearch: (q: string) => void;
}): JSX.Element {
  const [q, setQ] = useState(initial);
  return (
    <form
      className="flex gap-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q.trim());
      }}
    >
      <Input
        aria-label={tr('candidate.search_candidates', 'Search candidates')}
        placeholder={tr('candidate.name_email_or_words_in_a', 'Name, email or words in a CV')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        className="w-80"
      />
      <Button type="submit" variant="secondary">
        {tr('candidate.search', 'Search')}
      </Button>
    </form>
  );
}

/** R13, talent pools: who is in each, why, and until when their consent runs. */
export function Pools(props: ScreenProps<PoolsData>): JSX.Element {
  const act = useAct(props);
  const [name, setName] = useState('');
  const [forward, setForward] = useState<{ candidateId: string; name: string } | null>(null);
  const [jobId, setJobId] = useState('');
  return (
    <Loaded load={props.load} what={tr('candidate.talent_pools', 'talent pools')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('candidate.talent_pools_2', 'Talent pools')}
            description={tr(
              'candidate.nobody_stays_without_a_lawful_basis',
              'Nobody stays without a lawful basis: consent asked by email, renewed thirty days before it ends.',
            )}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Card>
              <CardHeader>
                <CardTitle level={2}>{tr('candidate.pools', 'Pools')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                  {data.pools.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-2">
                      <To
                        href={`/recruiting/pools/${p.id}`}
                        onNavigate={props.onNavigate}
                        aria-current={data.pool?.id === p.id ? 'page' : undefined}
                      >
                        {p.name}
                      </To>
                      <span className="flex-1" />
                      <Badge size="sm">{p.count}</Badge>
                    </li>
                  ))}
                </ul>
                <Refusal error={act.error} />
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act.run(
                      'SavePool',
                      { poolId: crypto.randomUUID(), input: { name, description: null } },
                      () => {
                        setName('');
                      },
                    );
                  }}
                >
                  <Input
                    aria-label={tr('candidate.new_pools_name', 'New pool’s name')}
                    placeholder={tr(
                      'candidate.backend_berlin_silver_medallists',
                      'Backend, Berlin · silver medallists',
                    )}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={name.trim() === ''}
                    loading={act.pending}
                  >
                    {tr('candidate.new_pool', 'New pool')}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle level={2}>
                  {data.pool?.name ?? tr('candidate.choose_a_pool', 'Choose a pool')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.pool === null ? (
                  <EmptyState
                    icon={<icons.people aria-hidden />}
                    title={tr(
                      'candidate.pick_a_pool_to_see_who',
                      'Pick a pool to see who is in it',
                    )}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
                    {data.pool.members.map((m) => (
                      <li key={m.candidateId} className="flex flex-wrap items-center gap-3 py-2">
                        <To
                          href={`/recruiting/candidates/${m.candidateId}`}
                          onNavigate={props.onNavigate}
                        >
                          {m.name}
                        </To>
                        <span className="text-sm text-fg-muted">{m.reason}</span>
                        <span className="flex-1" />
                        <Badge size="sm" tone={m.consentUntil === null ? 'warning' : 'neutral'}>
                          {m.consentUntil === null
                            ? tr('candidate.no_consent', 'No consent')
                            : tr('candidate.until', 'Until {{consentUntil}}', {
                                consentUntil: day(m.consentUntil),
                              })}
                        </Badge>
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={data.jobs.length === 0 || m.consentUntil === null}
                          onClick={() => {
                            setJobId(data.jobs[0]?.id ?? '');
                            setForward({ candidateId: m.candidateId, name: m.name });
                          }}
                        >
                          {tr('candidate.put_forward', 'Put forward…')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          {/* PRD §13.3: into an open job's first stage, told by email with the ad's address. */}
          <Dialog
            open={forward !== null}
            onOpenChange={(open) => {
              if (!open) setForward(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {tr('candidate.put_forward_2', 'Put {{value}} forward', {
                    value: forward?.name ?? '',
                  })}
                </DialogTitle>
                <DialogDescription>
                  {tr(
                    'candidate.they_enter_the_jobs_first_stage',
                    'They enter the job’s first stage and get an email with the ad and their own page.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <Refusal error={act.error} />
                <Field required>
                  <FieldLabel>{tr('candidate.job', 'Job')}</FieldLabel>
                  <Select value={jobId} onValueChange={setJobId}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={tr('candidate.choose_an_open_job', 'Choose an open job')}
                        />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {data.jobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setForward(null);
                  }}
                >
                  {tr('candidate.cancel', 'Cancel')}
                </Button>
                <Button
                  disabled={jobId === ''}
                  loading={act.pending}
                  onClick={() => {
                    if (forward === null) return;
                    act.run('PutForward', { jobId, candidateId: forward.candidateId }, () => {
                      setForward(null);
                    });
                  }}
                >
                  {tr('candidate.put_forward_3', 'Put forward')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Loaded>
  );
}
