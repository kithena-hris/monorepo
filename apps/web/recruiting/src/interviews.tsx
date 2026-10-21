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
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  PageHeader,
  RadioCard,
  RadioGroup,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  SlotPicker,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  TimePicker,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, day, useAct, when, words } from './shared';
import type {
  Ask,
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
          <Hours props={props} />
          <Notifications props={props} />
        </div>
      )}
    </Loaded>
  );
}

type Week = Readonly<Record<string, readonly (readonly [number, number])[]>>;
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (t: string) => {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
};

/** §16.4: the hours a candidate may book me in when no calendar is connected, Monday to Friday. */
function Hours({ props }: { readonly props: ScreenProps<InterviewsData> }): JSX.Element | null {
  const act = useAct(props);
  const [hours, setHours] = useState<{ timeZone: string; from: number; to: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const { call } = act;
  useEffect(() => {
    void call('RecruitingWorkingHours', {}).then((done) => {
      if (!done.ok) return;
      const h = done.data as { timeZone: string; week: Week };
      const [from, to] = h.week['1']?.[0] ?? [540, 1020];
      setHours({ timeZone: h.timeZone, from, to });
    });
  }, []);
  if (hours === null) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Working hours</CardTitle>
        <CardDescription>
          Candidates book you inside these hours, Monday to Friday, around anything on your
          connected calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        {(['from', 'to'] as const).map((k) => (
          <Field key={k}>
            <FieldLabel>{k === 'from' ? 'From' : 'To'}</FieldLabel>
            <FieldControl>
              <TimePicker
                label={k === 'from' ? 'From' : 'To'}
                value={clock(hours[k])}
                step={30}
                onChange={(t) => {
                  if (t !== null) setHours({ ...hours, [k]: minutes(t) });
                  setSaved(false);
                }}
              />
            </FieldControl>
          </Field>
        ))}
        <Field>
          <FieldLabel>Time zone</FieldLabel>
          <FieldControl>
            <Input
              value={hours.timeZone}
              onChange={(e) => {
                setHours({ ...hours, timeZone: e.target.value });
                setSaved(false);
              }}
            />
          </FieldControl>
        </Field>
        <Button
          loading={act.pending}
          onClick={() => {
            act.run(
              'SaveRecruitingWorkingHours',
              {
                input: {
                  timeZone: hours.timeZone,
                  week: Object.fromEntries(
                    ['1', '2', '3', '4', '5'].map((d) => [d, [[hours.from, hours.to]]]),
                  ),
                },
              },
              () => {
                setSaved(true);
              },
            );
          }}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
        <Refusal error={act.error} />
      </CardContent>
      <Connections props={props} />
    </Card>
  );
}

const PROVIDER: Readonly<Record<string, string>> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
  zoom: 'Zoom',
};

/**
 * §26.2: a calendar for busy times and the interview's event, and Zoom for its
 * link. Connecting leaves the page for the provider's consent and comes back.
 */
