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
import { AskList } from './interviews';
import { RejectDialog, type Rejecting } from './reject-dialog';
import type { CandidateData, CandidatesData, PoolsData, ScreenProps } from './types';

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
  met: { label: 'Met', tone: 'success' },
  partly_met: { label: 'Partly met', tone: 'info' },
  not_met: { label: 'Not met', tone: 'neutral' },
  not_evidenced: { label: 'Not evidenced', tone: 'neutral' },
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
        <CardTitle level={2}>Evidence against the criteria</CardTitle>
        <CardDescription>
          {matrix === null
            ? 'A model reads the masked application against the job’s criteria and quotes what it found. You decide.'
            : `${matrix.model} · ${day(matrix.at)} · ${words(matrix.band)} match. A label, not a decision.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {matrix === null ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Criterion</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>What it read</TableHead>
                <TableHead>Was this right?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.findings.map((f) => (
                <TableRow key={f.criterionId}>
                  <TableCell>
                    {f.criterion}
                    {f.must ? <span className="block text-xs text-fg-muted">Must-have</span> : null}
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
                      aria-label={`Was the verdict on ${f.criterion} right?`}
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
                      <SegmentedControlItem value="yes">Yes</SegmentedControlItem>
                      <SegmentedControlItem value="no">No</SegmentedControlItem>
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
          {matrix === null ? 'Read against the criteria' : 'Read again'}
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
        <CardTitle level={2}>Read from the CV</CardTitle>
        <CardDescription>
          A model read the masked text; anything it could not quote was left out.
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
            Read the CV
          </Button>
        ) : (
          <>
            {parsed.confirmedAt === null ? (
              <Badge size="sm" tone="neutral">
                Not yet checked by the candidate
              </Badge>
            ) : (
              <Badge
                size="sm"
                tone="success"
              >{`Checked by the candidate ${day(parsed.confirmedAt)}`}</Badge>
            )}
            {parsed.note === null ? null : (
              <Alert tone="info" title="The candidate says">
                {parsed.note}
              </Alert>
            )}
            {parsed.issues.some((i) => i.code !== 'not_in_text') ? (
              <Alert tone="warning" title="Dates to check">
                Some dates are out of order or after today; they are shown as written.
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2">
              {parsed.profile.work.map((w) => (
                <li key={`${w.employer.value}:${w.from.value}`}>
                  <span className="font-medium">{`${w.title.value}, ${w.employer.value}`}</span>
                  <span className="block text-sm text-fg-muted">{`${w.from.value} – ${w.to?.value ?? 'now'} · “${w.employer.passage}”`}</span>
                </li>
              ))}
            </ul>
            <ChipRow>
              {[...parsed.profile.skills, ...parsed.profile.certifications].map((x) => (
                <Chip key={x.value}>{x.value}</Chip>
              ))}
              {parsed.profile.languages.map((l) => (
                <Chip key={l.value}>{l.level === null ? l.value : `${l.value} ${l.level}`}</Chip>
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
            title="No referees named"
            description="The candidate names referees on their page; nobody is contacted before that."
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
                  Ask for the reference
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
          title="No messages yet"
          description="Emails to and from the candidate land here; replies arrive on the thread."
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
                    ? `Sends ${when(m.sendAt)}`
                    : `Sent ${when(m.sentAt)}`
                  : `Received ${when(m.createdAt)}`}
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
                <FieldLabel>Draft it for me</FieldLabel>
                <FieldControl>
                  <Input
                    value={intent}
                    placeholder="Invite to a second interview next week"
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
                Draft
              </Button>
            </div>
            <Field required>
              <FieldLabel>Subject</FieldLabel>
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
              <FieldLabel>Message</FieldLabel>
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
                Send
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
        <CardTitle level={2}>Notes</CardTitle>
        <CardDescription>
          Private to the hiring team; interviewers see them only after their scorecard
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
          <FieldLabel>Add a note</FieldLabel>
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
            Add note
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
  const [askLabel, setAskLabel] = useState('');
  const [askDetail, setAskDetail] = useState('');
  return (
    <Loaded load={props.load} what="the candidate">
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
                        <SelectTrigger aria-label="Talent pool" size="sm" className="w-48">
                          <SelectValue placeholder="Add to a talent pool…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Add to a talent pool…</SelectItem>
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
                        Ask to join
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
                      Email
                    </Button>
                  )}
                </span>
              }
            />
            <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <aside className="flex flex-col gap-3" aria-label="Applications">
                <h2 className="text-sm font-semibold text-fg-muted">Applications</h2>
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
                        <span className="text-xs text-fg-muted">{`Source: ${words(a.source)}`}</span>
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
                  title="No application you can see"
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
                          Knockout to review
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
                          Schedule
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
                          Ask for information…
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
                          Debrief
                        </Button>
                      ) : null}
                      {chosen.outcome === 'active' &&
                      chosen.may.includes('pipeline.move') &&
                      nextStage !== undefined &&
                      nextStage.category !== 'hired' &&
                      nextStage.category !== 'interview' ? (
                        <Button
                          size="sm"
                          loading={act.pending}
                          onClick={() => {
                            act.run('MoveApplication', {
                              applicationId: chosen.applicationId,
                              input: { to: nextStage.id },
                            });
                          }}
                        >
                          {`Move to ${nextStage.name}`}
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
                          Reject…
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
                          {chosen.offers[0] === undefined ? 'Make an offer' : 'Open the offer'}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                  <Tabs
                    value={tab}
                    onValueChange={(v) => props.onFilter?.({ tab: v === 'profile' ? null : v })}
                  >
                    <TabsList>
                      <TabsTrigger value="profile">Profile</TabsTrigger>
                      <TabsTrigger value="process">{`Process${chosen.interviews.length > 0 ? ` (${String(chosen.interviews.length)})` : ''}`}</TabsTrigger>
                      <TabsTrigger value="messages">{`Messages${data.messages.length > 0 ? ` (${String(data.messages.length)})` : ''}`}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="profile">
                      <div className="flex flex-col gap-6">
                        <div className="grid gap-4 xl:grid-cols-2">
                          <Card>
                            <CardHeader>
                              <CardTitle level={2}>Profile</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <KeyValues
                                layout="aligned"
                                items={[
                                  { label: 'Email', value: data.candidate.email ?? '—' },
                                  { label: 'Phone', value: data.candidate.phone ?? '—' },
                                  { label: 'Location', value: data.candidate.location ?? '—' },
                                  {
                                    label: 'Links',
                                    value: (data.candidate.links ?? []).join(' · ') || '—',
                                  },
                                  {
                                    label: 'Files',
                                    value:
                                      data.files
                                        .map((f) => `${f.fileName} (${words(f.kind)})`)
                                        .join(', ') || '—',
                                  },
                                  {
                                    label: 'Consent',
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
                                    label: 'Adjustments',
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
                          <h3 className="text-sm font-semibold text-fg-muted">Answers</h3>
                          <Card>
                            <CardContent>
                              {Object.keys(chosen.answers).length === 0 ? (
                                <EmptyState
                                  icon={<icons.list aria-hidden />}
                                  title="No answers you can see"
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
                              Evidence against the criteria
                            </h3>
                            <Evidence application={chosen} props={props} />
                          </section>
                        ) : null}
                      </div>
                    </TabsContent>
                    <TabsContent value="process">
                      <div className="flex flex-col gap-6">
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">Interviews</h3>
                          <Card>
                            <CardContent className="flex flex-col gap-3">
                              {chosen.interviews.length === 0 ? (
                                <EmptyState
                                  icon={<icons.meeting aria-hidden />}
                                  title="No interviews yet"
                                />
                              ) : null}
                              {chosen.asks.length === 0 ? null : (
                                <div className="flex flex-col gap-2">
                                  <h3 className="text-sm font-semibold text-fg-muted">
                                    With the candidate
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
                                    <span className="text-sm text-fg-muted">{`${String(cards.length)} of ${String(i.interviewerIds.length)} scorecards`}</span>
                                  </div>
                                );
                              })}
                            </CardContent>
                          </Card>
                        </section>
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">References</h3>
                          <References application={chosen} props={props} />
                        </section>
                        <section className="flex flex-col gap-3">
                          <h3 className="text-sm font-semibold text-fg-muted">Offers</h3>
                          <Card>
                            <CardContent className="flex flex-col gap-3">
                              {chosen.offers.length === 0 ? (
                                <EmptyState
                                  icon={<icons.agreement aria-hidden />}
                                  title="No offer yet"
                                />
                              ) : null}
                              {chosen.offers.map((o) => (
                                <div key={o.id} className="flex flex-wrap items-center gap-3">
                                  <To
                                    href={`/recruiting/offers/${o.id}`}
                                    onNavigate={props.onNavigate}
                                  >{`Offer v${String(o.version)}`}</To>
                                  <StateBadge state={o.state} />
                                  <span className="text-sm text-fg-muted">{`${money(o.baseMinor, o.currency)} · starts ${day(o.startDate)}`}</span>
                                </div>
                              ))}
                              {chosen.prehire === null ? null : (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold">Pre-hire</span>
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
                          <h3 className="text-sm font-semibold text-fg-muted">Activity</h3>
                          <Card>
                            <CardContent>
                              <Timeline>
                                {chosen.history.map((m) => (
                                  <TimelineItem
                                    key={m.id}
                                    title={
                                      chosen.stages.find((s) => s.id === m.to)?.name ?? 'Moved'
                                    }
                                    timestamp={when(m.at)}
                                  >
                                    {m.supersedes === null
                                      ? null
                                      : m.reason === 'undone'
                                        ? 'Undone'
                                        : `Corrected: ${m.reason ?? ''}`}
                                  </TimelineItem>
                                ))}
                              </Timeline>
                              {chosen.rejection === null ? null : (
                                <p className="mt-3 text-sm">{`Rejected ${day(chosen.rejection.at)}: ${words(chosen.rejection.reasonKey)}`}</p>
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
                  <DialogTitle>Ask the candidate for something</DialogTitle>
                  <DialogDescription>
                    {`It lands on ${data.candidate.name}’s page and in their inbox the moment you send it; the answer comes back here.`}
                  </DialogDescription>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3">
                  <Field required>
                    <FieldLabel>What you need</FieldLabel>
                    <FieldControl>
                      <Input
                        value={askLabel}
                        onChange={(e) => {
                          setAskLabel(e.target.value);
                        }}
                        placeholder="Your notice period, a portfolio link, two references…"
                      />
                    </FieldControl>
                  </Field>
                  <Field>
                    <FieldLabel>More detail (optional)</FieldLabel>
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
                    Cancel
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
                    Send
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
            title="Candidates"
            description="Everyone who applied, was referred, submitted or sourced. Search reads CV text."
            actions={
              <Button
                startIcon={<icons.hire aria-hidden />}
                onClick={() => {
                  setAdding(!adding);
                }}
              >
                Add sourced profile
              </Button>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              initial={data.q}
              onSearch={(q) => props.onFilter?.({ q: q === '' ? null : q })}
            />
            <span className="flex-1" />
            <span className="text-sm text-fg-muted">{`${String(data.rows.length)} shown`}</span>
          </div>
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState icon={<icons.people aria-hidden />} title="Nobody matches" />
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
        aria-label="Search candidates"
        placeholder="Name, email or words in a CV"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        className="w-80"
      />
      <Button type="submit" variant="secondary">
        Search
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
    <Loaded load={props.load} what="talent pools">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Talent pools"
            description="Nobody stays without a lawful basis: consent asked by email, renewed thirty days before it ends."
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Card>
              <CardHeader>
                <CardTitle level={2}>Pools</CardTitle>
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
                    aria-label="New pool’s name"
                    placeholder="Backend, Berlin · silver medallists"
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
                    New pool
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle level={2}>{data.pool?.name ?? 'Choose a pool'}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.pool === null ? (
                  <EmptyState
                    icon={<icons.people aria-hidden />}
                    title="Pick a pool to see who is in it"
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
                          {m.consentUntil === null ? 'No consent' : `Until ${day(m.consentUntil)}`}
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
                          Put forward…
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
                <DialogTitle>{`Put ${forward?.name ?? ''} forward`}</DialogTitle>
                <DialogDescription>
                  They enter the job’s first stage and get an email with the ad and their own page.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <Refusal error={act.error} />
                <Field required>
                  <FieldLabel>Job</FieldLabel>
                  <Select value={jobId} onValueChange={setJobId}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an open job" />
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
                  Cancel
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
                  Put forward
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Loaded>
  );
}
