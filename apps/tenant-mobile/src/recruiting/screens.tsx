import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Stat,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Briefcase, CalendarClock, ClipboardPen, FileText, Stamp } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askRecruiting, useRecruiting, when, words } from './api';

/**
 * Recruiting on the phone (REC-145, design RM0b–RM7): for a hiring manager
 * and an interviewer. Everything here is a read model the web's screens
 * use too, and every write the web's own; the ad editor, the apply form
 * builder and the terms composer stay on the web (`desktop-only` RM8).
 */

interface Home {
  readonly tasks: readonly { kind: string; id: string; title: string; due: string | null }[];
  readonly jobs: readonly {
    id: string;
    title: string;
    state: string;
    counts: { total: number; newThisWeek: number };
  }[];
}

export function RecruitingHome({ navigation }: PeopleScreen<'Recruiting'>): React.JSX.Element {
  const { load, reload } = useRecruiting<Home>('RecruitingHome');
  const back = { label: 'More', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title="Recruiting" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading Recruiting" />
        )}
      </Page>
    );
  const d = load.data;
  const open = d.jobs.filter((j) => j.state === 'open');
  return (
    <Page title="Recruiting" back={back}>
      <Heading title="Needs you" />
      <List>
        <ListItem icon={Stamp} chevron onPress={() => { navigation.navigate('RecruitingApprovals'); }}>
          Approvals
        </ListItem>
        <ListItem
          icon={CalendarClock}
          chevron
          onPress={() => { navigation.navigate('RecruitingInterviews'); }}
        >
          My interviews and scorecards
        </ListItem>
        <ListItem icon={Briefcase} chevron onPress={() => { navigation.navigate('RecruitingBoard'); }}>
          Open jobs: refer someone
        </ListItem>
      </List>
      {open.length === 0 ? null : (
        <>
          <Heading title="My jobs" />
          <List>
            {open.map((j) => (
              <ListItem
                key={j.id}
                icon={Briefcase}
                chevron
                description={`${String(j.counts.total)} candidates · ${String(j.counts.newThisWeek)} new`}
                onPress={() => { navigation.navigate('RecruitingPipeline', { jobId: j.id, title: j.title }); }
                }
              >
                {j.title}
              </ListItem>
            ))}
          </List>
        </>
      )}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Stat label="Open jobs" value={String(open.length)} />
        </View>
        <View className="flex-1">
          <Stat label="To do" value={String(d.tasks.length)} />
        </View>
      </View>
      <Button onPress={() => { navigation.navigate('RecruitingAnalytics'); }}>Analytics</Button>
    </Page>
  );
}

interface Interviews {
  readonly upcoming: readonly {
    id: string;
    title: string;
    startsAt: string;
    minutes: number;
    candidate: string;
    job: string;
  }[];
  readonly owed: readonly { id: string; title: string; startsAt: string; candidate: string }[];
}