function Connections({
  props,
}: {
  readonly props: ScreenProps<InterviewsData>;
}): JSX.Element | null {
  const act = useAct(props);
  const [state, setState] = useState<{
    connected: readonly string[];
    offered: readonly string[];
    workspace: boolean;
  } | null>(null);
  const { call } = act;
  const load = () => {
    void call('RecruitingConnections', {}).then((done) => {
      if (done.ok)
        setState(done.data as { connected: string[]; offered: string[]; workspace: boolean });
    });
  };
  useEffect(load, []);
  if (state === null || (state.offered.length === 0 && !state.workspace)) return null;
  return (
    <CardContent className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        Connected, your calendar’s busy times are left out of the slots offered, and interviews go
        on it with a video link.
      </p>
      <ul className="flex flex-col gap-2">
        {state.offered.map((kind) => {
          const on = state.connected.includes(kind);
          return (
            <li key={kind} className="flex flex-wrap items-center gap-2">
              <span className="min-w-40 font-medium">{PROVIDER[kind] ?? kind}</span>
              {on ? (
                <Badge size="sm" tone="success">
                  Connected
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant={on ? 'secondary' : 'primary'}
                aria-label={`${on ? 'Disconnect' : 'Connect'} ${PROVIDER[kind] ?? kind}`}
                disabled={act.pending}
                onClick={() => {
                  if (on) act.run('DisconnectRecruitingCalendar', { kind }, load);
                  else
                    act.run(
                      'ConnectRecruitingCalendar',
                      { kind, input: { returnTo: window.location.href } },
                      (data) => {
                        window.location.assign((data as { url: string }).url);
                      },
                    );
                }}
              >
                {on ? 'Disconnect' : 'Connect'}
              </Button>
            </li>
          );
        })}
      </ul>
      <Refusal error={act.error} />
    </CardContent>
  );
}

/**
 * Whether you are emailed when a candidate gives times, asks for a change or
 * answers a question. Your Inbox has each one either way.
 */
function Notifications({
  props,
}: {
  readonly props: ScreenProps<InterviewsData>;
}): JSX.Element | null {
  const act = useAct(props);
  const [email, setEmail] = useState<boolean | null>(null);
  const { call } = act;
  useEffect(() => {
    void call('RecruitingMyNotifications', {}).then((done) => {
      if (done.ok) setEmail((done.data as { email: boolean }).email);
    });
  }, [call]);
  if (email === null) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field orientation="horizontal">
          <span className="flex min-w-0 flex-col">
            <FieldLabel>Email me when a candidate acts</FieldLabel>
            <FieldDescription>
              When they give times, ask to move an interview or answer a question. Your Inbox has
              each one either way.
            </FieldDescription>
          </span>
          <FieldControl>
            <Switch
              checked={email}
              disabled={act.pending}
              onCheckedChange={(on) => {
                setEmail(on);
                act.run('SaveRecruitingMyNotifications', { input: { email: on } });
              }}
            />
          </FieldControl>
        </Field>
        <Refusal error={act.error} />
      </CardContent>
    </Card>
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

/** One ask as a row: what was offered or asked, where it stands, and the answer. */
function AskRow({
  ask,
  onClose,
  pending,
}: {
  readonly ask: Ask;
  readonly onClose?: (() => void) | undefined;
  readonly pending: boolean;
}): JSX.Element {
  const tone = ask.state === 'open' ? 'warning' : ask.state === 'answered' ? 'success' : 'neutral';
  const title =
    ask.kind === 'slots'
      ? `${ask.times.length === 1 ? 'A time' : `${String(ask.times.length)} times`} offered for the ${ask.label.toLowerCase()}`
      : ask.kind === 'info'
        ? `Asked: ${ask.label}`
        : ask.kind === 'availability'
          ? `Candidate offered ${String(ask.times.length)} time${ask.times.length === 1 ? '' : 's'} for the ${ask.label.toLowerCase()}`
          : `Candidate asks to move the ${ask.label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--reach-line)] pb-3 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        <Badge size="sm" tone={tone}>
          {ask.state === 'open'
            ? 'Waiting on the candidate'
            : ask.state === 'answered'
              ? ask.kind === 'slots' && ask.answer?.time != null
                ? 'Booked'
                : 'Answered'
              : ask.closedBecause === 'replaced'
                ? 'Replaced by new times'
                : ask.closedBecause === 'more_times'
                  ? 'Asked for more times'
                  : 'Closed'}
        </Badge>
        <span className="text-xs text-fg-muted">{when(ask.createdAt)}</span>
        {onClose !== undefined && ask.state !== 'closed' ? (
          <Button variant="ghost" size="sm" loading={pending} onClick={onClose} className="ms-auto">
            Mark dealt with
          </Button>
        ) : null}
      </div>
      {ask.kind === 'slots' || ask.kind === 'availability' ? (
        <span className="text-sm text-fg-muted">{ask.times.map(when).join(' · ')}</span>
      ) : null}
      {ask.agenda === null ? null : (
        <span className="text-sm text-fg-muted">{`Agenda: ${ask.agenda.text}`}</span>
      )}
      {ask.detail === null ? null : <span className="text-sm text-fg-muted">{ask.detail}</span>}
      {ask.answer === null ? null : (
        <span className="text-sm">
          {ask.answer.time !== null ? `Chose ${when(ask.answer.time)}. ` : ''}
          {ask.answer.text ?? (ask.answer.time === null ? 'None of the times work.' : '')}
        </span>
      )}
    </div>
  );
}

/** The asks on an application, newest first, with the team's way to close one. */
export function AskList({
  asks,
  applicationId,
  act,
}: {
  readonly asks: readonly Ask[];
  readonly applicationId: string;
  readonly act: ReturnType<typeof useAct>;
}): JSX.Element | null {
  if (asks.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {asks.map((a) => (
        <AskRow
          key={a.id}
          ask={a}
          pending={act.pending}
          onClose={() => {
            act.run('CloseAsk', { applicationId, askId: a.id });
          }}
        />
      ))}
    </div>
  );
}

/** Where an interview happens: a Meet made at booking, a link pasted, or an address. */
type Where = 'meet' | 'link' | 'place';

/** A ProseMirror node, as the editor hands its document over. */
interface DocNode {
  readonly type?: string;
  readonly text?: string;
  readonly content?: readonly DocNode[];
}

/** The document's words, a line per block, read from the editor's tree rather than its HTML. */
function plainText(node: DocNode): string {
  if (node.text !== undefined) return node.text;
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(plainText);
  const block = ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(
    node.type ?? '',
  );
  return block ? `${inner.join('')}\n` : inner.join('');
}

/** The agenda, written once as rich text and kept with its plain words for mail and calendars. */
function AgendaEditor({
  value,
  onChange,
}: {
  readonly value: { html: string; text: string } | null;
  readonly onChange: (next: { html: string; text: string } | null) => void;
}): JSX.Element {
  // The editor reports its HTML, then its tree, on every change: the HTML is held for the tree's turn.
  const html = useRef(value?.html ?? '');
  return (
    <Field>
      <FieldLabel>Agenda</FieldLabel>
      <FieldDescription>
        What the interview is about and how to prepare. It goes in the invitation and as the
        calendar event’s description.
      </FieldDescription>
      <FieldControl>
        <RichTextEditor
          label="Agenda"
          value={value?.html ?? ''}
          minHeight="8rem"
          onChange={(next) => {
            html.current = next;
          }}
          onChangeJson={(doc) => {
            const text = plainText(doc)
              .replaceAll(/\n{3,}/gu, '\n\n')
              .trim();
            onChange(text === '' ? null : { html: html.current, text });
          }}
        />
      </FieldControl>
    </Field>
  );
}

/** The where: Meet when it can be made, else a link or an address. */
function WhereFields({
  where,
  onWhere,
  video,
  onVideo,
  place,
  onPlace,
  meet,
}: {
  readonly where: Where;
  readonly onWhere: (w: Where) => void;
  readonly video: string;
  readonly onVideo: (v: string) => void;
  readonly place: string;
  readonly onPlace: (v: string) => void;
  readonly meet: boolean;
}): JSX.Element {
  return (
    <>
      <Field>
        <FieldLabel>Where</FieldLabel>
        <SegmentedControl
          aria-label="Where"
          value={where}
          onValueChange={(v) => {
            onWhere(v as Where);
          }}
        >
          <SegmentedControlItem value="meet">Google Meet</SegmentedControlItem>
          <SegmentedControlItem value="link">A link</SegmentedControlItem>
          <SegmentedControlItem value="place">An address</SegmentedControlItem>
        </SegmentedControl>
        {where === 'meet' ? (
          <FieldDescription>
            {meet
              ? 'A Meet link is made on the organiser’s calendar at booking and sent with the invitation.'
              : 'No calendar is connected for these interviewers: connect one under Settings, Integrations, or paste a link.'}
          </FieldDescription>
        ) : null}
      </Field>
      {where === 'link' ? (
        <Field required>
          <FieldLabel>Video link</FieldLabel>
          <FieldControl>
            <Input
              type="url"
              value={video}
              onChange={(e) => {
                onVideo(e.target.value);
              }}
              placeholder="https://meet.google.com/abc-defg-hij"
            />
          </FieldControl>
        </Field>
      ) : null}
      {where === 'place' ? (
        <Field required>
          <FieldLabel>Address</FieldLabel>
          <FieldControl>
            <Input
              value={place}
              onChange={(e) => {
                onPlace(e.target.value);
              }}
              placeholder="Berlin office, 3rd floor"
            />
          </FieldControl>
        </Field>
      ) : null}
    </>
  );
}

/**
 * R16: book one interview of the plan from a calendar, offer the candidate a
 * few times to choose from, or send them a link to offer up to ten times of
 * their own. The calendar strikes the days with nothing free (a weekend, a
 * holiday, everyone away, hours over); a day's free times are a list, and
 * what was picked is grouped by day. A Meet is made at booking unless a
 * link or an address is given; the agenda goes with every invitation.
 */
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
  const [how, setHow] = useState<'book' | 'offer' | 'link'>('book');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [where, setWhere] = useState<Where>(data.meet ? 'meet' : 'link');
  const [video, setVideo] = useState('');
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const [agenda, setAgenda] = useState<{ html: string; text: string } | null>(null);
  const [fromAsk, setFromAsk] = useState<{ askId: string; time: string } | null>(null);
  const applicationId = props.params?.['id'] ?? '';
  const plan = data.plan.find((p) => p.key === data.planKey);
  const today = DAY_KEY(data.from);
  const back = () =>
    props.onNavigate?.(
      `/recruiting/candidates/${data.candidate.id}?application=${applicationId}&tab=process`,
    );
  const whereInput = {
    place: where === 'place' && place !== '' ? place : null,
    videoUrl: where === 'link' && video !== '' ? video : null,
    agenda,
  };
  const whereReady =
    where === 'meet' || (where === 'link' && video !== '') || (where === 'place' && place !== '');
  const offered = data.asks.filter((a) => a.kind === 'availability' && a.state === 'open');
  const unavailable = Object.fromEntries(data.holidays.map((h) => [h.date, h.name]));
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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex flex-col gap-4">
            {offered.map((a) => (
              <Card key={a.id}>
                <CardHeader>
                  <CardTitle
                    level={2}
                  >{`${data.candidate.name} offered ${String(a.times.length)} time${a.times.length === 1 ? '' : 's'}`}</CardTitle>
                  <CardDescription>
                    {`Pick one and book it: the invitation goes with ${a.videoUrl ?? a.place ?? 'a Google Meet link'}${a.agenda === null ? '' : ' and the agenda you wrote'}. None works? Ask for more and these are left out.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <SlotPicker
                    label="Times the candidate offered"
                    slots={a.times}
                    max={1}
                    today={today}
                    unavailable={unavailable}
                    {...(plan === undefined ? {} : { minutes: plan.minutes })}
                    value={fromAsk?.askId === a.id && fromAsk.time !== '' ? [fromAsk.time] : []}
                    onChange={(v) => {
                      setFromAsk({ askId: a.id, time: v[0] ?? '' });
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={fromAsk?.askId !== a.id || fromAsk.time === ''}
                      loading={act.pending}
                      startIcon={<icons.send aria-hidden />}
                      onClick={() => {
                        if (fromAsk === null) return;
                        // Where and the agenda are the ones chosen when the link was sent.
                        act.run(
                          'BookFromAsk',
                          { applicationId, askId: a.id, input: { startsAt: fromAsk.time } },
                          back,
                        );
                      }}
                    >
                      Book this time and send the invitation
                    </Button>
                    <Button
                      variant="secondary"
                      loading={act.pending}
                      onClick={() => {
                        act.run('RequestMoreTimes', {
                          applicationId,
                          askId: a.id,
                          input: { note: null },
                        });
                      }}
                    >
                      None works: ask for more times
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader>
                <CardTitle level={2}>
                  {how === 'link' ? 'The candidate picks' : 'Pick a day, then a time'}
                </CardTitle>
                <CardDescription>
                  {plan === undefined
                    ? ''
                    : `${String(plan.minutes)} min · ${plan.interviewerIds.map((id) => data.names[id] ?? id).join(', ') || 'No interviewers yet'} · free for you and every interviewer; a struck day has nothing free: a weekend, a holiday, someone away, or the hours over.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {data.plan.length > 1 ? (
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
                ) : null}
                {how === 'link' ? (
                  <p className="text-sm text-fg-muted">
                    {`${data.candidate.name} gets a link to the same free times, in their own time zone, holidays and days away left out, and gives ten. You book one from here.`}
                  </p>
                ) : (
                  <SlotPicker
                    label="Interview times"
                    slots={data.slots}
                    booked={data.booked.map((b) => b.startsAt)}
                    today={today}
                    unavailable={unavailable}
                    {...(plan === undefined ? {} : { minutes: plan.minutes })}
                    {...(how === 'book' ? { max: 1 } : { max: 12 })}
                    value={picked}
                    onChange={setPicked}
                  />
                )}
              </CardContent>
            </Card>
            {data.asks.length === 0 && data.booked.length === 0 ? null : (
              <Card>
                <CardHeader>
                  <CardTitle level={2}>With the candidate</CardTitle>
                  <CardDescription>What is booked, offered or asked, newest first.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.booked.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge size="sm" tone="accent">
                        Booked
                      </Badge>
                      <span className="font-medium">{b.title}</span>
                      <span className="text-fg-muted">{when(b.startsAt)}</span>
                      {(b.videoUrl ?? b.place) ? (
                        <span className="text-fg-muted">{b.videoUrl ?? b.place}</span>
                      ) : null}
                    </div>
                  ))}
                  <AskList
                    asks={data.asks.filter(
                      (a) => !(a.kind === 'availability' && a.state === 'open'),
                    )}
                    applicationId={applicationId}
                    act={act}
                  />
                </CardContent>
              </Card>
            )}
          </div>
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
                  setPicked([]);
                }}
              >
                <RadioCard
                  value="book"
                  description="One time, booked now. The invitation goes at once."
                >
                  Book a time
                </RadioCard>
                <RadioCard
                  value="offer"
                  description={`Several times; ${data.candidate.name} picks one from their page or asks for others.`}
                >
                  Offer times to choose from
                </RadioCard>
                <RadioCard
                  value="link"
                  description={`${data.candidate.name} gives ten times that fit everyone; you book one.`}
                >
                  Ask for their availability
                </RadioCard>
              </RadioGroup>
              <WhereFields
                where={where}
                onWhere={setWhere}
                video={video}
                onVideo={setVideo}
                place={place}
                onPlace={setPlace}
                meet={data.meet}
              />
              {how === 'offer' ? (
                <Field>
                  <FieldLabel>A line for the candidate (optional)</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      value={note}
                      onChange={(e) => {
                        setNote(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
              ) : null}
              <AgendaEditor value={agenda} onChange={setAgenda} />
              {how === 'book' ? (
                <Button
                  disabled={picked.length === 0 || data.planKey === null || !whereReady}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'ScheduleInterview',
                      {
                        applicationId,
                        input: { planKey: data.planKey, startsAt: picked[0], ...whereInput },
                      },
                      back,
                    );
                  }}
                >
                  Book and send the invitation
                </Button>
              ) : how === 'offer' ? (
                <Button
                  disabled={picked.length === 0 || data.planKey === null || !whereReady}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'ProposeSlots',
                      {
                        applicationId,
                        input: {
                          planKey: data.planKey,
                          times: [...picked].toSorted(),
                          note: note === '' ? null : note,
                          ...whereInput,
                        },
                      },
                      back,
                    );
                  }}
                >
                  {`Send ${picked.length === 1 ? 'this time' : `${String(picked.length)} times`} to the candidate`}
                </Button>
              ) : (
                <Button
                  disabled={data.planKey === null || !whereReady}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'SelfScheduleLink',
                      {
                        applicationId,
                        input: {
                          planKey: data.planKey,
                          away: data.away,
                          holidays: data.holidays,
                          weeks: data.weeks,
                          // Kept for the booking from the times that come back.
                          ...whereInput,
                        },
                      },
                      back,
                    );
                  }}
                >
                  Send the link
                </Button>
              )}
              <p className="text-xs text-fg-muted">
                The email goes the moment you press. Without a calendar, the invitation carries an
                .ics file.
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
  const [summary, setSummary] = useState<{
    sentences: readonly { text: string; cites: readonly string[] }[];
    sources: readonly { id: string; interviewerId: string }[];
  } | null>(null);
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
      <Card>
        <CardHeader>
          <CardTitle level={2}>Summary</CardTitle>
          <CardDescription>
            Written by a model from the scorecards; every line names the scorecards it came from. It
            never recommends: that is yours.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {summary === null ? (
            <Button
              variant="secondary"
              loading={act.pending}
              disabled={data.submitted === 0}
              onClick={() => {
                act.run('SummariseDebrief', { applicationId }, (d) => {
                  setSummary(d as NonNullable<typeof summary>);
                });
              }}
            >
              Summarise the scorecards
            </Button>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.sentences.map((x) => (
                <li key={x.text}>
                  {x.text}{' '}
                  <span className="text-fg-muted">
                    {`(${x.cites
                      .map((c) => {
                        const by = summary.sources.find((s) => s.id === c)?.interviewerId ?? '';
                        return data.names[by] ?? c;
                      })
                      .join(', ')})`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
