import {
  Alert,
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
  RadioCard,
  RadioGroup,
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
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, day, useAct, when, words } from './shared';
import type {
  DebriefData,
  InterviewsData,
  KitData,
  Recommendation,
  ScheduleData,
  ScreenProps,
} from './types';

/**
 * R14–R17: my interviews, the kit and scorecard, scheduling and the debrief.
 * Ratings are 1–4 with labelled anchors and no midpoint; every average and
 * every disagreement is Recruiting's, never computed here.
 */

const ANCHORS = ['Strong no', 'No', 'Yes', 'Strong yes'] as const;
const RECOMMENDATIONS: readonly Recommendation[] = ['strong_no', 'no', 'yes', 'strong_yes'];

/** RM1 on the web: what I interview next and the scorecards I owe. */
export function Interviews(props: ScreenProps<InterviewsData>): JSX.Element {
  return (
    <Loaded load={props.load} what="your interviews">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="My interviews"
            description="The next 30 days, and every scorecard you owe."
          />
          {data.owed.length === 0 ? null : (
            <Alert
              tone="warning"
              title={`${String(data.owed.length)} scorecard${data.owed.length === 1 ? '' : 's'} to submit`}
            >
              Due 24 hours after each interview.
            </Alert>
          )}
          {[
            { title: 'Scorecards owed', rows: data.owed },
            { title: 'Coming up', rows: data.upcoming },
          ].map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle level={2}>{group.title}</CardTitle>
              </CardHeader>
              <CardContent>
                {group.rows.length === 0 ? (
                  <EmptyState icon={<icons.meeting aria-hidden />} title="Nothing here" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Candidate</TableHead>
                        <TableHead>Interview</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead>State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>
                            <To
                              href={`/recruiting/interviews/${i.id}`}
                              onNavigate={props.onNavigate}
                            >
                              {i.candidate}
                            </To>
                            <span className="block text-sm text-fg-muted">{i.job}</span>
                          </TableCell>
                          <TableCell>{i.title}</TableCell>
                          <TableCell>{when(i.startsAt)}</TableCell>
                          <TableCell>
                            <StateBadge state={i.state} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Loaded>
  );
}

function Scale({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (v: number) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <SegmentedControl
      aria-label={label}
      value={value === null ? '' : String(value)}
      onValueChange={(v) => {
        onChange(Number(v));
      }}
      disabled={disabled}
      className="w-full"
    >
      {ANCHORS.map((a, i) => (
        <SegmentedControlItem key={a} value={String(i + 1)}>
          {`${String(i + 1)} · ${a}`}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** R15: what the interviewer opens, and the scorecard they fill as they go. */
export function Kit(props: ScreenProps<KitData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the interview">
      {(data) => <KitBody data={data} props={props} />}
    </Loaded>
  );
}

function KitBody({
  data,
  props,
}: {
  readonly data: KitData;
  readonly props: ScreenProps<KitData>;
}): JSX.Element {
  const act = useAct(props);
  const mine = data.scorecards.find((c) => c.interviewerId === data.me);
  const done = mine?.submittedAt != null;
  const [ratings, setRatings] = useState<Record<string, number>>({ ...mine?.ratings });
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    mine?.recommendation ?? null,
  );
  const [notes, setNotes] = useState('');
  const others = data.scorecards.filter(
    (c) => c.interviewerId !== data.me && c.submittedAt !== null,
  );
  const i = data.interview;
  const save = (submit: boolean) => {
    act.run('SaveScorecard', {
      interviewId: i.id,
      input: { ratings, recommendation, notes: notes === '' ? null : notes, submit },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={i.title}
        meta={<StateBadge state={i.state} />}
        description={`${data.candidate.name} · ${data.job.title}`}
        actions={
          i.state === 'scheduled' ? (
            <>
              <Button
                variant="secondary"
                loading={act.pending}
                onClick={() => {
                  act.run('SetInterviewState', { interviewId: i.id, input: { to: 'no_show' } });
                }}
              >
                No-show
              </Button>
              <Button
                loading={act.pending}
                onClick={() => {
                  act.run('SetInterviewState', { interviewId: i.id, input: { to: 'completed' } });
                }}
              >
                Mark completed
              </Button>
            </>
          ) : null
        }
      />
      <Refusal error={act.error} />
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card padded>
            <KeyValues
              layout="stacked"
              items={[
                { label: 'When', value: `${when(i.startsAt)} · ${String(i.minutes)} min` },
                { label: 'Where', value: i.videoUrl ?? i.place ?? '—' },
                {
                  label: 'With',
                  value: i.interviewerIds.map((id) => data.names[id] ?? id).join(', '),
                },
              ]}
            />
            {i.videoUrl === null ? null : (
              <div className="mt-3">
                <a
                  className="font-medium text-fg hover:underline"
                  href={i.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Join the call
                </a>
              </div>
            )}
          </Card>
          <Card padded>
            <To href={`/recruiting/candidates/${data.candidate.id}`} onNavigate={props.onNavigate}>
              {`${data.candidate.name}’s profile and CV`}
            </To>
          </Card>
          {done ? null : (
            <Alert tone="info" title="Hidden until you submit">
              Other interviewers’ scorecards.
            </Alert>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle level={2}>{`Scorecard: ${i.title}`}</CardTitle>
            <CardDescription>Rated 1–4 with labelled anchors. No midpoint.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {data.competencies.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No scorecard on this interview; give the overall recommendation.
              </p>
            ) : null}
            {data.competencies.map((c) => (
              <section
                key={c.key}
                className="flex flex-col gap-2 border-b border-[var(--reach-line)] pb-4"
              >
                <h3 className="font-semibold">{c.name}</h3>
                {c.description === '' ? null : (
                  <p className="text-sm text-fg-muted">{c.description}</p>
                )}
                {c.questions.length === 0 ? null : (
                  <ul className="list-disc pl-5 text-sm">
                    {c.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                )}
                <Scale
                  label={c.name}
                  value={ratings[c.key] ?? null}
                  disabled={done}
                  onChange={(v) => {
                    setRatings({ ...ratings, [c.key]: v });
                  }}
                />
              </section>
            ))}
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">Overall recommendation</h3>
              <Scale
                label="Overall recommendation"
                value={recommendation === null ? null : RECOMMENDATIONS.indexOf(recommendation) + 1}
                disabled={done}
                onChange={(v) => {
                  setRecommendation(RECOMMENDATIONS[v - 1] ?? null);
                }}
              />
            </section>
            {done ? null : (
              <Field>
                <FieldLabel>Notes</FieldLabel>
                <FieldControl>
                  <Textarea
                    autoResize
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                    }}
                    placeholder="What you saw and heard"
                  />
                </FieldControl>
              </Field>
            )}
            {done ? (
              <Badge tone="success">{`Submitted ${day(mine.submittedAt)}`}</Badge>
            ) : (
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  loading={act.pending}
                  onClick={() => {
                    save(false);
                  }}
                >
                  Save draft
                </Button>
                <Button
                  loading={act.pending}
                  onClick={() => {
                    save(true);
                  }}
                >
                  Submit scorecard
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {others.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Other scorecards</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValues
              items={others.map((c) => ({
                label: data.names[c.interviewerId] ?? c.interviewerId,
                value: c.recommendation === null ? '—' : words(c.recommendation),
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const DAY_KEY = (iso: string) => iso.slice(0, 10);

/** R16: book one interview of the plan, or send the candidate a link to choose. */
export function Schedule(props: ScreenProps<ScheduleData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the schedule">
      {(data) => <ScheduleBody data={data} props={props} />}
    </Loaded>
  );
}

function ScheduleBody({
  data,
  props,
}: {
  readonly data: ScheduleData;
  readonly props: ScreenProps<ScheduleData>;
}): JSX.Element {
  const act = useAct(props);
  const [how, setHow] = useState<'pick' | 'link'>('pick');
  const [slot, setSlot] = useState<string | null>(null);
  const [video, setVideo] = useState('');
  const [place, setPlace] = useState('');
  const applicationId = props.params?.['id'] ?? '';
  const plan = data.plan.find((p) => p.key === data.planKey);
  const byDay = new Map<string, string[]>();
  for (const s of data.slots) byDay.set(DAY_KEY(s), [...(byDay.get(DAY_KEY(s)) ?? []), s]);
  const week = (days: number) =>
    DAY_KEY(new Date(Date.parse(data.from) + days * 86_400_000).toISOString());
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  const back = () =>
    props.onNavigate?.(`/recruiting/candidates/${data.candidate.id}?application=${applicationId}`);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={plan === undefined ? 'Schedule an interview' : `Schedule: ${plan.title}`}
        description={`${data.candidate.name} · ${data.job.title}`}
      />
      <Refusal error={act.error} />
      {data.plan.length === 0 ? (
        <EmptyState
          icon={<icons.meeting aria-hidden />}
          title="No interview plan"
          description="Add the interviews to the job’s plan first."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle level={2}>Pick a slot</CardTitle>
              <CardDescription>
                {plan === undefined
                  ? ''
                  : `${String(plan.minutes)} min · ${plan.interviewerIds.map((id) => data.names[id] ?? id).join(', ') || 'No interviewers yet'}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ChipRow aria-label="Interview">
                {data.plan.map((p) => (
                  <Chip
                    key={p.key}
                    selected={p.key === data.planKey}
                    onClick={() => props.onFilter?.({ plan: p.key })}
                  >
                    {p.title}
                  </Chip>
                ))}
              </ChipRow>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Earlier week"
                  startIcon={<icons.previous aria-hidden />}
                  onClick={() => props.onFilter?.({ week: week(-7) })}
                />
                <span className="text-sm text-fg-muted">{`${day(data.from)} – ${day(data.to)}`}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Later week"
                  startIcon={<icons.next aria-hidden />}
                  onClick={() => props.onFilter?.({ week: week(7) })}
                />
              </div>
              {byDay.size === 0 ? (
                <EmptyState
                  icon={<icons.calendar aria-hidden />}
                  title="No slot fits everyone this week"
                  description="Try the next week, or let the candidate choose."
                />
              ) : (
                [...byDay].map(([d, slots]) => (
                  <section key={d} className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">
                      {new Intl.DateTimeFormat('en-GB', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                      }).format(new Date(d))}
                    </h3>
                    <ChipRow aria-label={`Slots on ${d}`}>
                      {slots.map((s) => (
                        <Chip
                          key={s}
                          selected={slot === s}
                          onClick={() => {
                            setSlot(s);
                          }}
                        >
                          {time.format(new Date(s))}
                        </Chip>
                      ))}
                    </ChipRow>
                  </section>
                ))
              )}
              <p className="text-xs text-fg-muted">
                Free for every interviewer, from their calendars or the working hours set in
                Recruiting. A day away in Time Off is never offered.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>How to book</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RadioGroup
                aria-label="How to book"
                value={how}
                onValueChange={(v) => {
                  setHow(v as typeof how);
                }}
              >
                <RadioCard
                  value="pick"
                  description="From free/busy, or working hours when a calendar isn’t connected."
                >
                  Pick a slot myself
                </RadioCard>
                <RadioCard
                  value="link"
                  description={`A link with slots that fit everyone, in ${data.candidate.name}’s time zone.`}
                >
                  Let the candidate choose
                </RadioCard>
              </RadioGroup>
              {how === 'pick' ? (
                <>
                  <Field>
                    <FieldLabel>Video link</FieldLabel>
                    <FieldControl>
                      <Input
                        type="url"
                        value={video}
                        onChange={(e) => {
                          setVideo(e.target.value);
                        }}
                        placeholder="https://meet.google.com/…"
                      />
                    </FieldControl>
                  </Field>
                  <Field>
                    <FieldLabel>Or an address</FieldLabel>
                    <FieldControl>
                      <Input
                        value={place}
                        onChange={(e) => {
                          setPlace(e.target.value);
                        }}
                      />
                    </FieldControl>
                  </Field>
                  <p className="text-sm">{slot === null ? 'Choose a slot.' : when(slot)}</p>
                  <Button
                    disabled={slot === null || data.planKey === null}
                    loading={act.pending}
                    onClick={() => {
                      act.run(
                        'ScheduleInterview',
                        {
                          applicationId,
                          input: {
                            planKey: data.planKey,
                            startsAt: slot,
                            place: place === '' ? null : place,
                            videoUrl: video === '' ? null : video,
                          },
                        },
                        back,
                      );
                    }}
                  >
                    Book and send invites
                  </Button>
                </>
              ) : (
                <Button
                  disabled={data.planKey === null}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'SelfScheduleLink',
                      { applicationId, input: { planKey: data.planKey } },
                      back,
                    );
                  }}
                >
                  Send the link
                </Button>
              )}
              <p className="text-xs text-fg-muted">
                Without a calendar, the invitation goes as an .ics file.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const CELL_TONE = ['danger', 'warning', 'success', 'success'] as const;

/** R17: scorecards side by side, disagreements flagged, the hiring manager decides. */
export function Debrief(props: ScreenProps<DebriefData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the debrief">
      {(data) => <DebriefBody data={data} props={props} />}
    </Loaded>
  );
}

function DebriefBody({
  data,
  props,
}: {
  readonly data: DebriefData;
  readonly props: ScreenProps<DebriefData>;
}): JSX.Element {
  const act = useAct(props);
  const [decision, setDecision] = useState<'advance' | 'reject' | 'offer'>('advance');
  const [reason, setReason] = useState('');
  const applicationId = props.params?.['id'] ?? '';
  const people = [...new Set(data.rows.flatMap((r) => r.ratings.map((x) => x.interviewerId)))];
  const name = (key: string) => data.competencies.find((c) => c.key === key)?.name ?? words(key);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Debrief: ${data.candidate.name}`}
        description={`${data.job.title} · averages and disagreements computed by Kithena`}
      />
      <Refusal error={act.error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle level={2}>Scorecards side by side</CardTitle>
            <CardDescription>{`${String(data.submitted)} of ${String(data.expected)} submitted`}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competency</TableHead>
                  {people.map((p) => (
                    <TableHead key={p}>{data.names[p] ?? p}</TableHead>
                  ))}
                  <TableHead>Average</TableHead>
                  <TableHead>
                    <span className="sr-only">Disagreement</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.competency}>
                    <TableCell className="font-medium">{name(r.competency)}</TableCell>
                    {people.map((p) => {
                      const v = r.ratings.find((x) => x.interviewerId === p)?.rating;
                      return (
                        <TableCell key={p}>
                          {v === undefined ? (
                            '—'
                          ) : (
                            <Badge size="sm" tone={CELL_TONE[v - 1] ?? 'neutral'}>
                              {String(v)}
                            </Badge>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="font-semibold">{r.average ?? '—'}</TableCell>
                    <TableCell>
                      {r.disagreement ? (
                        <Badge size="sm" tone="warning">
                          Disagree by 2+
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex flex-wrap gap-2">
              {RECOMMENDATIONS.filter((k) => data.recommendations[k] > 0).map((k) => (
                <Badge
                  key={k}
                  tone={k === 'yes' || k === 'strong_yes' ? 'success' : 'danger'}
                >{`${words(k)} × ${String(data.recommendations[k])}`}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle level={2}>Decision</CardTitle>
            <CardDescription>The hiring manager decides, with a reason</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SegmentedControl
              aria-label="Decision"
              value={decision}
              onValueChange={(v) => {
                setDecision(v as typeof decision);
              }}
              disabled={!data.decider}
              className="w-full"
            >
              <SegmentedControlItem value="advance">Advance</SegmentedControlItem>
              <SegmentedControlItem value="reject">Reject</SegmentedControlItem>
              <SegmentedControlItem value="offer">Make an offer</SegmentedControlItem>
            </SegmentedControl>
            <Field required>
              <FieldLabel>Reason</FieldLabel>
              <FieldControl>
                <Textarea
                  autoResize
                  value={reason}
                  disabled={!data.decider}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <Button
              disabled={!data.decider || reason.trim() === ''}
              loading={act.pending}
              onClick={() => {
                act.run('DecideApplication', { applicationId, input: { decision, reason } }, () => {
                  if (decision === 'offer')
                    props.onNavigate?.(`/recruiting/offers/new?application=${applicationId}`);
                });
              }}
            >
              Record decision
            </Button>
            {data.decider ? null : (
              <p className="text-xs text-fg-muted">
                Only the job’s hiring manager records the decision.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
