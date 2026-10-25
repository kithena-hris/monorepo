import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
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
  formatList,
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
import { t as tr } from './i18n';

/**
 * R14–R17: my interviews, the kit and scorecard, scheduling and the debrief.
 * Ratings are 1–4 with labelled anchors and no midpoint; every average and
 * every disagreement is Recruiting's, never computed here.
 */

const ANCHORS = () =>
  [
    tr('interviews.strong_no', 'Strong no'),
    tr('interviews.no', 'No'),
    tr('interviews.yes', 'Yes'),
    tr('interviews.strong_yes', 'Strong yes'),
  ] as const;
const RECOMMENDATIONS: readonly Recommendation[] = ['strong_no', 'no', 'yes', 'strong_yes'];

/** RM1 on the web: what I interview next and the scorecards I owe. */
export function Interviews(props: ScreenProps<InterviewsData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('interviews.your_interviews', 'your interviews')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('interviews.my_interviews', 'My interviews')}
            description={tr(
              'interviews.the_next_30_days_and_every',
              'The next 30 days, and every scorecard you owe.',
            )}
          />
          {data.owed.length === 0 ? null : (
            <Alert
              tone="warning"
              title={tr(
                'interviews.scorecard_to_submit',
                { one: '{{count}} scorecard to submit', other: '{{count}} scorecards to submit' },
                { count: data.owed.length },
              )}
            >
              {tr(
                'interviews.due_24_hours_after_each_interview',
                'Due 24 hours after each interview.',
              )}
            </Alert>
          )}
          {[
            { title: tr('interviews.scorecards_owed', 'Scorecards owed'), rows: data.owed },
            { title: tr('interviews.coming_up', 'Coming up'), rows: data.upcoming },
          ].map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle level={2}>{group.title}</CardTitle>
              </CardHeader>
              <CardContent>
                {group.rows.length === 0 ? (
                  <EmptyState
                    icon={<icons.meeting aria-hidden />}
                    title={tr('interviews.nothing_here', 'Nothing here')}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr('interviews.candidate', 'Candidate')}</TableHead>
                        <TableHead>{tr('interviews.interview', 'Interview')}</TableHead>
                        <TableHead>{tr('interviews.when', 'When')}</TableHead>
                        <TableHead>{tr('interviews.state', 'State')}</TableHead>
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
        <CardTitle level={2}>{tr('interviews.working_hours', 'Working hours')}</CardTitle>
        <CardDescription>
          {tr(
            'interviews.candidates_book_you_inside_these_hours',
            'Candidates book you inside these hours, Monday to Friday, around anything on your connected calendar.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        {(['from', 'to'] as const).map((k) => (
          <Field key={k}>
            <FieldLabel>
              {k === 'from' ? tr('interviews.from', 'From') : tr('interviews.to', 'To')}
            </FieldLabel>
            <FieldControl>
              <TimePicker
                label={k === 'from' ? tr('interviews.from', 'From') : tr('interviews.to', 'To')}
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
          <FieldLabel>{tr('interviews.time_zone', 'Time zone')}</FieldLabel>
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
          {saved ? tr('interviews.saved', 'Saved') : tr('interviews.save', 'Save')}
        </Button>
        <Refusal error={act.error} />
      </CardContent>
      <Connections props={props} />
    </Card>
  );
}

const PROVIDER: Readonly<Record<string, string>> = {
  get google(): string {
    return tr('interviews.google_calendar', 'Google Calendar');
  },
  get microsoft(): string {
    return tr('interviews.microsoft_365', 'Microsoft 365');
  },
  get zoom(): string {
    return tr('interviews.zoom', 'Zoom');
  },
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
        {tr(
          'interviews.connected_your_calendars_busy_times_are',
          'Connected, your calendar’s busy times are left out of the slots offered, and interviews go on it with a video link.',
        )}
      </p>
      <ul className="flex flex-col gap-2">
        {state.offered.map((kind) => {
          const on = state.connected.includes(kind);
          return (
            <li key={kind} className="flex flex-wrap items-center gap-2">
              <span className="min-w-40 font-medium">{PROVIDER[kind] ?? kind}</span>
              {on ? (
                <Badge size="sm" tone="success">
                  {tr('interviews.connected', 'Connected')}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant={on ? 'secondary' : 'primary'}
                aria-label={
                  on
                    ? tr('interviews.disconnect_provider', 'Disconnect {{provider}}', {
                        provider: PROVIDER[kind] ?? kind,
                      })
                    : tr('interviews.connect_provider', 'Connect {{provider}}', {
                        provider: PROVIDER[kind] ?? kind,
                      })
                }
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
                {on
                  ? tr('interviews.disconnect', 'Disconnect')
                  : tr('interviews.connect', 'Connect')}
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
        <CardTitle level={2}>{tr('interviews.notifications', 'Notifications')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field orientation="horizontal">
          <span className="flex min-w-0 flex-col">
            <FieldLabel>
              {tr('interviews.email_me_when_a_candidate_acts', 'Email me when a candidate acts')}
            </FieldLabel>
            <FieldDescription>
              {tr(
                'interviews.on_unless_you_switch_it_off',
                'On unless you switch it off: when they give times, ask to move an interview or answer a question. Your Inbox has each one either way.',
              )}
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
      {ANCHORS().map((a, i) => (
        <SegmentedControlItem key={a} value={String(i + 1)}>
          {tr('interviews.text_2', '{{value}} · {{a}}', { value: String(i + 1), a })}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/**
 * The meeting link when none was made for the interview (no calendar
 * connected), or a new one: saving sends the candidate and the panel the
 * invitation again with it.
 */
function MeetingLink({
  current,
  pending,
  onSave,
}: {
  readonly current: string | null;
  readonly pending: boolean;
  readonly onSave: (videoUrl: string) => void;
}): JSX.Element {
  const [link, setLink] = useState(current ?? '');
  const valid = /^https:\/\/\S+$/u.test(link.trim());
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(link.trim());
      }}
    >
      <Field>
        <FieldLabel>{tr('interviews.meeting_link', 'Meeting link')}</FieldLabel>
        <FieldControl>
          <Input
            type="url"
            inputMode="url"
            placeholder="https://meet.google.com/…"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
            }}
          />
        </FieldControl>
        <FieldDescription>
          {current === null
            ? tr(
                'interviews.no_link_was_made_paste_one',
                'No link was made for this interview. Paste one from Meet, Teams or Zoom; the candidate and the panel get the invitation again with it.',
              )
            : tr(
                'interviews.change_the_link_invitation_again',
                'Changing it sends the candidate and the panel the invitation again.',
              )}
        </FieldDescription>
      </Field>
      <div>
        <Button
          type="submit"
          variant="secondary"
          loading={pending}
          disabled={!valid || link.trim() === current}
        >
          {current === null
            ? tr('interviews.add_link_and_send', 'Add link and send')
            : tr('interviews.update_link_and_send', 'Update link and send')}
        </Button>
      </div>
    </form>
  );
}

/** R15: what the interviewer opens, and the scorecard they fill as they go. */
export function Kit(props: ScreenProps<KitData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('interviews.the_interview', 'the interview')}>
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
        description={tr('interviews.text_3', '{{name}} · {{title}}', {
          name: data.candidate.name,
          title: data.job.title,
        })}
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
                {tr('interviews.no_show', 'No-show')}
              </Button>
              <Button
                loading={act.pending}
                onClick={() => {
                  act.run('SetInterviewState', { interviewId: i.id, input: { to: 'completed' } });
                }}
              >
                {tr('interviews.mark_completed', 'Mark completed')}
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
                {
                  label: tr('interviews.when', 'When'),
                  value: `${when(i.startsAt)} · ${String(i.minutes)} min`,
                },
                { label: tr('interviews.where', 'Where'), value: i.videoUrl ?? i.place ?? '—' },
                {
                  label: tr('interviews.with', 'With'),
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
                  {tr('interviews.join_the_call', 'Join the call')}
                </a>
              </div>
            )}
            {data.schedules && i.state === 'scheduled' ? (
              <MeetingLink
                key={i.videoUrl ?? ''}
                current={i.videoUrl}
                pending={act.pending}
                onSave={(videoUrl) => {
                  act.run('SetInterviewLink', { interviewId: i.id, input: { videoUrl } });
                }}
              />
            ) : null}
          </Card>
          <Card padded>
            <To href={`/recruiting/candidates/${data.candidate.id}`} onNavigate={props.onNavigate}>
              {tr('interviews.s_profile_and_cv', '{{name}}’s profile and CV', {
                name: data.candidate.name,
              })}
            </To>
          </Card>
          {done ? null : (
            <Alert
              tone="info"
              title={tr('interviews.hidden_until_you_submit', 'Hidden until you submit')}
            >
              {tr('interviews.other_interviewers_scorecards', 'Other interviewers’ scorecards.')}
            </Alert>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('interviews.scorecard', 'Scorecard: {{title}}', { title: i.title })}
            </CardTitle>
            <CardDescription>
              {tr(
                'interviews.rated_1_4_with_labelled_anchors',
                'Rated 1–4 with labelled anchors. No midpoint.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {data.competencies.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {tr(
                  'interviews.no_scorecard_on_this_interview_give',
                  'No scorecard on this interview; give the overall recommendation.',
                )}
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
              <h3 className="font-semibold">
                {tr('interviews.overall_recommendation', 'Overall recommendation')}
              </h3>
              <Scale
                label={tr('interviews.overall_recommendation', 'Overall recommendation')}
                value={recommendation === null ? null : RECOMMENDATIONS.indexOf(recommendation) + 1}
                disabled={done}
                onChange={(v) => {
                  setRecommendation(RECOMMENDATIONS[v - 1] ?? null);
                }}
              />
            </section>
            {done ? null : (
              <Field>
                <FieldLabel>{tr('interviews.notes', 'Notes')}</FieldLabel>
                <FieldControl>
                  <Textarea
                    autoResize
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                    }}
                    placeholder={tr('interviews.what_you_saw_and_heard', 'What you saw and heard')}
                  />
                </FieldControl>
              </Field>
            )}
            {done ? (
              <Badge tone="success">
                {tr('interviews.submitted', 'Submitted {{submittedAt}}', {
                  submittedAt: day(mine.submittedAt),
                })}
              </Badge>
            ) : (
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  loading={act.pending}
                  onClick={() => {
                    save(false);
                  }}
                >
                  {tr('interviews.save_draft', 'Save draft')}
                </Button>
                <Button
                  loading={act.pending}
                  onClick={() => {
                    save(true);
                  }}
                >
                  {tr('interviews.submit_scorecard', 'Submit scorecard')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {others.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('interviews.other_scorecards', 'Other scorecards')}</CardTitle>
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
      ? tr(
          'interviews.offered_for_the',
          {
            one: 'A time offered for the {{label}}',
            other: '{{count}} times offered for the {{label}}',
          },
          { count: ask.times.length, label: ask.label.toLowerCase() },
        )
      : ask.kind === 'info'
        ? tr('interviews.asked', 'Asked: {{label}}', { label: ask.label })
        : ask.kind === 'availability'
          ? tr(
              'interviews.candidate_offered_time_for_the',
              {
                one: 'Candidate offered {{count}} time for the {{label}}',
                other: 'Candidate offered {{count}} times for the {{label}}',
              },
              { count: ask.times.length, label: ask.label.toLowerCase() },
            )
          : tr('interviews.candidate_asks_to_move_the', 'Candidate asks to move the {{label}}', {
              label: ask.label.toLowerCase(),
            });
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--reach-line)] pb-3 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        <Badge size="sm" tone={tone}>
          {ask.state === 'open'
            ? tr('interviews.waiting_on_the_candidate', 'Waiting on the candidate')
            : ask.state === 'answered'
              ? ask.kind === 'slots' && ask.answer?.time != null
                ? tr('interviews.booked', 'Booked')
                : tr('interviews.answered', 'Answered')
              : ask.closedBecause === 'replaced'
                ? tr('interviews.replaced_by_new_times', 'Replaced by new times')
                : ask.closedBecause === 'more_times'
                  ? tr('interviews.asked_for_more_times', 'Asked for more times')
                  : tr('interviews.closed', 'Closed')}
        </Badge>
        <span className="text-xs text-fg-muted">{when(ask.createdAt)}</span>
        {onClose !== undefined && ask.state !== 'closed' ? (
          <Button variant="ghost" size="sm" loading={pending} onClick={onClose} className="ms-auto">
            {tr('interviews.mark_dealt_with', 'Mark dealt with')}
          </Button>
        ) : null}
      </div>
      {ask.kind === 'slots' || ask.kind === 'availability' ? (
        <span className="text-sm text-fg-muted">{ask.times.map(when).join(' · ')}</span>
      ) : null}
      {ask.agenda === null ? null : (
        <span className="text-sm text-fg-muted">
          {tr('interviews.agenda', 'Agenda: {{text}}', { text: ask.agenda.text })}
        </span>
      )}
      {ask.detail === null ? null : <span className="text-sm text-fg-muted">{ask.detail}</span>}
      {ask.answer === null ? null : (
        <span className="text-sm">
          {ask.answer.time !== null
            ? tr('interviews.chose', 'Chose {{time}}.', { time: when(ask.answer.time) }) + ' '
            : ''}
          {ask.answer.text ??
            (ask.answer.time === null
              ? tr('interviews.none_of_the_times_work', 'None of the times work.')
              : '')}
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

/**
 * The agenda, written once as rich text and kept with its plain words for
 * mail and calendars. It opens on the one last written for this interview of
 * the job; AI can draft it from the job, to edit.
 */
function AgendaEditor({
  value,
  onChange,
  onDraft,
  drafting,
}: {
  readonly value: { html: string; text: string } | null;
  readonly onChange: (next: { html: string; text: string } | null) => void;
  readonly onDraft: () => void;
  readonly drafting: boolean;
}): JSX.Element {
  // The editor reports its HTML, then its tree, on every change: the HTML is held for the tree's turn.
  const html = useRef(value?.html ?? '');
  return (
    <Field>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel>{tr('interviews.agenda_2', 'Agenda')}</FieldLabel>
          <FieldDescription>
            {tr(
              'interviews.in_the_invitation_and_the_calendar',
              'In the invitation and the calendar event. Kept for the next time this interview is booked.',
            )}
          </FieldDescription>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={drafting}
          startIcon={<icons.assistant aria-hidden />}
          onClick={onDraft}
        >
          {value === null
            ? tr('interviews.draft_with_ai', 'Draft with AI')
            : tr('interviews.redraft_with_ai', 'Redraft with AI')}
        </Button>
      </div>
      <FieldControl>
        <RichTextEditor
          label={tr('interviews.agenda_2', 'Agenda')}
          value={value?.html ?? ''}
          minHeight="10rem"
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
        <FieldLabel>{tr('interviews.where', 'Where')}</FieldLabel>
        <SegmentedControl
          aria-label={tr('interviews.where', 'Where')}
          value={where}
          onValueChange={(v) => {
            onWhere(v as Where);
          }}
        >
          <SegmentedControlItem value="meet">
            {tr('interviews.google_meet', 'Google Meet')}
          </SegmentedControlItem>
          <SegmentedControlItem value="link">
            {tr('interviews.a_link', 'A link')}
          </SegmentedControlItem>
          <SegmentedControlItem value="place">
            {tr('interviews.an_address', 'An address')}
          </SegmentedControlItem>
        </SegmentedControl>
        {where === 'meet' ? (
          <FieldDescription>
            {meet
              ? tr(
                  'interviews.a_meet_link_is_made_on',
                  'A Meet link is made on the organiser’s calendar at booking and sent with the invitation.',
                )
              : tr(
                  'interviews.no_calendar_is_connected_for_these',
                  'No calendar is connected for these interviewers: connect one under Settings, Integrations, or paste a link.',
                )}
          </FieldDescription>
        ) : null}
      </Field>
      {where === 'link' ? (
        <Field required>
          <FieldLabel>{tr('interviews.video_link', 'Video link')}</FieldLabel>
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
          <FieldLabel>{tr('interviews.address', 'Address')}</FieldLabel>
          <FieldControl>
            <Input
              value={place}
              onChange={(e) => {
                onPlace(e.target.value);
              }}
              placeholder={tr('interviews.berlin_office_3rd_floor', 'Berlin office, 3rd floor')}
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
    <Loaded load={props.load} what={tr('interviews.the_schedule', 'the schedule')}>
      {/* Another interview of the plan starts from its own agenda. */}
      {(data) => <ScheduleBody key={data.planKey ?? ''} data={data} props={props} />}
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
  const [agenda, setAgenda] = useState<{ html: string; text: string } | null>(data.agenda);
  // A drafted agenda replaces the editor's content: the editor is drawn again around it.
  const [drawn, setDrawn] = useState(0);
  const [fromAsk, setFromAsk] = useState<{ askId: string; time: string } | null>(null);
  const applicationId = props.params?.['id'] ?? '';
  const plan = data.plan.find((p) => p.key === data.planKey);
  const today = DAY_KEY(data.from);
  const nameOf = (id: string): string =>
    data.members.find((m) => m.personId === id)?.name ??
    data.names[id] ??
    tr('interviews.someone', 'Someone');
  const back = () =>
    props.onNavigate?.(
      `/recruiting/candidates/${data.candidate.id}?application=${applicationId}&tab=process`,
    );
  const panelReady = data.interviewers.length > 0;
  const whereInput = {
    place: where === 'place' && place !== '' ? place : null,
    videoUrl: where === 'link' && video !== '' ? video : null,
    agenda,
    interviewerIds: data.interviewers,
  };
  const whereReady =
    panelReady &&
    (where === 'meet' || (where === 'link' && video !== '') || (where === 'place' && place !== ''));
  const offered = data.asks.filter((a) => a.kind === 'availability' && a.state === 'open');
  const unavailable = Object.fromEntries(data.holidays.map((h) => [h.date, h.name]));
  const draft = () => {
    act.run('DraftAgenda', { applicationId, input: { planKey: data.planKey } }, (done) => {
      setAgenda(done as { html: string; text: string });
      setDrawn((n) => n + 1);
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          plan === undefined
            ? tr('interviews.schedule_an_interview', 'Schedule an interview')
            : tr('interviews.schedule', 'Schedule: {{title}}', { title: plan.title })
        }
        description={tr('interviews.text_3', '{{name}} · {{title}}', {
          name: data.candidate.name,
          title: data.job.title,
        })}
      />
      <Refusal error={act.error} />
      {data.plan.length === 0 ? (
        <EmptyState
          icon={<icons.meeting aria-hidden />}
          title={tr('interviews.no_interview_plan', 'No interview plan')}
          description={tr(
            'interviews.add_the_interviews_to_the_jobs',
            'Add the interviews to the job’s plan first.',
          )}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {offered.map((a) => (
              <Card key={a.id}>
                <CardHeader>
                  <CardTitle level={2}>
                    {tr(
                      'interviews.offered_time',
                      {
                        one: '{{name}} offered {{count}} time',
                        other: '{{name}} offered {{count}} times',
                      },
                      { count: a.times.length, name: data.candidate.name },
                    )}
                  </CardTitle>
                  <CardDescription>
                    {a.agenda === null
                      ? tr(
                          'interviews.pick_one_and_book_it_the',
                          'Pick one and book it: the invitation goes with {{value}}. None works? Ask for more and these are left out.',
                          {
                            value:
                              a.videoUrl ??
                              a.place ??
                              tr('interviews.a_google_meet_link', 'a Google Meet link'),
                          },
                        )
                      : tr(
                          'interviews.pick_one_and_book_it_with_agenda',
                          'Pick one and book it: the invitation goes with {{value}} and the agenda you wrote. None works? Ask for more and these are left out.',
                          {
                            value:
                              a.videoUrl ??
                              a.place ??
                              tr('interviews.a_google_meet_link', 'a Google Meet link'),
                          },
                        )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <SlotPicker
                    label={tr(
                      'interviews.times_the_candidate_offered',
                      'Times the candidate offered',
                    )}
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
                        // Where, the agenda and the interviewers are the ones chosen when the link was sent.
                        act.run(
                          'BookFromAsk',
                          { applicationId, askId: a.id, input: { startsAt: fromAsk.time } },
                          back,
                        );
                      }}
                    >
                      {tr(
                        'interviews.book_this_time_and_send_the',
                        'Book this time and send the invitation',
                      )}
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
                      {tr(
                        'interviews.none_works_ask_for_more_times',
                        'None works: ask for more times',
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        // The team's own times replace theirs once sent; choose them in the planner below.
                        setHow('offer');
                        setPicked([]);
                        document
                          .getElementById('interview-planner')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      {tr('interviews.offer_other_times_instead', 'Offer other times instead')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader>
                <CardTitle level={2}>{tr('interviews.the_interview_2', 'The interview')}</CardTitle>
                <CardDescription>
                  {tr(
                    'interviews.which_interview_of_the_plan_and',
                    'Which interview of the plan, and who runs it. Everyone chosen is invited, and only times free for all of them, and for you, are offered.',
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {data.plan.length > 1 ? (
                  <RadioGroup
                    aria-label={tr('interviews.interview', 'Interview')}
                    className="grid gap-2 sm:grid-cols-2"
                    value={data.planKey ?? ''}
                    onValueChange={(v) => props.onFilter?.({ plan: v, with: null })}
                  >
                    {data.plan.map((p) => (
                      <RadioCard
                        key={p.key}
                        value={p.key}
                        description={
                          p.competencies.length === 0
                            ? tr('interviews.min', '{{minutes}} min', { minutes: p.minutes })
                            : tr(
                                'interviews.min_to_assess',
                                {
                                  one: '{{minutes}} min · {{count}} to assess',
                                  other: '{{minutes}} min · {{count}} to assess',
                                },
                                { minutes: p.minutes, count: p.competencies.length },
                              )
                        }
                      >
                        {p.title}
                      </RadioCard>
                    ))}
                  </RadioGroup>
                ) : plan === undefined ? null : (
                  <KeyValues
                    items={[
                      { label: tr('interviews.interview', 'Interview'), value: plan.title },
                      {
                        label: tr('interviews.length', 'Length'),
                        value: `${String(plan.minutes)} min`,
                      },
                    ]}
                  />
                )}
                <Field required>
                  <FieldLabel>{tr('interviews.interviewers', 'Interviewers')}</FieldLabel>
                  <FieldDescription>
                    {plan !== undefined && plan.interviewerIds.length > 0
                      ? tr(
                          'interviews.from_the_jobs_plan_change_them',
                          'From the job’s plan. Change them for this interview only.',
                        )
                      : tr(
                          'interviews.the_jobs_hiring_team_to_start',
                          'The job’s hiring team to start. Change them for this interview.',
                        )}
                  </FieldDescription>
                  <FieldControl>
                    <Combobox
                      label={tr('interviews.interviewers', 'Interviewers')}
                      multiple
                      chips
                      placeholder={tr('interviews.choose_who_runs_it', 'Choose who runs it')}
                      searchPlaceholder={tr('interviews.search_people', 'Search people')}
                      options={data.members.map((m) => ({ value: m.personId, label: m.name }))}
                      value={data.interviewers}
                      onChange={(v) => {
                        const ids = typeof v === 'string' || v === null ? [] : v;
                        setPicked([]);
                        props.onFilter?.({ with: ids.length === 0 ? null : ids.join(',') });
                      }}
                    />
                  </FieldControl>
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle level={2}>
                  {how === 'link'
                    ? tr('interviews.the_candidate_picks', 'The candidate picks')
                    : tr('interviews.pick_a_day_then_a_time', 'Pick a day, then a time')}
                </CardTitle>
                <CardDescription>
                  {panelReady
                    ? tr(
                        'interviews.free_for_you_a_struck_day',
                        'Free for you, {{join}}. A struck day has nothing free: a weekend, a holiday, someone away, or the hours over.',
                        { join: data.interviewers.map(nameOf).join(', ') },
                      )
                    : tr(
                        'interviews.choose_who_runs_the_interview_to',
                        'Choose who runs the interview to see the times that suit them.',
                      )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {!panelReady ? (
                  <EmptyState
                    icon={<icons.people aria-hidden />}
                    title={tr('interviews.no_interviewers_yet', 'No interviewers yet')}
                    description={tr('interviews.choose_them_above', 'Choose them above.')}
                  />
                ) : how === 'link' ? (
                  <p className="text-sm text-fg-muted">
                    {tr(
                      'interviews.gets_a_link_to_the_same',
                      '{{name}} gets a link to the same free times, in their own time zone, holidays and days away left out, and gives ten. You book one from here.',
                      { name: data.candidate.name },
                    )}
                  </p>
                ) : (
                  <SlotPicker
                    label={tr('interviews.interview_times', 'Interview times')}
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
            <Card>
              <CardContent className="pt-5">
                <AgendaEditor
                  key={drawn}
                  value={agenda}
                  onChange={setAgenda}
                  onDraft={draft}
                  drafting={act.pending}
                />
              </CardContent>
            </Card>
            {data.asks.length === 0 && data.booked.length === 0 ? null : (
              <Card>
                <CardHeader>
                  <CardTitle level={2}>
                    {tr('interviews.with_the_candidate', 'With the candidate')}
                  </CardTitle>
                  <CardDescription>
                    {tr(
                      'interviews.what_is_booked_offered_or_asked',
                      'What is booked, offered or asked, newest first.',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.booked.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge size="sm" tone="accent">
                        {tr('interviews.booked', 'Booked')}
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
          <Card id="interview-planner" className="scroll-mt-4 lg:sticky lg:top-4">
            <CardHeader>
              <CardTitle level={2}>{tr('interviews.how_to_book', 'How to book')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RadioGroup
                aria-label={tr('interviews.how_to_book', 'How to book')}
                value={how}
                onValueChange={(v) => {
                  setHow(v as typeof how);
                  setPicked([]);
                }}
              >
                <RadioCard
                  value="book"
                  description={tr(
                    'interviews.one_time_booked_now_the_invitation',
                    'One time, booked now. The invitation goes at once.',
                  )}
                >
                  {tr('interviews.book_a_time', 'Book a time')}
                </RadioCard>
                <RadioCard
                  value="offer"
                  description={tr(
                    'interviews.several_times_picks_one_or_asks',
                    'Several times; {{name}} picks one or asks for others.',
                    { name: data.candidate.name },
                  )}
                >
                  {tr('interviews.offer_times_to_choose_from', 'Offer times to choose from')}
                </RadioCard>
                <RadioCard
                  value="link"
                  description={tr(
                    'interviews.gives_ten_times_that_fit_everyone',
                    '{{name}} gives ten times that fit everyone; you book one.',
                    { name: data.candidate.name },
                  )}
                >
                  {tr('interviews.ask_for_their_availability', 'Ask for their availability')}
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
                  <FieldLabel>
                    {tr(
                      'interviews.a_line_for_the_candidate_optional',
                      'A line for the candidate (optional)',
                    )}
                  </FieldLabel>
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
              {panelReady ? (
                <KeyValues
                  items={[
                    {
                      label: tr('interviews.invited', 'Invited'),
                      value: formatList([data.candidate.name, ...data.interviewers.map(nameOf)]),
                    },
                    ...(how === 'link' || picked.length === 0
                      ? []
                      : [
                          {
                            label:
                              picked.length === 1
                                ? tr('interviews.when', 'When')
                                : tr('interviews.times', 'Times'),
                            value:
                              picked.length === 1
                                ? when(picked[0] ?? '')
                                : tr(
                                    'interviews.count_offered',
                                    { one: '{{count}} offered', other: '{{count}} offered' },
                                    { count: picked.length },
                                  ),
                          },
                        ]),
                  ]}
                />
              ) : null}
              {how === 'book' ? (
                <Button
                  disabled={picked.length === 0 || data.planKey === null || !whereReady}
                  loading={act.pending}
                  startIcon={<icons.send aria-hidden />}
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
                  {tr('interviews.book_and_send_the_invitation', 'Book and send the invitation')}
                </Button>
              ) : how === 'offer' ? (
                <Button
                  disabled={picked.length === 0 || data.planKey === null || !whereReady}
                  loading={act.pending}
                  startIcon={<icons.send aria-hidden />}
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
                  {tr(
                    'interviews.send_to_the_candidate',
                    {
                      one: 'Send this time to the candidate',
                      other: 'Send {{count}} times to the candidate',
                    },
                    { count: picked.length },
                  )}
                </Button>
              ) : (
                <Button
                  disabled={data.planKey === null || !whereReady}
                  loading={act.pending}
                  startIcon={<icons.send aria-hidden />}
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
                  {tr('interviews.send_the_link', 'Send the link')}
                </Button>
              )}
              <p className="text-xs text-fg-muted">
                {tr(
                  'interviews.the_email_goes_the_moment_you',
                  'The email goes the moment you press. Without a calendar, the invitation carries an .ics file.',
                )}
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
    <Loaded load={props.load} what={tr('interviews.the_debrief', 'the debrief')}>
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
    tone: 'positive' | 'mixed' | 'negative';
    direction: string;
    suggestion: 'proceed' | 'reject' | 'more_evidence';
    why: string;
  } | null>(null);
  const applicationId = props.params?.['id'] ?? '';
  const people = [...new Set(data.rows.flatMap((r) => r.ratings.map((x) => x.interviewerId)))];
  const name = (key: string) => data.competencies.find((c) => c.key === key)?.name ?? words(key);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={tr('interviews.debrief', 'Debrief: {{name}}', { name: data.candidate.name })}
        description={tr(
          'interviews.averages_and_disagreements_computed_by_kithena',
          '{{title}} · averages and disagreements computed by Kithena',
          { title: data.job.title },
        )}
      />
      <Refusal error={act.error} />
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('interviews.summary', 'Summary')}</CardTitle>
          <CardDescription>
            {tr(
              'interviews.written_by_a_model_from_the',
              'Written by a model from the scorecards; every line names the scorecards it came from. Its suggestion is only that: the decision is yours.',
            )}
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
              {tr('interviews.summarise_the_scorecards', 'Summarise the scorecards')}
            </Button>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      summary.suggestion === 'proceed'
                        ? 'success'
                        : summary.suggestion === 'reject'
                          ? 'danger'
                          : 'warning'
                    }
                    variant="solid"
                  >
                    {summary.suggestion === 'proceed'
                      ? tr('interviews.suggests_proceed', 'Suggests: proceed')
                      : summary.suggestion === 'reject'
                        ? tr('interviews.suggests_reject', 'Suggests: reject')
                        : tr(
                            'interviews.suggests_gather_more_evidence',
                            'Suggests: gather more evidence',
                          )}
                  </Badge>
                  <Badge
                    tone={
                      summary.tone === 'positive'
                        ? 'success'
                        : summary.tone === 'negative'
                          ? 'danger'
                          : 'neutral'
                    }
                    variant="soft"
                  >
                    {tr('interviews.tone', 'Tone: {{tone}}', { tone: summary.tone })}
                  </Badge>
                </div>
                {summary.direction === '' ? null : (
                  <p className="text-sm font-medium">{summary.direction}</p>
                )}
                {summary.why === '' ? null : <p className="text-sm text-fg-muted">{summary.why}</p>}
              </div>
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
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('interviews.scorecards_side_by_side', 'Scorecards side by side')}
            </CardTitle>
            <CardDescription>
              {tr('interviews.of_submitted', '{{submitted}} of {{expected}} submitted', {
                submitted: String(data.submitted),
                expected: String(data.expected),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('interviews.competency', 'Competency')}</TableHead>
                  {people.map((p) => (
                    <TableHead key={p}>{data.names[p] ?? p}</TableHead>
                  ))}
                  <TableHead>{tr('interviews.average', 'Average')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{tr('interviews.disagreement', 'Disagreement')}</span>
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
                          {tr('interviews.disagree_by_2', 'Disagree by 2+')}
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex flex-wrap gap-2">
              {RECOMMENDATIONS.filter((k) => data.recommendations[k] > 0).map((k) => (
                <Badge key={k} tone={k === 'yes' || k === 'strong_yes' ? 'success' : 'danger'}>
                  {tr('interviews.text_4', '{{k}} × {{recommendations}}', {
                    k: words(k),
                    recommendations: String(data.recommendations[k]),
                  })}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('interviews.decision', 'Decision')}</CardTitle>
            <CardDescription>
              {tr(
                'interviews.the_jobs_recruiter_or_hiring_manager',
                'The job’s recruiter or hiring manager decides, with a reason',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SegmentedControl
              aria-label={tr('interviews.decision', 'Decision')}
              value={decision}
              onValueChange={(v) => {
                setDecision(v as typeof decision);
              }}
              disabled={!data.decider}
              className="w-full"
            >
              <SegmentedControlItem value="advance">
                {tr('interviews.advance', 'Advance')}
              </SegmentedControlItem>
              <SegmentedControlItem value="reject">
                {tr('interviews.reject', 'Reject')}
              </SegmentedControlItem>
              <SegmentedControlItem value="offer">
                {tr('interviews.make_an_offer', 'Make an offer')}
              </SegmentedControlItem>
            </SegmentedControl>
            <Field required>
              <FieldLabel>{tr('interviews.reason', 'Reason')}</FieldLabel>
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
              {tr('interviews.record_decision', 'Record decision')}
            </Button>
            {data.decider ? null : (
              <p className="text-xs text-fg-muted">
                {tr(
                  'interviews.only_the_jobs_recruiter_or_hiring',
                  'Only the job’s recruiter or hiring manager records the decision.',
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