export function RecruitingInterviews({
  navigation,
}: PeopleScreen<'RecruitingInterviews'>): React.JSX.Element {
  const { load, reload } = useRecruiting<Interviews>('RecruitingInterviews');
  const [tab, setTab] = useState<'upcoming' | 'owed'>('upcoming');
  const back = { label: 'Recruiting', onPress: navigation.goBack };
  return (
    <Page title="My interviews" back={back}>
      <SegmentedControl
        fullWidth
        value={tab}
        accessibilityLabel="Which interviews"
        onValueChange={(v) => { setTab(v === 'owed' ? 'owed' : 'upcoming'); }}
      >
        <SegmentedControlItem value="upcoming">Upcoming</SegmentedControlItem>
        <SegmentedControlItem value="owed">Scorecards owed</SegmentedControlItem>
      </SegmentedControl>
      {load.status !== 'ready' ? (
        load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading your interviews" />
        )
      ) : (tab === 'upcoming' ? load.data.upcoming : load.data.owed).length === 0 ? (
        <Text tone="muted">Nothing here.</Text>
      ) : (
        <List>
          {(tab === 'upcoming' ? load.data.upcoming : load.data.owed).map((i) => (
            <ListItem
              key={i.id}
              icon={tab === 'owed' ? ClipboardPen : CalendarClock}
              chevron
              description={`${i.title} · ${when(i.startsAt)}`}
              onPress={() => { navigation.navigate('RecruitingKit', { interviewId: i.id }); }}
            >
              {i.candidate}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}

interface Pipeline {
  readonly stages: readonly { id: string; name: string }[];
  readonly cards: readonly {
    candidateId: string;
    name: string;
    stageId: string;
    outcome: string;
    daysInStage: number;
    unread: number;
  }[];
}

export function RecruitingPipeline({
  navigation,
  route,
}: PeopleScreen<'RecruitingPipeline'>): React.JSX.Element {
  const { load, reload } = useRecruiting<Pipeline>('RecruitingPipeline', {
    jobId: route.params.jobId,
  });
  const back = { label: 'Recruiting', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title={route.params.title} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the pipeline" />
        )}
      </Page>
    );
  const active = load.data.cards.filter((c) => c.outcome === 'active');
  return (
    <Page title={route.params.title} back={back}>
      {load.data.stages.map((s) => {
        const here = active.filter((c) => c.stageId === s.id);
        if (here.length === 0) return null;
        return (
          <View key={s.id} className="gap-2">
            <Heading title={`${s.name} · ${String(here.length)}`} />
            <List>
              {here.map((c) => (
                <ListItem
                  key={c.candidateId}
                  chevron
                  description={`${String(c.daysInStage)} d in stage`}
                  trailing={
                    c.unread > 0 ? (
                      <Badge size="sm" tone="accent">
                        {String(c.unread)}
                      </Badge>
                    ) : undefined
                  }
                  onPress={() => { navigation.navigate('RecruitingCandidate', {
                      candidateId: c.candidateId,
                      name: c.name,
                    }); }
                  }
                >
                  {c.name}
                </ListItem>
              ))}
            </List>
          </View>
        );
      })}
    </Page>
  );
}

interface Candidate {
  readonly candidate: { id: string; name: string; email?: string };
  readonly applications: readonly {
    applicationId: string;
    job: { title: string };
    stageId: string;
    stages: readonly { id: string; name: string }[];
    outcome: string;
    source: string;
    scorecards: readonly {
      interviewerId: string;
      recommendation: string | null;
      submittedAt: string | null;
    }[];
    may: readonly string[];
  }[];
}

export function RecruitingCandidate({
  navigation,
  route,
}: PeopleScreen<'RecruitingCandidate'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useRecruiting<Candidate>('RecruitingCandidate', {
    candidateId: route.params.candidateId,
  });
  const [rejecting, setRejecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { label: 'Pipeline', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the candidate" />
        )}
      </Page>
    );
  const a = load.data.applications.find((x) => x.outcome === 'active') ?? load.data.applications[0];
  const at = a === undefined ? -1 : a.stages.findIndex((s) => s.id === a.stageId);
  const next = a?.stages[at + 1];
  const act = (operation: string, variables: Record<string, unknown>): void => {
    setBusy(true);
    void askRecruiting(signed, operation, variables).then((r) => {
      setBusy(false);
      setRejecting(false);
      if (r.ok) reload();
      else setProblem(r.message);
    });
  };
  const moving = a !== undefined && a.outcome === 'active' && a.may.includes('pipeline.move');
  return (
    <Page
      title={load.data.candidate.name}
      back={back}
      {...(moving
        ? {
            foot: (
              <View className="flex-row gap-3">
                <Button className="flex-1" onPress={() => { setRejecting(true); }}>
                  Reject
                </Button>
                {next === undefined ? null : (
                  <Button
                    className="flex-1"
                    variant="primary"
                    loading={busy}
                    onPress={() => { act('MoveApplication', {
                        applicationId: a.applicationId,
                        input: { to: next.id },
                      }); }
                    }
                  >
                    {`Advance to ${next.name}`}
                  </Button>
                )}
              </View>
            ),
          }
        : {})}
    >
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      {a === undefined ? (
        <Text tone="muted">No applications.</Text>
      ) : (
        <>
          <List>
            <ListItem description={a.job.title}>
              {a.outcome === 'active' ? (a.stages[at]?.name ?? '') : words(a.outcome)}
            </ListItem>
            <ListItem description="Source">{words(a.source)}</ListItem>
            {load.data.candidate.email === undefined ? null : (
              <ListItem description="Email">{load.data.candidate.email}</ListItem>
            )}
          </List>
          <Heading title="Scorecards" />
          {a.scorecards.length === 0 ? (
            <Text tone="muted">
              None yet. An interviewer sees the others only after submitting their own.
            </Text>
          ) : (
            <List>
              {a.scorecards.map((s) => (
                <ListItem
                  key={s.interviewerId}
                  description={s.submittedAt === null ? 'Not submitted' : 'Submitted'}
                >
                  {s.recommendation === null ? '—' : words(s.recommendation)}
                </ListItem>
              ))}
            </List>
          )}
        </>
      )}
      {rejecting && a !== undefined ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setRejecting(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`Reject ${load.data.candidate.name}?`}</DialogTitle>
              <DialogDescription>
                {a.job.title}. The email goes later today, never at night.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button className="flex-1" onPress={() => { setRejecting(false); }}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="danger"
                loading={busy}
                onPress={() => { act('RejectApplication', {
                    applicationId: a.applicationId,
                    input: {
                      reasonKey: 'better_candidate',
                      templateId: null,
                      send: 'later_today',
                      poolId: null,
                    },
                  }); }
                }
              >
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Page>
  );
}

interface Kit {
  readonly interview: {
    id: string;
    title: string;
    startsAt: string;
    videoUrl: string | null;
    state: string;
  };
  readonly competencies: readonly {
    key: string;
    name: string;
    description: string;
    questions: readonly string[];
  }[];
  readonly scorecards: readonly {
    interviewerId: string;
    ratings: Readonly<Record<string, number>>;
    recommendation: string | null;
    submittedAt: string | null;
  }[];
  readonly candidate: { name: string };
  readonly me: string;
}

const ANCHORS = ['Strong no', 'No', 'Yes', 'Strong yes'] as const;
const RECOMMENDATIONS = ['strong_no', 'no', 'yes', 'strong_yes'] as const;

export function RecruitingKit({
  navigation,
  route,
}: PeopleScreen<'RecruitingKit'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useRecruiting<Kit>('RecruitingKit', {
    interviewId: route.params.interviewId,
  });
  const [step, setStep] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { label: 'My interviews', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title="Scorecard" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the kit" />
        )}
      </Page>
    );
  const k = load.data;
  const mine = k.scorecards.find((c) => c.interviewerId === k.me);
  if (mine?.submittedAt != null)
    return (
      <Page title={k.candidate.name} back={back}>
        <Alert tone="success">Your scorecard is in.</Alert>
      </Page>
    );
  const last = step >= k.competencies.length;
  const c = k.competencies[step];
  const scale = (value: number | null, set: (n: number) => void, label: string) => (
    <SegmentedControl
      fullWidth
      size="sm"
      value={value === null ? '' : String(value)}
      accessibilityLabel={label}
      onValueChange={(v) => { set(Number(v)); }}
    >
      {ANCHORS.map((a, i) => (
        <SegmentedControlItem
          key={a}
          value={String(i + 1)}
        >{`${String(i + 1)} ${a}`}</SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
  const submit = (): void => {
    setBusy(true);
    void askRecruiting(signed, 'SaveScorecard', {
      interviewId: k.interview.id,
      input: { ratings, recommendation, notes: notes === '' ? null : notes, submit: true },
    }).then((r) => {
      setBusy(false);
      if (r.ok) reload();
      else setProblem(r.message);
    });
  };
  return (
    <Page
      title={k.candidate.name}
      back={back}
      foot={
        <View className="flex-row gap-3">
          <Button className="flex-1" disabled={step === 0} onPress={() => { setStep(step - 1); }}>
            Back
          </Button>
          {last ? (
            <Button
              className="flex-1"
              variant="primary"
              loading={busy}
              disabled={recommendation === null}
              onPress={submit}
            >
              Submit
            </Button>
          ) : (
            <Button
              className="flex-1"
              variant="primary"
              disabled={c !== undefined && ratings[c.key] === undefined}
              onPress={() => { setStep(step + 1); }}
            >
              Next
            </Button>
          )}
        </View>
      }
    >
      <Text tone="muted">{`${k.interview.title} · ${when(k.interview.startsAt)}`}</Text>
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      {last || c === undefined ? (
        <>
          <Text variant="title3">Overall recommendation</Text>
          {scale(
            recommendation === null
              ? null
              : RECOMMENDATIONS.indexOf(recommendation as (typeof RECOMMENDATIONS)[number]) + 1,
            (n) => { setRecommendation(RECOMMENDATIONS[n - 1] ?? null); },
            'Overall recommendation',
          )}
          <Field>
            <FieldLabel>Notes</FieldLabel>
            <Textarea value={notes} onChangeText={setNotes} />
          </Field>
          <Text tone="muted">Others’ scorecards appear after you submit.</Text>
        </>
      ) : (
        <>
          <Text variant="title3">{c.name}</Text>
          {c.description === '' ? null : <Text tone="muted">{c.description}</Text>}
          {c.questions.map((q) => (
            <Text key={q}>{q}</Text>
          ))}
          {scale(ratings[c.key] ?? null, (n) => { setRatings({ ...ratings, [c.key]: n }); }, c.name)}
        </>
      )}
    </Page>
  );
}

interface Offers {
  readonly rows: readonly { id: string; candidate: string; job: string; needsMe: boolean }[];
}
interface Requisition {
  readonly id: string;
  readonly title: string;
  readonly openings: number;
  readonly approval?: { mine: boolean } | null;
}

export function RecruitingApprovals({
  navigation,
}: PeopleScreen<'RecruitingApprovals'>): React.JSX.Element {
  const signed = useSigned();
  const offers = useRecruiting<Offers>('RecruitingOffers');
  const reqs = useRecruiting<readonly Requisition[]>('RecruitingRequisitions');
  const [deciding, setDeciding] = useState<{
    kind: 'offer' | 'requisition';
    id: string;
    title: string;
  } | null>(null);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const back = { label: 'Recruiting', onPress: navigation.goBack };
  const decide = (decision: 'approved' | 'rejected'): void => {
    if (deciding === null) return;
    const operation = deciding.kind === 'offer' ? 'DecideOffer' : 'DecideRequisition';
    const vars =
      deciding.kind === 'offer' ? { offerId: deciding.id } : { requisitionId: deciding.id };
    void askRecruiting(signed, operation, {
      ...vars,
      input: { decision, comment: comment === '' ? null : comment },
    }).then((r) => {
      setDeciding(null);
      setComment('');
      if (r.ok) {
        offers.reload();
        reqs.reload();
      } else setProblem(r.message);
    });
  };
  const pendingOffers =
    offers.load.status === 'ready' ? offers.load.data.rows.filter((r) => r.needsMe) : [];
  const pendingReqs =
    reqs.load.status === 'ready' ? reqs.load.data.filter((r) => r.approval?.mine === true) : [];
  return (
    <Page title="Approvals" back={back}>
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      {offers.load.status === 'loading' || reqs.load.status === 'loading' ? (
        <Loading label="Loading approvals" />
      ) : null}
      {pendingOffers.length + pendingReqs.length === 0 &&
      offers.load.status === 'ready' &&
      reqs.load.status === 'ready' ? (
        <Text tone="muted">Nothing waits on you.</Text>
      ) : null}
      <List>
        {pendingOffers.map((o) => (
          <ListItem
            key={o.id}
            icon={FileText}
            chevron
            description={o.job}
            onPress={() => { setDeciding({ kind: 'offer', id: o.id, title: `Offer: ${o.candidate}` }); }}
          >
            {`Offer: ${o.candidate}`}
          </ListItem>
        ))}
        {pendingReqs.map((r) => (
          <ListItem
            key={r.id}
            icon={Briefcase}
            chevron
            description={`${String(r.openings)} openings`}
            onPress={() => { setDeciding({ kind: 'requisition', id: r.id, title: `Requisition: ${r.title}` }); }
            }
          >
            {`Requisition: ${r.title}`}
          </ListItem>
        ))}
      </List>
      {deciding === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setDeciding(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{deciding.title}</DialogTitle>
              <DialogDescription>
                Its checks are on the web’s approval page; a comment is required to reject.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field>
                <FieldLabel>Comment</FieldLabel>
                <Textarea value={comment} onChangeText={setComment} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                disabled={comment.trim() === ''}
                onPress={() => { decide('rejected'); }}
              >
                Reject
              </Button>
              <Button className="flex-1" variant="primary" onPress={() => { decide('approved'); }}>
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}

interface Board {
  readonly jobs: readonly {
    id: string;
    title: string;
    department: string | null;
    workMode: string;
  }[];
}

export function RecruitingBoard({
  navigation,
}: PeopleScreen<'RecruitingBoard'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useRecruiting<Board>('RecruitingBoard');
  const [job, setJob] = useState<{ id: string; title: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const back = { label: 'Recruiting', onPress: navigation.goBack };
  if (job !== null)
    return (
      <Page
        title="Refer"
        back={{ label: 'Job board', onPress: () => { setJob(null); } }}
        foot={
          <Button
            variant="primary"
            disabled={name.trim() === '' || !email.includes('@')}
            onPress={() => {
              void askRecruiting(signed, 'Refer', {
                jobId: job.id,
                input: { name, email, note: note === '' ? null : note },
              }).then((r) => {
                setSaid(r.ok ? `${name} has an invitation to apply.` : r.message);
                if (r.ok) {
                  setJob(null);
                  setName('');
                  setEmail('');
                  setNote('');
                }
              });
            }}
          >
            Send referral
          </Button>
        }
      >
        <Text variant="title3">{job.title}</Text>
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input value={name} onChangeText={setName} />
        </Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </Field>
        <Field>
          <FieldLabel>Why they’d be good</FieldLabel>
          <Textarea value={note} onChangeText={setNote} />
        </Field>
        <Text tone="muted">
          They apply themselves, with their own consent. You’ll only hear whether they were hired.
        </Text>
      </Page>
    );
  return (
    <Page title="Job board" back={back}>
      {said === null ? null : <Alert tone="info">{said}</Alert>}
      {load.status !== 'ready' ? (
        load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading open jobs" />
        )
      ) : (
        <List>
          {load.data.jobs.map((j) => (
            <ListItem
              key={j.id}
              icon={Briefcase}
              chevron
              description={[j.department, words(j.workMode)].filter(Boolean).join(' · ')}
              onPress={() => { setJob({ id: j.id, title: j.title }); }}
            >
              {j.title}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}

interface Analytics {
  readonly overview: {
    openJobs: number;
    applications: number;
    hires: number;
    timeToHire: { median: number | null };
  };
  readonly offers: { rate: string | null };
}

export function RecruitingAnalytics({
  navigation,
}: PeopleScreen<'RecruitingAnalytics'>): React.JSX.Element {
  const { load, reload } = useRecruiting<Analytics>('RecruitingAnalytics', { period: 'this_year' });
  const back = { label: 'Recruiting', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title="Analytics" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading analytics" />
        )}
      </Page>
    );
  const o = load.data.overview;
  return (
    <Page title="Analytics" back={back}>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Stat label="Hires" value={String(o.hires)} />
        </View>
        <View className="flex-1">
          <Stat
            label="Time to hire"
            value={
              o.timeToHire.median === null ? '—' : `${String(Math.round(o.timeToHire.median))} d`
            }
          />
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Stat
            label="Offer acceptance"
            value={load.data.offers.rate === null ? '—' : `${load.data.offers.rate}%`}
          />
        </View>
        <View className="flex-1">
          <Stat label="Open jobs" value={String(o.openJobs)} />
        </View>
      </View>
      <Text tone="muted">Other dashboards and building a chart are on the web.</Text>
    </Page>
  );
}
