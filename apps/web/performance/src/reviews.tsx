import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  type DataColumn,
  DataTable,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  formatList,
  HorizontalBarChart,
  icons,
  Input,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  SearchField,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Slider,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TertiaryNav,
  Textarea,
  Tooltip,
} from '@reach/ui';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { CONFIDENCE } from './home';
import { FormView } from './form-view';
import { Loaded } from './load';
import {
  CycleBadge,
  KindBadge,
  Modal,
  Person,
  Refusal,
  ReviewBadge,
  To,
  day,
  download,
  kindLabel,
  score,
  time,
  useAct,
  when,
} from './shared';
import type {
  Answer,
  Answers,
  FormDefinition,
  ScaleOption,
  ScreenProps,
  Score,
  Suggestion,
} from './types';
import { t } from './i18n';

/**
 * Reviews (PRD §10, §13; design PF10–PF13, PF20, PF9b–c): what a person
 * writes and what is written about them.
 */

/* ---------------------------------------------------------- my reviews -- */

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly subjectId: string;
  readonly about: string;
  readonly aboutTitle: string;
  readonly cycle: string | null;
  readonly due: string;
  readonly state: string;
  readonly savedAt: string | null;
}

interface AboutCycle {
  readonly cycleId: string;
  readonly cycle: string;
  readonly state: string;
  readonly self: { readonly id: string; readonly state: string; readonly due: string } | null;
  readonly nominated: readonly string[];
  readonly nomination: string | null;
  readonly manager: {
    readonly id: string;
    readonly by: string;
    readonly released: string | null;
    readonly acknowledged: string | null;
    readonly comment: string | null;
    readonly writing: boolean;
  } | null;
  readonly score: {
    readonly display: string;
    readonly label: string;
    readonly final: boolean;
  } | null;
  readonly peers: { readonly count: number; readonly ids: readonly string[] } | null;
}

export interface MyReviewsData {
  readonly tab: string;
  readonly counts: { readonly toWrite: number; readonly written: number };
  readonly rows: readonly Row[];
  readonly nominations: readonly {
    readonly id: string;
    readonly kind: 'nominate' | 'approve';
    readonly cycle: string;
    readonly subject: string;
    readonly min: number;
    readonly max: number;
    readonly due: string | null;
  }[];
  readonly about: readonly AboutCycle[] | null;
}

type ReviewRow = Row;
const reviewId = (r: ReviewRow): string => r.id;
const reviewTitle = (r: ReviewRow): string => r.title;

/** PF2's list: what to write and what was written. Virtualised: a long cycle asks hundreds of one manager. */
function reviewColumns(
  onNavigate: ScreenProps<MyReviewsData>['onNavigate'],
): readonly DataColumn<ReviewRow>[] {
  return [
    {
      id: 'review',
      header: t('reviews.review', 'Review'),
      sortBy: (r) => r.title,
      cell: (r) => (
        <>
          <To href={`/performance/reviews/${r.id}`} onNavigate={onNavigate}>
            {r.title}
          </To>
          {r.savedAt === null ? null : (
            <span className="block text-xs text-fg-muted">
              {t('reviews.saved', 'Saved {{savedAt}}', { savedAt: when(r.savedAt) })}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'about',
      header: t('reviews.about', 'About'),
      sortBy: (r) => r.about,
      cell: (r) => <Person name={r.about} sub={r.aboutTitle} />,
    },
    {
      id: 'cycle',
      header: t('reviews.cycle', 'Cycle'),
      hideOnCard: true,
      sortBy: (r) => r.cycle ?? '',
      cell: (r) => <span className="text-sm text-fg-muted">{r.cycle ?? '—'}</span>,
    },
    {
      id: 'kind',
      header: t('reviews.kind', 'Kind'),
      sortBy: (r) => r.kind,
      cell: (r) => <KindBadge kind={r.kind} />,
    },
    { id: 'due', header: t('reviews.due', 'Due'), sortBy: (r) => r.due, cell: (r) => day(r.due) },
    {
      id: 'state',
      header: t('reviews.state', 'State'),
      cardTrailing: true,
      sortBy: (r) => r.state,
      cell: (r) => <ReviewBadge state={r.state} />,
    },
  ];
}

export function MyReviews(props: ScreenProps<MyReviewsData>): JSX.Element {
  return (
    <Loaded load={props.load} what={t('reviews.your_reviews', 'your reviews')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={t('reviews.my_reviews', 'My reviews')}
            description={t(
              'reviews.every_review_you_write_across_cycles',
              'Every review you write, across cycles, and what is written about you.',
            )}
          />
          {/* Peers to pick or approve are things to do, so they sit with the
              reviews to write rather than behind a tab of their own. */}
          {data.tab === 'write' && data.nominations.length > 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-2">
                <h2 className="font-semibold">
                  {t('reviews.peers_to_pick_or_approve', 'Peers to pick or approve')}
                </h2>
                <List>
                  {data.nominations.map((n) => (
                    <ListItem
                      key={n.id}
                      asChild
                      chevron
                      icon={n.kind === 'approve' ? <icons.approve /> : <icons.people />}
                      description={`${n.cycle}${n.due === null ? '' : ` · due ${day(n.due)}`}`}
                      trailing={
                        <Badge size="sm" tone={n.kind === 'approve' ? 'accent' : 'neutral'}>
                          {n.kind === 'approve'
                            ? t('reviews.to_review', 'To review')
                            : t('reviews.to_pick', 'To pick')}
                        </Badge>
                      }
                    >
                      <a href={`/performance/nominations/${n.id}`}>
                        {n.kind === 'nominate'
                          ? t(
                              'reviews.pick_to_peers_for',
                              'Pick {{min}} to {{max}} peers for {{subject}}',
                              { min: String(n.min), max: String(n.max), subject: n.subject },
                            )
                          : t('reviews.approve_s_peers', 'Approve {{subject}}’s peers', {
                              subject: n.subject,
                            })}
                      </a>
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          ) : null}
          {data.tab === 'about' ? (
            <AboutMe cycles={data.about ?? []} onNavigate={props.onNavigate} />
          ) : (
            <>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.review aria-hidden />}
                  title={
                    data.tab === 'written'
                      ? t('reviews.nothing_written_yet', 'Nothing written yet')
                      : t('reviews.no_reviews_to_write', 'No reviews to write')
                  }
                  description={t(
                    'reviews.when_a_cycle_asks_you_for',
                    'When a cycle asks you for a review, it shows here and in your Inbox.',
                  )}
                />
              ) : (
                <DataTable<ReviewRow>
                  label={t('reviews.reviews', 'Reviews')}
                  rows={data.rows}
                  rowId={reviewId}
                  describeRow={reviewTitle}
                  fill
                  columns={reviewColumns(props.onNavigate)}
                />
              )}
              {data.tab === 'write' ? (
                <Alert
                  tone="info"
                  title={t(
                    'reviews.upward_and_peer_reviews_are_confidential',
                    'Upward and peer reviews are confidential',
                  )}
                >
                  {t(
                    'reviews.your_manager_sees_upward_answers_only',
                    'Your manager sees upward answers only once enough of their reports have answered, and never your name. People you review as a peer see your answers without your name; their managers see it.',
                  )}
                </Alert>
              ) : null}
            </>
          )}
        </div>
      )}
    </Loaded>
  );
}

function AboutMe({
  cycles,
  onNavigate,
}: {
  readonly cycles: readonly AboutCycle[];
  readonly onNavigate?: ((to: string) => void) | undefined;
}): JSX.Element {
  if (cycles.length === 0)
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<icons.review aria-hidden />}
            title={t('reviews.nothing_about_you_yet', 'Nothing about you yet')}
            description={t(
              'reviews.reviews_about_you_appear_here_once',
              'Reviews about you appear here once they are released to you.',
            )}
          />
        </CardContent>
      </Card>
    );
  return (
    <div className="flex flex-col gap-4">
      {cycles.map((c) => (
        <Card key={c.cycleId}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle level={2}>{c.cycle}</CardTitle>
            {c.manager?.acknowledged ? (
              <Badge size="sm" tone="success">
                {t('reviews.acknowledged', 'Acknowledged')}
              </Badge>
            ) : (
              <CycleBadge state={c.state} />
            )}
          </CardHeader>
          <CardContent>
            <KeyValues
              layout="split"
              items={[
                ...(c.self === null
                  ? []
                  : [
                      {
                        label: t('reviews.your_self_review', 'Your self review'),
                        value: (
                          <span className="flex items-center gap-2">
                            <ReviewBadge state={c.self.state} />
                            <To href={`/performance/reviews/${c.self.id}`} onNavigate={onNavigate}>
                              {t('reviews.open', 'Open')}
                            </To>
                          </span>
                        ),
                      },
                    ]),
                ...(c.nominated.length === 0
                  ? []
                  : [
                      {
                        label: t('reviews.peers_you_nominated', 'Peers you nominated'),
                        value: `${c.nominated.join(', ')}${c.nomination === 'approved' ? ' · approved' : ''}`,
                      },
                    ]),
                ...(c.score === null
                  ? []
                  : [
                      {
                        label: t('reviews.performance_score', 'Performance score'),
                        value: `${c.score.display} · ${c.score.label}${c.score.final ? '' : ', before calibration'}`,
                      },
                    ]),
                ...(c.manager === null
                  ? []
                  : [
                      {
                        label: t('reviews.manager_review', 'Manager review'),
                        value:
                          c.manager.released === null ? (
                            c.manager.writing ? (
                              `${c.manager.by} is writing it`
                            ) : (
                              `Submitted by ${c.manager.by}, not released yet`
                            )
                          ) : (
                            <To
                              href={`/performance/released/${c.manager.id}`}
                              onNavigate={onNavigate}
                            >
                              {`Read ${c.manager.by}’s review`}
                            </To>
                          ),
                      },
                    ]),
                ...(c.peers === null
                  ? []
                  : [
                      {
                        label: t('reviews.peer_reviews', 'Peer reviews'),
                        value:
                          c.peers.count === 0 ? (
                            'Not enough responses to share confidentially'
                          ) : (
                            <To
                              href={`/performance/released/${c.peers.ids[0] ?? ''}`}
                              onNavigate={onNavigate}
                            >
                              {`${t('reviews.count_reviews', { one: '{{count}} review', other: '{{count}} reviews' }, { count: c.peers.count })}, names hidden`}
                            </To>
                          ),
                      },
                    ]),
                ...(c.manager?.comment
                  ? [
                      {
                        label: t('reviews.your_comment', 'Your comment'),
                        value: `“${c.manager.comment}”`,
                      },
                    ]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- writing -- */

interface PanelReview {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly by: string;
  readonly at: string | null;
  readonly excerpt: string | null;
  readonly ratings: readonly {
    readonly question: string;
    readonly value: number | null;
    readonly label: string | null;
  }[];
}

export interface WriteData {
  readonly review: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly status: string;
    readonly revision: number;
    readonly savedAt: string | null;
    readonly due: string;
    readonly confidential: boolean;
    readonly subject: { readonly personId: string; readonly name: string; readonly title: string };
    readonly author: string;
    readonly cycle: {
      readonly id: string;
      readonly name: string;
      readonly names: string;
      readonly minimum: number;
    } | null;
    readonly handover: { readonly from: string; readonly note: string | null } | null;
    /** They stopped being the subject's manager while writing it (§8.8): `to` writes theirs. */
    readonly formerManager?: { readonly at: string; readonly to: string | null } | null;
    readonly detached: { readonly at: string; readonly keep: boolean | null } | null;
    readonly unlock: {
      readonly reason: string;
      readonly decided: { readonly approved: boolean } | null;
    } | null;
  };
  readonly form: FormDefinition;
  readonly answers: Answers;
  readonly suggestions: Readonly<Record<string, Suggestion>>;
  readonly drafted: readonly string[];
  readonly missing: readonly string[];
  readonly score: Score | null;
  readonly panel: {
    readonly goals: readonly {
      readonly id: string;
      readonly title: string;
      readonly progress: number;
      readonly confidence: string;
    }[];
    readonly reviews: readonly PanelReview[];
    readonly feedback: readonly {
      readonly id: string;
      readonly kind: string;
      readonly from: string;
      readonly at: string;
      readonly text: string;
    }[];
    readonly notes: readonly {
      readonly id: string;
      readonly title: string;
      readonly text: string;
      readonly at: string;
    }[];
    readonly earlier: readonly {
      readonly id: string;
      readonly cycle: string | null;
      readonly by: string;
      readonly score: number | null;
    }[];
  };
  readonly may: {
    readonly write: boolean;
    readonly unlock: boolean;
    readonly withdraw: boolean;
    readonly decline: boolean;
  };
  readonly ai: Readonly<Record<string, boolean>>;
  readonly scale?: readonly ScaleOption[];
}

type Saving =
  | { readonly state: 'saved'; readonly at: string | null; readonly revision: number }
  | { readonly state: 'saving' }
  | { readonly state: 'stale'; readonly message: string }
  | { readonly state: 'failed'; readonly message: string };

/** PF10: the form, autosaving, with the detail panel beside it. */
export function Write(props: ScreenProps<WriteData>): JSX.Element {
  return (
    <Loaded load={props.load} what={t('reviews.the_review', 'the review')}>
      {(data) => <Writing key={data.review.id} data={data} {...props} />}
    </Loaded>
  );
}

function Writing({
  data,
  ...props
}: ScreenProps<WriteData> & { readonly data: WriteData }): JSX.Element {
  const act = useAct(props);
  const [answers, setAnswers] = useState<Answers>(data.answers);
  const [saving, setSaving] = useState<Saving>({
    state: 'saved',
    at: data.review.savedAt,
    revision: data.review.revision,
  });
  const [currentScore, setScore] = useState<Score | null>(data.score);
  const [missing, setMissing] = useState(data.missing);
  const [dialog, setDialog] = useState<'submit' | 'unlock' | 'decline' | 'discard' | null>(null);
  // Closed until asked for: the form is the page, the context is a reference.
  const [panelOpen, setPanelOpen] = useState(props.search?.['panel'] === 'open');
  // The panel's AI help is the summary of what others said; how the draft
  // reads lives with the draft itself, under its answers and at submit.
  const aiHelp = data.ai['summaries'] === true;
  // AI help first where there is any: it fills itself, so it is the useful page.
  const [tab, setTab] = useState(aiHelp && props.search?.['tab'] !== 'context' ? 'ai' : 'context');
  const pending = useRef<Record<string, Answer>>({});
  const revision = useRef(data.review.revision);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subject = data.review.subject.name.split(' ')[0] ?? data.review.subject.name;

  const flush = async (): Promise<void> => {
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSaving({ state: 'saving' });
    const done = await act.call('SavePerformanceAnswers', {
      id: data.review.id,
      input: { revision: revision.current, answers: patch },
    });
    if (!done.ok) {
      pending.current = { ...patch, ...pending.current };
      setSaving(
        done.code === 'STALE_REVISION'
          ? { state: 'stale', message: done.message }
          : { state: 'failed', message: done.message },
      );
      return;
    }
    const saved = done.data as {
      revision: number;
      savedAt: string;
      missing: string[];
      score: Score | null;
    };
    revision.current = saved.revision;
    setScore(saved.score);
    setMissing(saved.missing);
    setSaving({ state: 'saved', at: saved.savedAt, revision: saved.revision });
  };
  // Saved 800 ms after the last change, and before the page goes away (§10.2).
  // Registered once: a cleanup that ran on every render cleared the timer each
  // keystroke had just set, so typing was saved only when something else
  // flushed it. Leaving the page saves what is pending rather than dropping it.
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  });
  useEffect(() => {
    const hide = (): void => {
      if (document.visibilityState === 'hidden') void latestFlush.current();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      clearTimeout(timer.current);
      void latestFlush.current();
    };
  }, []);
  // The server moved on without this form — a prefill, a confirmed
  // suggestion — and the page was read again: take its answers, with
  // anything typed here and not yet saved still on top.
  useEffect(() => {
    if (data.review.revision <= revision.current) return;
    revision.current = data.review.revision;
    setAnswers({ ...data.answers, ...pending.current });
    setScore(data.score);
    setMissing(data.missing);
    setSaving({ state: 'saved', at: data.review.savedAt, revision: data.review.revision });
  }, [data]);
  // Required questions with no answer, as form-kit counts them, worked out
  // here on every change: waiting for the save to say so left the Required
  // mark turning red, or back, a second after the typing.
  const requiredIds = data.form.sections
    .flatMap((s) => s.questions)
    .filter((q) => q.required && q.type !== 'performance_score')
    .map((q) => q.id);
  const change = (id: string, a: Answer): void => {
    setAnswers((prev) => {
      const next = { ...prev, [id]: a };
      setMissing(requiredIds.filter((q) => !answered(next[q])));
      return next;
    });
    pending.current = { ...pending.current, [id]: a };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 800);
  };
  // What was typed is saved first, so the server works from it and the
  // revision it answers with is the one this form goes on from.
  const ai = (name: string, after?: (d: unknown) => void): void => {
    void flush().then(() => {
      act.run(name, { id: data.review.id }, after);
    });
  };
  const [summary, setSummary] = useState<{
    sentences: { text: string; cites: string[] }[];
    sources: { id: string; label: string }[];
    dropped: number;
  } | null>(null);
  const [asking, setAsking] = useState({ summary: false });
  const [aiError, setAiError] = useState<string | null>(null);
  const writing = data.may.write;
  // No longer the subject's manager (§8.8): kept to read or delete, never submitted.
  const former = data.review.formerManager ?? null;
  const noLongerTheirs =
    former?.to == null
      ? t(
          'reviews.no_longer_manager_new_manager_writes',
          'You are no longer {{name}}’s manager, so this review cannot be submitted. Their new manager writes theirs.',
          { name: data.review.subject.name },
        )
      : t(
          'reviews.you_are_no_longer_s_manager',
          'You are no longer {{name}}’s manager, so this review cannot be submitted. {{value}} writes theirs.',
          { name: data.review.subject.name, value: former.to },
        );
  // The panel's summary fills itself once it is on screen, never on a button.
  const asked = useRef({ summary: false });
  const savedRevision = saving.state === 'saved' ? saving.revision : null;
  useEffect(() => {
    if (!panelOpen || tab !== 'ai') return;
    if (data.ai['summaries'] === true && !asked.current.summary) {
      asked.current.summary = true;
      setAsking({ summary: true });
      void act.call('SummarisePerformanceReview', { id: data.review.id }).then((d) => {
        setAsking({ summary: false });
        if (d.ok) setSummary(d.data as typeof summary);
        else setAiError(d.message);
      });
    }
  }, [panelOpen, tab]);

  /*
   * How it will read to the subject (§13.7), kept with the draft: read again a
   * few seconds after a save that changed its words, and at once on Retry or
   * at Submit if the words moved since. A flag sits under the answer its
   * sentence is in, with the change to make; only what is worth changing.
   */
  const checks = writing && data.ai['writingChecks'] === true;
  const [reads, setReads] = useState<Reads | null>(null);
  const [reading, setReading] = useState<'idle' | 'reading' | 'failed'>('idle');
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [notFound, setNotFound] = useState<string | null>(null);
  const readFor = useRef<string | null>(null);
  const textQuestions = data.form.sections
    .flatMap((x) => x.questions)
    .filter((q) => q.type === 'text');
  const wordsOf = (a: Answers): string =>
    textQuestions
      .map((q) => {
        const v = a[q.id]?.value;
        return typeof v === 'string' ? textOf(v) : '';
      })
      .join('\n')
      .trim();
  const readNow = (words: string): void => {
    readFor.current = words;
    setReading('reading');
    void flush()
      .then(() => act.call('PerformanceHowItReads', { id: data.review.id }))
      .then((d) => {
        if (d.ok) {
          setReads(d.data as Reads);
          setKept(new Set());
          setReading('idle');
        } else setReading('failed');
      });
  };
  useEffect(() => {
    if (!checks || savedRevision === null) return;
    const words = wordsOf(answers);
    if (words === '' || words === readFor.current) return;
    const later = setTimeout(
      () => {
        readNow(words);
      },
      readFor.current === null ? 800 : 4000,
    );
    return () => {
      clearTimeout(later);
    };
  }, [savedRevision]);
  const fresh = reads !== null && readFor.current === wordsOf(answers);
  // Worth changing only: a warning or worse, not set aside.
  const flags = (reads?.flags ?? []).filter(
    (f) => (f.level === 'danger' || f.level === 'warning') && !kept.has(f.sentence),
  );
  const whereIs = (f: Flag): string | null => {
    const needle = squash(f.sentence);
    return (
      textQuestions.find((q) => {
        const v = answers[q.id]?.value;
        return typeof v === 'string' && squash(textOf(v)).includes(needle);
      })?.id ?? null
    );
  };
  const keep = (f: Flag): void => {
    setKept((k) => new Set([...k, f.sentence]));
  };
  // The sentence rewritten put in its place, in the answer it is in, and
  // saved. Only ever the rewrite: the advice is for the writer to read.
  const takeSuggestion = (f: Flag): void => {
    const q = whereIs(f);
    const html = q === null ? null : answers[q]?.value;
    const was = escapeHtml(f.sentence);
    if (q === null || typeof html !== 'string' || f.rewrite === null || !html.includes(was)) {
      setNotFound(f.sentence);
      return;
    }
    setNotFound(null);
    change(q, {
      value: html.replace(was, escapeHtml(f.rewrite)),
      comment: answers[q]?.comment ?? null,
    });
    keep(f);
  };
  const flagList = (list: readonly Flag[]): JSX.Element | null =>
    list.length === 0 ? null : (
      <ReadFlags flags={list} onUse={takeSuggestion} onKeep={keep} notFound={notFound} />
    );
  const required = data.form.sections
    .flatMap((s) => s.questions)
    .filter((q) => q.required && q.type !== 'performance_score').length;
  const unconfirmed = Object.entries(data.suggestions).filter(([, s]) => !s.confirmed);
  const badge =
    saving.state === 'saving'
      ? t('reviews.saving', 'Saving…')
      : saving.state === 'saved'
        ? saving.at === null
          ? t('reviews.not_saved_yet', 'Not saved yet')
          : t('reviews.saved_revision', 'Saved {{at}} · revision {{revision}}', {
              at: time(saving.at),
              revision: String(saving.revision),
            })
        : t('reviews.not_saved', 'Not saved');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${data.review.title}${data.review.kind === 'self' ? '' : `: ${data.review.subject.name}`}`}
        description={
          data.review.cycle?.name == null
            ? t('reviews.detached_review_due', 'Detached review · due {{due}}', {
                due: day(data.review.due),
              })
            : t('reviews.due_2', '{{value}} · due {{due}}', {
                value: data.review.cycle.name,
                due: day(data.review.due),
              })
        }
        actions={
          <>
            {data.may.decline ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDialog('decline');
                }}
              >
                {t('reviews.decline', 'Decline')}
              </Button>
            ) : null}
            {data.may.unlock ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDialog('unlock');
                }}
              >
                {t('reviews.request_unlock', 'Request unlock')}
              </Button>
            ) : null}
            {data.may.withdraw ? (
              <Button
                variant="ghost"
                loading={act.pending}
                onClick={() => {
                  act.run('WithdrawPerformanceUnlock', { id: data.review.id });
                }}
              >
                {t('reviews.withdraw_unlock_request', 'Withdraw unlock request')}
              </Button>
            ) : null}
            {writing && data.ai['prefill'] === true ? (
              <Button
                variant="secondary"
                startIcon={<icons.assistant aria-hidden />}
                loading={act.pending}
                onClick={() => {
                  ai('PrefillPerformanceReview');
                }}
              >
                {t('reviews.prefill_with_ai', 'Prefill with AI')}
              </Button>
            ) : null}
          </>
        }
      />
      {/* Who it is about, how far it has got and the way to finish stay in
          view however long the form is. Pinned from the very top on the
          page's own colour, solid, so nothing scrolling under it shows above
          it, through it or past its corners. */}
      <div className="sticky top-0 z-20 -mt-2 bg-canvas pt-2 pb-2">
        <Card className="bg-surface">
          <CardContent className="grid grid-cols-1 items-center gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Person
              name={data.review.subject.name}
              sub={[
                kindLabel(data.review.kind),
                data.review.subject.title,
                t('reviews.due_3', 'due {{due}}', { due: day(data.review.due) }),
              ]
                .filter((x) => x !== '')
                .join(' · ')}
            />
            <AnswerProgress done={required - missing.length} total={required} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-sm text-fg-muted" aria-live="polite">
                {badge}
              </span>
              {unconfirmed.length > 0 ? (
                <Badge tone="accent">
                  {t('reviews.to_confirm', '{{length}} to confirm', {
                    length: t(
                      'reviews.count_suggestions',
                      { one: '{{count}} suggestion', other: '{{count}} suggestions' },
                      { count: unconfirmed.length },
                    ),
                  })}
                </Badge>
              ) : null}
              {checks ? (
                <ReadsChip
                  reads={reads}
                  reading={reading}
                  flags={flags.length}
                  subject={subject}
                  onRetry={() => {
                    readNow(wordsOf(answers));
                  }}
                />
              ) : null}
              <Button
                variant="ghost"
                startIcon={<icons.info aria-hidden />}
                aria-pressed={panelOpen}
                onClick={() => {
                  setPanelOpen((open) => !open);
                }}
              >
                {t('reviews.details', 'Details')}
              </Button>
              {writing && former !== null ? (
                // Theirs no longer to submit: the reason one press away.
                <span className="flex items-center gap-1">
                  <Button disabled>{t('reviews.submit', 'Submit')}</Button>
                  <Tooltip content={noLongerTheirs}>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t(
                        'reviews.why_submit_is_off',
                        'Why Submit is off: {{noLongerTheirs}}',
                        { noLongerTheirs },
                      )}
                      startIcon={<icons.info aria-hidden />}
                    />
                  </Tooltip>
                </span>
              ) : writing ? (
                <Button
                  onClick={() => {
                    void flush().then(() => {
                      setDialog('submit');
                    });
                  }}
                >
                  {t('reviews.submit', 'Submit')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
      <Refusal error={act.error} />
      {saving.state === 'stale' ? (
        <Alert
          tone="warning"
          title={t(
            'reviews.this_review_changed_in_another_tab',
            'This review changed in another tab',
          )}
          action={
            <Button
              size="sm"
              onClick={() => {
                props.onRefresh?.();
              }}
            >
              {t('reviews.load_the_newer_revision', 'Load the newer revision')}
            </Button>
          }
        >
          {t(
            'reviews.saving_conflict_last_change_kept',
            '{{message}} Your last change is kept on this page; load the newer revision and make it again.',
            {
              message: saving.message,
            },
          )}
        </Alert>
      ) : null}
      {saving.state === 'failed' ? (
        <Alert tone="danger" title={t('reviews.not_saved', 'Not saved')}>
          {saving.message}
        </Alert>
      ) : null}
      {data.review.detached === null ? null : (
        <Detached
          reviewId={data.review.id}
          subject={data.review.subject.name}
          keep={data.review.detached.keep}
          {...props}
        />
      )}
      {former === null ? null : (
        <Alert
          tone="warning"
          title={t(
            'reviews.you_are_no_longer_s_manager_2',
            'You are no longer {{name}}’s manager',
            { name: data.review.subject.name },
          )}
          action={
            writing ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setDialog('discard');
                }}
              >
                {t('reviews.delete_this_review', 'Delete this review')}
              </Button>
            ) : undefined
          }
        >
          {former.to == null
            ? t(
                'reviews.reports_to_someone_else_now',
                '{{subject}} reports to someone else now, so this review can no longer be submitted; their new manager writes theirs. It stays here for you to read until you delete it.',
                { subject },
              )
            : t(
                'reviews.reports_to_now',
                '{{subject}} reports to {{to}} now, so this review can no longer be submitted; {{to}} writes theirs. It stays here for you to read until you delete it.',
                { subject, to: former.to },
              )}
        </Alert>
      )}
      {data.review.handover === null ? null : (
        <Alert
          tone="info"
          title={t('reviews.handed_over_from', 'Handed over from {{from}}', {
            from: data.review.handover.from,
          })}
        >
          {data.review.handover.note ??
            t('reviews.their_draft_came_with_the_review', 'Their draft came with the review.')}
        </Alert>
      )}
      {data.review.status === 'unlock_requested' ? (
        <Alert
          tone="info"
          title={t('reviews.waiting_for_hr_to_unlock_it', 'Waiting for HR to unlock it')}
        >
          {t(
            'reviews.you_asked_until_hr_decides_the',
            'You asked: “{{value}}”. Until HR decides, the review stays submitted.',
            { value: data.review.unlock?.reason ?? '' },
          )}
        </Alert>
      ) : null}
      {data.review.kind === 'peer' || data.review.kind === 'upward' ? (
        <Alert
          tone="info"
          title={t('reviews.confidential_to', 'Confidential to {{subject}}', { subject })}
        >
          {data.review.cycle?.names === 'shown'
            ? t(
                'reviews.sees_your_answers_with_your_name',
                '{{subject}} sees your answers with your name, and only once at least {{minimum}} have answered. Their manager and HR see your name.',
                { subject, minimum: data.review.cycle.minimum ?? 3 },
              )
            : t(
                'reviews.sees_your_answers_without_your_name',
                '{{subject}} sees your answers without your name, and only once at least {{minimum}} have answered. Their manager and HR see your name.',
                { subject, minimum: data.review.cycle?.minimum ?? 3 },
              )}
        </Alert>
      ) : null}
      {/* Wide enough for a five-point scale's labels on one row (four, then one, at 3xl). */}
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex min-w-0 flex-col gap-3">
          <FormView
            definition={data.form}
            answers={answers}
            editable={writing}
            onChange={change}
            suggestions={data.suggestions}
            drafted={data.drafted}
            onConfirm={(q) => {
              const s = data.suggestions[q];
              // Chosen at once; the server writes the same answer.
              if (s !== undefined)
                setAnswers((prev) => ({
                  ...prev,
                  [q]: { value: s.value, comment: prev[q]?.comment ?? null },
                }));
              void flush().then(() => {
                act.run('ConfirmPerformanceSuggestion', { id: data.review.id, questionId: q });
              });
            }}
            score={currentScore}
            subject={subject}
            missing={missing}
            {...(data.scale === undefined ? {} : { scale: data.scale })}
            {...(checks
              ? {
                  below: (q: string) => flagList(flags.filter((f) => whereIs(f) === q)),
                  // Said again in the tones chosen; what was typed is saved first.
                  onRephrase: async (_q: string, html: string, tones: readonly string[]) => {
                    await flush();
                    const d = await act.call('RephrasePerformanceAnswer', {
                      id: data.review.id,
                      input: { html, tones },
                    });
                    return d.ok
                      ? { ok: true as const, html: (d.data as { html: string }).html }
                      : { ok: false as const, message: d.message };
                  },
                }
              : {})}
          />
        </div>
      </div>
      {/* Beside the form, not over it: non-modal, so writing goes on while it
          is open, and only the trigger or its own close button shuts it. */}
      <Sheet open={panelOpen} onOpenChange={setPanelOpen} modal={false}>
        <SheetContent
          size="sm"
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
        >
          <SheetHeader>
            <SheetTitle>{t('reviews.details', 'Details')}</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-3">
            {aiHelp ? (
              <TertiaryNav
                label={t('reviews.details', 'Details')}
                orientation="horizontal"
                variant="line"
                activeId={tab}
                onSelect={setTab}
                items={[
                  { id: 'context', label: t('reviews.context', 'Context') },
                  { id: 'ai', label: t('reviews.ai_help', 'AI help') },
                ]}
              />
            ) : null}
            {tab === 'context' || !aiHelp ? (
              <>
                <Context data={data} />
                <Card>
                  <CardHeader>
                    <CardTitle level={3}>
                      {t('reviews.earlier_reviews', 'Earlier reviews')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {data.panel.earlier.length === 0 ? (
                      <p className="text-sm text-fg-muted">
                        {t(
                          'reviews.no_earlier_reviews_you_may_read',
                          'No earlier reviews you may read.',
                        )}
                      </p>
                    ) : (
                      data.panel.earlier.map((e) => (
                        <KeyValues
                          key={e.id}
                          layout="split"
                          items={[
                            {
                              label: e.cycle ?? t('reviews.review', 'Review'),
                              value: `${e.by} · ${score(e.score)}`,
                            },
                          ]}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
            {tab === 'ai' && data.ai['summaries'] === true ? (
              <Card>
                <CardHeader>
                  <CardTitle level={3}>
                    {t('reviews.summary_of_what_others_said', 'Summary of what others said')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {summary === null ? (
                    <Asking
                      busy={asking.summary}
                      what={t('reviews.reading_what_others_said', 'Reading what others said…')}
                      error={aiError}
                    />
                  ) : summary.sentences.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {t(
                        'reviews.nobody_else_has_written_about_them',
                        'Nobody else has written about them yet.',
                      )}
                    </p>
                  ) : (
                    <>
                      <p>
                        {summary.sentences
                          .map((s) => `${s.text} [${s.cites.join(', ')}]`)
                          .join(' ')}
                      </p>
                      <ul className="flex flex-col gap-1 text-sm text-fg-muted">
                        {summary.sources.map((s) => (
                          <li key={s.id}>
                            {t('reviews.text', '{{id}}: {{label}}', { id: s.id, label: s.label })}
                          </li>
                        ))}
                      </ul>
                      {summary.dropped > 0 ? (
                        <p className="text-sm text-fg-muted">
                          {t(
                            'reviews.without_a_source_left_out',
                            '{{dropped}} without a source left out.',
                            {
                              dropped: t(
                                'reviews.count_sentences',
                                { one: '{{count}} sentence', other: '{{count}} sentences' },
                                { count: summary.dropped },
                              ),
                            },
                          )}
                        </p>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
      {dialog === 'submit' ? (
        <SubmitDialog
          data={data}
          answers={answers}
          missing={missing}
          score={currentScore}
          flush={flush}
          reads={
            checks
              ? {
                  reads,
                  reading,
                  fresh,
                  flags,
                  onRead: () => {
                    readNow(wordsOf(answers));
                  },
                  list: flagList,
                }
              : null
          }
          onClose={() => {
            setDialog(null);
          }}
          {...props}
        />
      ) : null}
      {dialog === 'unlock' ? (
        <UnlockDialog
          id={data.review.id}
          subject={data.review.subject.name}
          onClose={() => {
            setDialog(null);
          }}
          {...props}
        />
      ) : null}
      {dialog === 'discard' ? (
        <Modal
          open
          onClose={() => {
            setDialog(null);
          }}
          title={t('reviews.delete_this_review_2', 'Delete this review?')}
          description={t(
            'reviews.what_you_wrote_about_is_deleted',
            'What you wrote about {{subject}} is deleted, and nobody sees it. This cannot be undone.',
            { subject },
          )}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setDialog(null);
                }}
              >
                {t('reviews.keep_it', 'Keep it')}
              </Button>
              <Button
                variant="danger"
                loading={act.pending}
                onClick={() => {
                  act.run('DiscardPerformanceReview', { id: data.review.id }, () => {
                    props.onNavigate?.('/performance/reviews');
                  });
                }}
              >
                {t('reviews.delete', 'Delete')}
              </Button>
            </>
          }
        >
          <Refusal error={act.error} />
        </Modal>
      ) : null}
      {dialog === 'decline' ? (
        <DeclineDialog
          id={data.review.id}
          subject={subject}
          onClose={() => {
            setDialog(null);
          }}
          {...props}
        />
      ) : null}
    </div>
  );
}

interface Reads {
  readonly reads: string | null;
  readonly flags: readonly {
    readonly sentence: string;
    readonly level: string;
    readonly title: string;
    /** What to change, for the writer to read. */
    readonly advice: string | null;
    /** The sentence itself, mended, to stand in its place; [brackets] for what only the writer knows. */
    readonly rewrite: string | null;
  }[];
  readonly sentiment: {
    readonly position: number | null;
    readonly counts: {
      readonly positive: number;
      readonly negative: number;
      readonly neutral: number;
    };
  } | null;
}

type Flag = Reads['flags'][number];

/**
 * An answer's words, as the reader sees them: tags dropped, entities read.
 * Only ever compared with words, never put back as markup; the tags are
 * stripped until none is left, so no tag can survive by being nested.
 */
const textOf = (html: string): string => {
  let text = html.replaceAll(/<\/(p|li|h\d)>/gu, '\n');
  for (let before = ''; before !== text;) {
    before = text;
    text = text.replaceAll(/<[^<>]*>/gu, '');
  }
  return text
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
};
const squash = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim();
const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** What is worth changing in a sentence, with the change itself one press away. */
function ReadFlags({
  flags,
  onUse,
  onKeep,
  notFound,
}: {
  readonly flags: readonly Flag[];
  readonly onUse: (f: Flag) => void;
  readonly onKeep: (f: Flag) => void;
  readonly notFound: string | null;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {flags.map((f) => (
        <Alert
          key={f.sentence}
          tone={f.level === 'danger' ? 'danger' : 'warning'}
          title={f.title}
          action={
            <span className="flex flex-wrap gap-2">
              {f.rewrite === null ? null : (
                <Button
                  size="sm"
                  onClick={() => {
                    onUse(f);
                  }}
                >
                  {t('reviews.use_the_rewrite', 'Use the rewrite')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onKeep(f);
                }}
              >
                {t('reviews.keep_as_is', 'Keep as is')}
              </Button>
            </span>
          }
        >
          <span className="flex flex-col gap-1">
            <span>{`“${f.sentence}”`}</span>
            {f.advice === null ? null : <span className="text-fg-muted">{f.advice}</span>}
            {f.rewrite === null ? null : (
              <span className="text-fg">
                {t('reviews.instead', 'Instead: “{{rewrite}}”', { rewrite: f.rewrite })}
                {/\[[^\]]+\]/u.test(f.rewrite) ? (
                  <span className="text-fg-muted">
                    {' '}
                    {t('reviews.fill_in_the_parts_in_brackets', 'Fill in the parts in brackets.')}
                  </span>
                ) : null}
              </span>
            )}
            {notFound === f.sentence ? (
              <span className="text-fg-muted">
                {t(
                  'reviews.that_sentence_has_changed_since_it',
                  'That sentence has changed since it was read: edit it by hand.',
                )}
              </span>
            ) : null}
          </span>
        </Alert>
      ))}
    </div>
  );
}

/** The draft's tone in the bar that stays in view: open for the whole reading. */
function ReadsChip({
  reads,
  reading,
  flags,
  subject,
  onRetry,
}: {
  readonly reads: Reads | null;
  readonly reading: 'idle' | 'reading' | 'failed';
  readonly flags: number;
  readonly subject: string;
  readonly onRetry: () => void;
}): JSX.Element | null {
  if (reading === 'failed')
    return (
      <Button size="sm" variant="ghost" startIcon={<icons.refresh aria-hidden />} onClick={onRetry}>
        {t('reviews.retry_reading_it', 'Retry reading it')}
      </Button>
    );
  if (reads === null || reads.reads === null)
    return reading === 'reading' ? (
      <Spinner size="sm" label={t('reviews.reading_your_draft', 'Reading your draft')} />
    ) : null;
  const position = reads.sentiment?.position ?? null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('reviews.how_it_will_read_to', 'How it will read to {{subject}}', {
            subject,
          })}
          loading={reading === 'reading'}
        >
          {position === null
            ? t('reviews.how_it_reads', 'How it reads')
            : t('reviews.text_2', '{{value}} {{toneWord}}', {
                value: FACES[Math.min(4, Math.floor(position / 20))] ?? '',
                toneWord: toneWord(position),
              })}
          {flags === 0 ? null : (
            <Badge size="sm" tone="warning" className="ml-1.5">
              {String(flags)}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <p className="text-sm font-semibold">
          {t('reviews.how_it_will_read_to', 'How it will read to {{subject}}', { subject })}
        </p>
        {position === null || reads.sentiment === null ? null : (
          <Tone position={position} counts={reads.sentiment.counts} />
        )}
        <p className="text-sm">{reads.reads}</p>
        {flags === 0 ? null : (
          <p className="text-sm text-fg-muted">
            {t('reviews.under_your_answers', '{{flags}} under your answers.', {
              flags: t(
                'reviews.count_suggestions',
                { one: '{{count}} suggestion', other: '{{count}} suggestions' },
                { count: flags },
              ),
            })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** An AI answer on its way, or why it did not come. */
function Asking({
  busy,
  what,
  error,
}: {
  readonly busy: boolean;
  readonly what: string;
  readonly error: string | null;
}): JSX.Element {
  return busy || error === null ? (
    <p className="flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
      <Spinner size="sm" label={what} />
      {what}
    </p>
  ) : (
    <p className="text-sm text-fg-muted">{error}</p>
  );
}

const FACES = ['😟', '😕', '😐', '🙂', '😄'] as const;
const toneWord = (v: number): string =>
  v < 30
    ? t('reviews.critical', 'Critical')
    : v < 45
      ? t('reviews.guarded', 'Guarded')
      : v < 60
        ? t('reviews.balanced', 'Balanced')
        : v < 80
          ? t('reviews.encouraging', 'Encouraging')
          : t('reviews.glowing', 'Glowing');

/** The draft's tone (§13.6): where the domain put it, with the sentences behind it. */
function Tone({
  position,
  counts,
}: {
  readonly position: number;
  readonly counts: NonNullable<Reads['sentiment']>['counts'];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Slider
        variant="meter"
        label={t('reviews.tone_of_your_draft', 'Tone of your draft')}
        value={[position]}
        knob={(v) => FACES[Math.min(4, Math.floor(v / 20))]}
        tip={toneWord}
        labels={[
          t('reviews.critical', 'Critical'),
          t('reviews.balanced', 'Balanced'),
          t('reviews.encouraging', 'Encouraging'),
        ]}
      />
      <p className="text-sm text-fg-muted">
        {[
          counts.positive > 0
            ? t('reviews.encouraging_2', '{{positive}} encouraging', {
                positive: String(counts.positive),
              })
            : '',
          counts.neutral > 0
            ? t('reviews.neutral', '{{neutral}} neutral', { neutral: String(counts.neutral) })
            : '',
          counts.negative > 0
            ? t('reviews.critical_2', '{{negative}} critical', {
                negative: String(counts.negative),
              })
            : '',
        ]
          .filter((x) => x !== '')
          .join(' · ')}{' '}
        {t('reviews.sentences', 'sentences')}
      </p>
    </div>
  );
}

/** Whether an answer counts, as form-kit's `isAnswered` does; the save's reply settles any doubt. */
const answered = (a: Answer | undefined): boolean => {
  const v = a?.value;
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

/** Required questions answered, at the top and centre: the count springs as it moves. */
function AnswerProgress({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}): JSX.Element {
  const complete = total > 0 && done >= total;
  return (
    <div className="flex w-full flex-col items-center gap-1.5 md:w-72">
      <span className="flex items-center gap-1.5 text-sm font-medium" aria-live="polite">
        {complete ? (
          <icons.success aria-hidden className="size-4 text-success motion-safe:animate-pop-in" />
        ) : null}
        <span key={done} className="tabular-nums motion-safe:animate-pop-in">
          {total === 0
            ? t('reviews.no_required_questions', 'No required questions')
            : complete
              ? t('reviews.every_required_question_answered', 'Every required question answered')
              : t('reviews.of_required_answered', '{{done}} of {{total}} required answered', {
                  done: String(done),
                  total: String(total),
                })}
        </span>
      </span>
      <Progress
        className="w-full"
        tone={complete ? 'success' : 'accent'}
        value={total === 0 ? 100 : Math.round((done / total) * 100)}
        label={t('reviews.required_questions_answered', 'Required questions answered')}
      />
    </div>
  );
}

function Context({ data }: { readonly data: WriteData }): JSX.Element {
  const p = data.panel;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle level={3}>{t('reviews.goals', 'Goals')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {p.goals.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t('reviews.no_goals_this_period', 'No goals this period.')}
            </p>
          ) : (
            p.goals.map((g) => (
              <div key={g.id} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{g.title}</span>
                  <Badge size="sm" tone={CONFIDENCE[g.confidence]?.[1] ?? 'success'}>
                    {CONFIDENCE[g.confidence]?.[0] ?? t('reviews.on_track', 'On track')}
                  </Badge>
                </span>
                <Progress
                  value={g.progress}
                  label={t('reviews.text_3', '{{title}}: {{progress}}%', {
                    title: g.title,
                    progress: String(g.progress),
                  })}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
      {p.reviews.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={3}>
              {t('reviews.reviews_in', 'Reviews in · {{length}}', {
                length: String(p.reviews.length),
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {p.reviews.map((r) => (
              <div key={r.id} className="flex flex-col gap-1">
                <Person name={r.by} sub={`${r.title}${r.at === null ? '' : ` · ${day(r.at)}`}`} />
                {r.ratings.length === 0 ? null : (
                  <p className="text-sm text-fg-muted">
                    {r.ratings
                      .map((x) =>
                        t('reviews.text_4', '{{question}}: {{value}}', {
                          question: x.question,
                          value: x.label ?? '—',
                        }),
                      )
                      .join(' · ')}
                  </p>
                )}
                {r.excerpt === null || r.excerpt === '' ? null : (
                  <p className="text-sm">{`“${r.excerpt}”`}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle level={3}>
            {t('reviews.feedback', 'Feedback · {{length}}', { length: String(p.feedback.length) })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {p.feedback.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t('reviews.no_feedback_you_may_read', 'No feedback you may read.')}
            </p>
          ) : (
            p.feedback.slice(0, 6).map((f) => (
              <p key={f.id} className="text-sm">
                {t('reviews.text_5', '“{{text}}” — {{from}}, {{at}}', {
                  text: f.text,
                  from: f.from,
                  at: day(f.at),
                })}
              </p>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={3}>{t('reviews.your_notes', 'Your notes')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {p.notes.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t(
                'reviews.notes_you_keep_about_them_show',
                'Notes you keep about them show here, for you alone.',
              )}
            </p>
          ) : (
            p.notes.map((n) => (
              <p key={n.id} className="text-sm">
                {t('reviews.text_6', '{{title}}: {{text}}', { title: n.title, text: n.text })}
              </p>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** PF12: submit and lock, every AI suggestion confirmed, the score Kithena's. */
function SubmitDialog({
  data,
  missing,
  score: s,
  onClose,
  flush,
  reads: check,
  ...props
}: ScreenProps<WriteData> & {
  readonly data: WriteData;
  readonly answers: Answers;
  readonly missing: readonly string[];
  readonly score: Score | null;
  readonly onClose: () => void;
  /** Saves what is pending, so a suggestion taken here is in what is submitted. */
  readonly flush: () => Promise<void>;
  /** How it will read, from the writer; null where the company has it off. */
  readonly reads: {
    readonly reads: Reads | null;
    readonly reading: 'idle' | 'reading' | 'failed';
    readonly fresh: boolean;
    readonly flags: readonly Flag[];
    readonly onRead: () => void;
    readonly list: (flags: readonly Flag[]) => JSX.Element | null;
  } | null;
}): JSX.Element {
  const act = useAct(props);
  // Read again on opening if the words moved since the last reading.
  useEffect(() => {
    if (check !== null && !check.fresh && check.reading !== 'reading') check.onRead();
  }, []);
  const pending = Object.entries(data.suggestions).filter(([, x]) => !x.confirmed);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [hideName, setHideName] = useState(true);
  const prompts = new Map(
    data.form.sections.flatMap((x) => x.questions.map((q) => [q.id, q.prompt] as const)),
  );
  const left = pending.filter(([q]) => !confirmed.includes(q)).length;
  const subject = data.review.subject.name.split(' ')[0] ?? '';
  return (
    <Modal
      open
      onClose={onClose}
      title={
        data.review.kind === 'self'
          ? t('reviews.submit_your_self_review', 'Submit your self review?')
          : t('reviews.submit_their_review', 'Submit {{subject}}’s {{kind}}?', {
              subject,
              kind: kindLabel(data.review.kind).toLowerCase(),
            })
      }
      description={t(
        'reviews.after_submitting_you_cant_edit_hr',
        'After submitting you can’t edit. HR can unlock it if you ask.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('reviews.keep_writing', 'Keep writing')}
          </Button>
          <Button
            disabled={missing.length > 0 || left > 0}
            loading={act.pending}
            onClick={() => {
              void flush().then(() => {
                act.run(
                  'SubmitPerformanceReview',
                  {
                    id: data.review.id,
                    input: {
                      confidential: data.review.cycle?.names === 'writer' ? hideName : null,
                      confirm: confirmed,
                    },
                  },
                  onClose,
                );
              });
            }}
          >
            {left > 0
              ? t('reviews.confirm_more_to_submit', 'Confirm {{left}} more to submit', {
                  left: String(left),
                })
              : t('reviews.submit', 'Submit')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      {missing.length > 0 ? (
        <Alert
          tone="warning"
          title={t('reviews.without_an_answer', '{{length}} without an answer', {
            length: t(
              'reviews.count_required_questions',
              { one: '{{count}} required question', other: '{{count}} required questions' },
              { count: missing.length },
            ),
          })}
        >
          {missing.map((q) => prompts.get(q) ?? q).join(' · ')}
        </Alert>
      ) : (
        <Alert
          tone="success"
          title={t(
            'reviews.every_required_question_is_answered',
            'Every required question is answered',
          )}
        />
      )}
      {check === null ? null : (
        // How it will read, last before it is sent: the tone always, a change
        // only where one is worth making.
        <div className="flex flex-col gap-2">
          <p className="font-medium">
            {t('reviews.how_it_will_read_to', 'How it will read to {{subject}}', { subject })}
          </p>
          {check.reading === 'reading' ? (
            <Asking
              busy
              what={t('reviews.reading_your_draft', 'Reading your draft…')}
              error={null}
            />
          ) : check.reading === 'failed' ? (
            <span className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              {t('reviews.it_could_not_be_read_just', 'It could not be read just now.')}
              <Button
                size="sm"
                variant="secondary"
                startIcon={<icons.refresh aria-hidden />}
                onClick={check.onRead}
              >
                {t('reviews.retry', 'Retry')}
              </Button>
            </span>
          ) : check.reads === null || check.reads.reads === null ? null : (
            <>
              {check.reads.sentiment === null || check.reads.sentiment.position === null ? null : (
                <Tone
                  position={check.reads.sentiment.position}
                  counts={check.reads.sentiment.counts}
                />
              )}
              {check.flags.length === 0 ? (
                <p className="text-sm text-fg-muted">{check.reads.reads}</p>
              ) : (
                <>
                  <p className="text-sm text-fg-muted">
                    {t(
                      'reviews.worth_making_before_you_submit',
                      '{{length}} worth making before you submit:',
                      {
                        length: t(
                          'reviews.count_changes',
                          { one: '{{count}} change', other: '{{count}} changes' },
                          { count: check.flags.length },
                        ),
                      },
                    )}
                  </p>
                  {check.list(check.flags)}
                </>
              )}
            </>
          )}
        </div>
      )}
      {pending.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="font-medium">
            {t('reviews.confirm_each_ai_suggestion', 'Confirm each AI suggestion')}
          </p>
          {pending.map(([q, x]) => (
            <Field key={q} orientation="horizontal">
              <FieldControl>
                <Checkbox
                  checked={confirmed.includes(q)}
                  onCheckedChange={(on) => {
                    setConfirmed(
                      on === true ? [...confirmed, q] : confirmed.filter((y) => y !== q),
                    );
                  }}
                />
              </FieldControl>
              <span className="flex flex-col">
                <FieldLabel>
                  {t('reviews.text_7', '{{value}}: {{value2}}', {
                    value: prompts.get(q) ?? q,
                    value2: String(x.value),
                  })}
                </FieldLabel>
                <FieldDescription>{x.reason}</FieldDescription>
              </span>
            </Field>
          ))}
          {pending.length > 1 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setConfirmed(pending.map(([q]) => q));
              }}
            >
              {t('reviews.confirm_all', 'Confirm all')}
            </Button>
          ) : null}
        </div>
      )}
      {s === null ? null : (
        <KeyValues
          layout="split"
          items={[
            {
              label: t('reviews.performance_score', 'Performance score'),
              value: `${s.display} · ${s.label}, computed from ${String(s.rated)} answers`,
            },
          ]}
        />
      )}
      {data.review.cycle?.names === 'writer' ? (
        <Field orientation="horizontal">
          <FieldControl>
            <Checkbox
              checked={hideName}
              onCheckedChange={(on) => {
                setHideName(on === true);
              }}
            />
          </FieldControl>
          <FieldLabel>
            {t('reviews.dont_show_my_name_to', 'Don’t show my name to {{subject}}', { subject })}
          </FieldLabel>
        </Field>
      ) : null}
      <p className="text-sm text-fg-muted">
        {t(
          'reviews.the_score_is_worked_out_by',
          'The score is worked out by Kithena from the confirmed answers; the AI never sets it.',
        )}
      </p>
    </Modal>
  );
}

function UnlockDialog({
  id,
  subject,
  onClose,
  ...props
}: ScreenProps<unknown> & {
  readonly id: string;
  readonly subject: string;
  readonly onClose: () => void;
}): JSX.Element {
  const act = useAct(props);
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={t('reviews.ask_hr_to_unlock_this_review', 'Ask HR to unlock this review?')}
      description={t('reviews.about_2', 'About {{subject}}', { subject })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('reviews.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={reason.trim().length < 10}
            loading={act.pending}
            onClick={() => {
              act.run('RequestPerformanceUnlock', { id, input: { reason } }, onClose);
            }}
          >
            {t('reviews.send_request', 'Send request')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>{t('reviews.why', 'Why')}</FieldLabel>
        <Textarea
          autoResize
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        <FieldDescription>
          {t(
            'reviews.at_least_10_characters_hr_gets',
            'At least 10 characters. HR gets an Inbox task; until they decide, the review stays submitted.',
          )}
        </FieldDescription>
      </Field>
    </Modal>
  );
}

function DeclineDialog({
  id,
  subject,
  onClose,
  ...props
}: ScreenProps<unknown> & {
  readonly id: string;
  readonly subject: string;
  readonly onClose: () => void;
}): JSX.Element {
  const act = useAct(props);
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={t('reviews.decline_the_peer_review_of', 'Decline the peer review of {{subject}}?', {
        subject,
      })}
      description={t(
        'reviews.whoever_nominated_you_is_told_and',
        'Whoever nominated you is told and can pick someone else.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('reviews.cancel', 'Cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={act.pending}
            onClick={() => {
              act.run('DeclinePerformanceReview', { id, input: { reason } }, () => {
                props.onNavigate?.('/performance/reviews');
              });
            }}
          >
            {t('reviews.decline', 'Decline')}
          </Button>
        </>
      }
    >
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>{t('reviews.why', 'Why')}</FieldLabel>
        <Input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}

/** PF10f: the author keeps or deletes a review whose subject left the cycle. */
function Detached({
  reviewId,
  subject,
  keep,
  ...props
}: ScreenProps<unknown> & {
  readonly reviewId: string;
  readonly subject: string;
  readonly keep: boolean | null;
}): JSX.Element {
  const act = useAct(props);
  return (
    <Alert
      tone="warning"
      title={t(
        'reviews.this_review_is_not_part_of',
        'This review is not part of its cycle any more',
      )}
      action={
        keep === null ? (
          <span className="flex gap-2">
            <Button
              size="sm"
              loading={act.pending}
              onClick={() => {
                act.run('KeepPerformanceDetached', { id: reviewId, input: { keep: true } });
              }}
            >
              {t('reviews.keep_it', 'Keep it')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                act.run('KeepPerformanceDetached', { id: reviewId, input: { keep: false } }, () => {
                  props.onNavigate?.('/performance/reviews/done');
                });
              }}
            >
              {t('reviews.delete_it', 'Delete it')}
            </Button>
          </span>
        ) : undefined
      }
    >
      {t(
        'reviews.removed_from_the_cycle_draft_kept',
        '{{subject}} was removed from the cycle. Nobody else can read your draft; a kept review reattaches if {{subject}} is added back.',
        { subject },
      )}
    </Alert>
  );
}

/* ------------------------------------------------------------ released -- */

export interface ReleasedData {
  readonly review: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly by: string | null;
    readonly released: string | null;
    readonly acknowledged: { readonly at: string; readonly comment: string | null } | null;
    readonly cycle: string | null;
    /** The writer's tools an AI draft drew on, by name. */
    readonly helpedBy?: readonly string[];
  };
  readonly definition: FormDefinition;
  readonly answers: Answers;
  readonly score: {
    readonly display: string;
    readonly label: string;
    readonly final: boolean;
  } | null;
  readonly group: readonly {
    readonly id: string;
    readonly by: string;
    readonly definition: FormDefinition;
    readonly answers: Answers;
  }[];
  readonly may: { readonly acknowledge: boolean; readonly comment: boolean };
}

/** PF11b: a released review as its subject reads it, and acknowledging it. */
export function Released(props: ScreenProps<ReleasedData>): JSX.Element {
  const act = useAct(props);
  const [comment, setComment] = useState('');
  return (
    <Loaded load={props.load} what={t('reviews.the_review', 'the review')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={
              data.review.cycle === null
                ? data.review.title
                : t('reviews.text_8', '{{title}}, {{cycle}}', {
                    title: data.review.title,
                    cycle: data.review.cycle,
                  })
            }
            description={[
              data.review.by === null
                ? t('reviews.names_hidden', 'Names hidden')
                : t('reviews.from', 'From {{by}}', { by: data.review.by }),
              ...(data.review.released === null
                ? []
                : [
                    t('reviews.released_on', 'released {{day}}', {
                      day: day(data.review.released),
                    }),
                  ]),
              ...((data.review.helpedBy ?? []).length === 0
                ? []
                : [
                    t('reviews.drafted_with_help_from', 'Drafted with help from {{names}}', {
                      names: formatList(data.review.helpedBy ?? []),
                    }),
                  ]),
            ].join(' · ')}
            actions={
              <Button
                variant="secondary"
                startIcon={<icons.download aria-hidden />}
                loading={act.pending}
                onClick={() => {
                  act.run('PerformanceReviewPdf', { id: data.review.id }, (d) => {
                    download(d as { filename: string; base64: string });
                  });
                }}
              >
                {t('reviews.download_pdf', 'Download PDF')}
              </Button>
            }
          />
          <Refusal error={act.error} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-4">
              {data.score === null ? null : (
                <Card>
                  <CardContent className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold tabular-nums">{data.score.display}</span>
                    <span className="text-fg-muted">
                      {data.score.final
                        ? data.score.label
                        : t('reviews.score_before_calibration', '{{score}} · before calibration', {
                            score: data.score.label,
                          })}
                    </span>
                  </CardContent>
                </Card>
              )}
              {data.group.length > 0 ? (
                data.group.map((g) => (
                  <div key={g.id} className="flex flex-col gap-2">
                    <p className="font-semibold">{g.by}</p>
                    <FormView definition={g.definition} answers={g.answers} />
                  </div>
                ))
              ) : (
                <FormView definition={data.definition} answers={data.answers} />
              )}
            </div>
            {data.may.acknowledge || data.review.acknowledged !== null ? (
              <Card>
                <CardHeader>
                  <CardTitle level={2}>{t('reviews.acknowledge', 'Acknowledge')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.review.acknowledged === null ? (
                    <>
                      <p className="text-sm text-fg-muted">
                        {t(
                          'reviews.acknowledging_says_youve_read_it_it',
                          'Acknowledging says you’ve read it. It doesn’t say you agree.',
                        )}
                      </p>
                      {data.may.comment ? (
                        <Field>
                          <FieldLabel>
                            {t(
                              'reviews.comment_for_your_manager_and_hr',
                              'Comment for your manager and HR (optional)',
                            )}
                          </FieldLabel>
                          <Textarea
                            autoResize
                            value={comment}
                            onChange={(e) => {
                              setComment(e.target.value);
                            }}
                          />
                        </Field>
                      ) : null}
                      <Button
                        startIcon={<icons.confirm aria-hidden />}
                        loading={act.pending}
                        onClick={() => {
                          act.run('AcknowledgePerformanceReview', {
                            id: data.review.id,
                            input: { comment: comment.trim() === '' ? null : comment },
                          });
                        }}
                      >
                        {t('reviews.acknowledge', 'Acknowledge')}
                      </Button>
                    </>
                  ) : (
                    <Alert
                      tone="success"
                      title={t('reviews.acknowledged_2', 'Acknowledged {{at}}', {
                        at: day(data.review.acknowledged.at),
                      })}
                    >
                      {data.review.acknowledged.comment === null
                        ? t('reviews.no_comment', 'No comment.')
                        : `“${data.review.acknowledged.comment}”`}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </Loaded>
  );
}

/* ------------------------------------------------ reading and releasing -- */

export interface AboutData {
  readonly cycle: {
    readonly id: string;
    readonly name: string;
    readonly minimum: number;
    readonly acknowledge: boolean;
  };
  readonly subject: { readonly personId: string; readonly name: string };
  readonly reviews: readonly {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly by: string;
    readonly at: string | null;
    readonly form: FormDefinition;
    readonly answers: Answers;
    readonly score: Score | null;
    readonly released: string | null;
  }[];
  readonly peers: number;
  readonly release: {
    readonly manager: {
      readonly id: string;
      readonly at: string | null;
      readonly released: string | null;
    } | null;
    readonly peerSummary: boolean;
    readonly beforeCalibration: boolean;
    readonly may: boolean;
  };
  /** The company has Documents: the manager review can be filed to the person (PRD §20). */
  readonly documents?: boolean;
}

/** PF11: the manager reads everything about a report, with names, then releases. */
export function About(props: ScreenProps<AboutData>): JSX.Element {
  const act = useAct(props);
  const [kind, setKind] = useState('manager');
  const [ack, setAck] = useState(true);
  const [filed, setFiled] = useState(false);
  return (
    <Loaded load={props.load} what={t('reviews.the_reviews', 'the reviews')}>
      {(data) => {
        const shown = data.reviews.filter((r) => r.kind === kind);
        const kinds = [...new Set(data.reviews.map((r) => r.kind))];
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={t('reviews.s_reviews', '{{name}}’s reviews', { name: data.subject.name })}
              description={data.cycle.name}
              actions={
                data.documents === true && data.release.manager?.at != null ? (
                  <Button
                    variant="secondary"
                    startIcon={<icons.file aria-hidden />}
                    loading={act.pending}
                    disabled={filed}
                    onClick={() => {
                      act.run(
                        'FilePerformanceReviewToDocuments',
                        { id: data.release.manager?.id, subjectPersonId: data.subject.personId },
                        () => {
                          setFiled(true);
                        },
                      );
                    }}
                  >
                    {filed
                      ? t('reviews.filed_to_documents', 'Filed to Documents')
                      : t('reviews.file_to_documents', 'File to Documents')}
                  </Button>
                ) : null
              }
            />
            <Refusal error={act.error} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex flex-col gap-3">
                <TertiaryNav
                  label={t('reviews.reviews', 'Reviews')}
                  orientation="horizontal"
                  variant="line"
                  activeId={kinds.includes(kind) ? kind : (kinds[0] ?? '')}
                  onSelect={setKind}
                  items={kinds.map((k) => ({
                    id: k,
                    label: `${kindLabel(k)}${data.reviews.filter((r) => r.kind === k).length > 1 ? ` · ${String(data.reviews.filter((r) => r.kind === k).length)}` : ''}`,
                  }))}
                />
                {shown.length === 0 ? (
                  <EmptyState title={t('reviews.nothing_submitted_yet', 'Nothing submitted yet')} />
                ) : (
                  shown.map((r) => (
                    <div key={r.id} className="flex flex-col gap-2">
                      <Person
                        name={r.by}
                        sub={
                          r.at === null
                            ? null
                            : t('reviews.submitted', 'Submitted {{at}}', { at: day(r.at) })
                        }
                      />
                      {r.kind === 'peer' && shown.length > 1 ? (
                        <RatingBars reviews={shown} />
                      ) : null}
                      <FormView
                        definition={r.form}
                        answers={r.answers}
                        score={r.score}
                        subject={data.subject.name}
                      />
                    </div>
                  ))
                )}
                {kind === 'peer' ? (
                  <p className="text-sm text-fg-muted">
                    {t('reviews.you_see_peer_names_wont', 'You see peer names. {{value}} won’t.', {
                      value: data.subject.name.split(' ')[0] ?? '',
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-3">
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>
                      {t('reviews.release_to', 'Release to {{value}}', {
                        value: data.subject.name.split(' ')[0] ?? '',
                      })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <KeyValues
                      layout="split"
                      items={[
                        {
                          label: t('reviews.manager_review', 'Manager review'),
                          value:
                            data.release.manager === null
                              ? 'Not submitted'
                              : data.release.manager.released === null
                                ? `Submitted ${day(data.release.manager.at)}`
                                : `Released ${day(data.release.manager.released)}`,
                        },
                        {
                          label: t('reviews.peer_summary', 'Peer summary'),
                          value: data.release.peerSummary
                            ? `${t('reviews.count_answers', { one: '{{count}} answer', other: '{{count}} answers' }, { count: data.peers })}, no names`
                            : `Held back: under ${String(data.cycle.minimum)}`,
                        },
                      ]}
                    />
                    {data.cycle.acknowledge ? (
                      <Field orientation="horizontal">
                        <FieldControl>
                          <Checkbox
                            checked={ack}
                            onCheckedChange={(on) => {
                              setAck(on === true);
                            }}
                          />
                        </FieldControl>
                        <FieldLabel>
                          {t('reviews.ask_for_an_acknowledgement', 'Ask for an acknowledgement')}
                        </FieldLabel>
                      </Field>
                    ) : null}
                    <Button
                      startIcon={<icons.send aria-hidden />}
                      disabled={
                        !data.release.may ||
                        data.release.manager === null ||
                        data.release.manager.released !== null
                      }
                      loading={act.pending}
                      onClick={() => {
                        act.run('ReleasePerformanceSubject', {
                          cycleId: data.cycle.id,
                          subjectId: data.subject.personId,
                          input: { acknowledge: ack },
                        });
                      }}
                    >
                      {data.release.manager?.released
                        ? t('reviews.released', 'Released')
                        : t('reviews.release_to', 'Release to {{value}}', {
                            value: data.subject.name.split(' ')[0] ?? '',
                          })}
                    </Button>
                  </CardContent>
                </Card>
                {data.release.beforeCalibration ? (
                  <Alert
                    tone="neutral"
                    title={t('reviews.not_final_until_calibration', 'Not final until calibration')}
                  >
                    {t(
                      'reviews.released_now_the_score_shows_as',
                      'Released now, the score shows as “before calibration”.',
                    )}
                  </Alert>
                ) : null}
              </div>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

function RatingBars({ reviews }: { readonly reviews: AboutData['reviews'] }): JSX.Element | null {
  const first = reviews[0]?.form.sections
    .flatMap((s) => s.questions)
    .find((q) => q.type === 'scale');
  if (first?.type !== 'scale') return null;
  const counts = first.options
    .map((o) => ({
      label: o.label,
      value: reviews.filter((r) => r.answers[first.id]?.value === o.value).length,
    }))
    .filter((p) => p.value > 0);
  return <HorizontalBarChart label={first.prompt} data={counts} showValues />;
}

/* ------------------------------------------------------------- unlocks -- */

export interface UnlocksData {
  readonly rows: readonly {
    readonly reviewId: string;
    readonly by: string;
    readonly review: string;
    readonly cycle: string | null;
    readonly reason: string;
    readonly at: string;
    readonly decided: string | null;
  }[];
}

/** PF20: every unlock request, decided only by HR. */
export function Unlocks(props: ScreenProps<UnlocksData>): JSX.Element {
  const act = useAct(props);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Loaded load={props.load} what={t('reviews.unlock_requests', 'unlock requests')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={t('reviews.unlock_requests', 'Unlock requests')}
            description={t(
              'reviews.only_hr_decides_an_unlocked_review',
              'Only HR decides. An unlocked review keeps its submitted revision until it’s submitted again.',
            )}
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.unlocked aria-hidden />}
                  title={t('reviews.no_unlock_requests', 'No unlock requests')}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('reviews.asked_by', 'Asked by')}</TableHead>
                      <TableHead>{t('reviews.review', 'Review')}</TableHead>
                      <TableHead>{t('reviews.reason', 'Reason')}</TableHead>
                      <TableHead>{t('reviews.when', 'When')}</TableHead>
                      <TableHead>
                        <span className="sr-only">{t('reviews.decision', 'Decision')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((u) => (
                      <TableRow key={u.reviewId}>
                        <TableCell>
                          <Person name={u.by} />
                        </TableCell>
                        <TableCell className="text-sm">{`${u.review}${u.cycle === null ? '' : ` · ${u.cycle}`}`}</TableCell>
                        <TableCell className="text-sm text-fg-muted">{`“${u.reason}”`}</TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {u.at === '' ? '—' : when(u.at)}
                        </TableCell>
                        <TableCell>
                          {u.decided === null ? (
                            <span className="flex gap-1.5">
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => {
                                  setDeclining(u.reviewId);
                                }}
                              >
                                {t('reviews.decline', 'Decline')}
                              </Button>
                              <Button
                                size="xs"
                                loading={act.pending}
                                onClick={() => {
                                  act.run('DecidePerformanceUnlock', {
                                    id: u.reviewId,
                                    input: {
                                      approve: true,
                                      note: t('reviews.unlocked', 'Unlocked'),
                                    },
                                  });
                                }}
                              >
                                {t('reviews.unlock', 'Unlock')}
                              </Button>
                            </span>
                          ) : (
                            <Badge size="sm" tone={u.decided === 'Unlocked' ? 'info' : 'neutral'}>
                              {u.decided}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Modal
            open={declining !== null}
            onClose={() => {
              setDeclining(null);
            }}
            title={t('reviews.decline_this_unlock_request', 'Decline this unlock request?')}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeclining(null);
                  }}
                >
                  {t('reviews.cancel', 'Cancel')}
                </Button>
                <Button
                  disabled={note.trim() === ''}
                  loading={act.pending}
                  onClick={() => {
                    if (declining !== null)
                      act.run(
                        'DecidePerformanceUnlock',
                        { id: declining, input: { approve: false, note } },
                        () => {
                          setDeclining(null);
                          setNote('');
                        },
                      );
                  }}
                >
                  {t('reviews.decline', 'Decline')}
                </Button>
              </>
            }
          >
            <Field required>
              <FieldLabel>{t('reviews.a_note_for_the_writer', 'A note for the writer')}</FieldLabel>
              <Input
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </Field>
          </Modal>
        </div>
      )}
    </Loaded>
  );
}

/* --------------------------------------------------------- nominations -- */

interface Pick {
  readonly personId: string;
  readonly name: string;
  readonly title: string;
}

export interface NominateData {
  readonly nomination: {
    readonly id: string;
    readonly state: string;
    readonly subject: string;
    readonly subjectId: string;
    readonly picked: readonly string[];
    readonly note: string | null;
    readonly nominees: readonly {
      readonly personId: string;
      readonly name: string;
      readonly state: string;
      readonly reason: string | null;
    }[];
  };
  readonly bounds: { readonly min: number; readonly max: number; readonly perReviewer: number };
  readonly approver: string;
  readonly team: readonly Pick[];
  readonly worksWith: readonly Pick[];
  readonly found: readonly Pick[];
  readonly cycle: string;
}

/** PF9b and PF9c: pick peers (team first, then people they work with, then anyone), or approve them. */
export function Nominate(props: ScreenProps<NominateData>): JSX.Element {
  return (
    <Loaded load={props.load} what={t('reviews.the_nomination', 'the nomination')}>
      {(data) =>
        data.nomination.state === 'waiting' ? (
          <Approve data={data} {...props} />
        ) : (
          <Picker data={data} {...props} />
        )
      }
    </Loaded>
  );
}

function Picker({
  data,
  ...props
}: ScreenProps<NominateData> & { readonly data: NominateData }): JSX.Element {
  const act = useAct(props);
  const [picked, setPicked] = useState<readonly string[]>(data.nomination.picked);
  const [q, setQ] = useState(props.search?.['q'] ?? '');
  const [note, setNote] = useState(data.nomination.note ?? '');
  const known = useMemo(
    () => new Map([...data.team, ...data.worksWith, ...data.found].map((p) => [p.personId, p])),
    [data],
  );
  const toggle = (id: string, on: boolean): void => {
    setPicked(on ? [...picked, id] : picked.filter((x) => x !== id));
  };
  const group = (title: string, list: readonly Pick[]): JSX.Element | null =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg-muted">{title}</p>
        <List>
          {list.map((p) => (
            <ListItem
              key={p.personId}
              selected={picked.includes(p.personId)}
              leading={
                <Checkbox
                  aria-label={t('reviews.pick', 'Pick {{name}}', { name: p.name })}
                  checked={picked.includes(p.personId)}
                  onCheckedChange={(on) => {
                    toggle(p.personId, on === true);
                  }}
                />
              }
              description={p.title}
            >
              {p.name}
            </ListItem>
          ))}
        </List>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('reviews.pick_to_peers', 'Pick {{min}} to {{max}} peers', {
          min: String(data.bounds.min),
          max: String(data.bounds.max),
        })}
        description={t(
          'reviews.for_approves',
          '{{cycle}} · for {{subject}}. {{approver}} approves.',
          { cycle: data.cycle, subject: data.nomination.subject, approver: data.approver },
        )}
      />
      <Refusal error={act.error} />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <SearchField
            label={t('reviews.search_everyone', 'Search everyone')}
            placeholder={t(
              'reviews.search_everyone_at_the_company',
              'Search everyone at the company',
            )}
            value={q}
            onValueChange={setQ}
            onSearch={(v) => {
              props.onFilter?.({ q: v === '' ? null : v });
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {picked.map((id) => (
              <Badge
                key={id}
                tone="accent"
                onRemove={() => {
                  toggle(id, false);
                }}
                removeLabel={t('reviews.remove', 'Remove {{value}}', {
                  value: known.get(id)?.name ?? '',
                })}
              >
                {known.get(id)?.name ??
                  data.nomination.nominees.find((n) => n.personId === id)?.name ??
                  t('reviews.someone', 'Someone')}
              </Badge>
            ))}
          </div>
          {group(t('reviews.search_results', 'Search results'), data.found)}
          {group(t('reviews.their_team', 'Their team'), data.team)}
          {group(t('reviews.people_they_work_with', 'People they work with'), data.worksWith)}
          <Field>
            <FieldLabel>
              {t('reviews.note_to_optional', 'Note to {{approver}} (optional)', {
                approver: data.approver,
              })}
            </FieldLabel>
            <Input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </Field>
          <p className="text-sm text-fg-muted">
            {t(
              'reviews.picked_you_cant_pick_each_reviewer',
              '{{length}} picked. You can’t pick {{subject}}. Each reviewer writes at most {{perReviewer}} peer reviews in a cycle.',
              {
                length: t(
                  'reviews.count_people',
                  { one: '{{count}} person', other: '{{count}} people' },
                  { count: picked.length },
                ),
                subject: data.nomination.subject,
                perReviewer: String(data.bounds.perReviewer),
              },
            )}
          </p>
          <div>
            <Button
              disabled={picked.length < data.bounds.min || picked.length > data.bounds.max}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'NominatePerformancePeers',
                  {
                    id: data.nomination.id,
                    input: { people: picked, note: note === '' ? null : note },
                  },
                  () => {
                    props.onNavigate?.('/performance/reviews');
                  },
                );
              }}
            >
              {t('reviews.send', 'Send {{length}}', {
                length: t(
                  'reviews.count_nominations',
                  { one: '{{count}} nomination', other: '{{count}} nominations' },
                  { count: picked.length },
                ),
              })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Approve({
  data,
  ...props
}: ScreenProps<NominateData> & { readonly data: NominateData }): JSX.Element {
  const act = useAct(props);
  const [declined, setDeclined] = useState<Readonly<Record<string, string>>>({});
  const [replace, setReplace] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('reviews.approve_s_peers_2', 'Approve {{subject}}’s peers?', {
          subject: data.nomination.subject,
        })}
        description={t('reviews.to_peers', '{{cycle}} · {{min}} to {{max}} peers', {
          cycle: data.cycle,
          min: String(data.bounds.min),
          max: String(data.bounds.max),
        })}
      />
      <Refusal error={act.error} />
      <Card>
        <CardContent className="flex flex-col gap-3">
          {data.nomination.nominees.map((n) => (
            <div
              key={n.personId}
              className="flex flex-col gap-2 border-b border-[var(--reach-line)] pb-3 last:border-0"
            >
              <span className="flex items-center gap-3">
                <span className="flex-1">
                  <Person name={n.name} />
                </span>
                <Field orientation="horizontal">
                  <FieldControl>
                    <Checkbox
                      checked={n.personId in declined}
                      onCheckedChange={(on) => {
                        setDeclined(
                          on === true
                            ? { ...declined, [n.personId]: '' }
                            : Object.fromEntries(
                                Object.entries(declined).filter(([x]) => x !== n.personId),
                              ),
                        );
                      }}
                    />
                  </FieldControl>
                  <FieldLabel>{t('reviews.decline', 'Decline')}</FieldLabel>
                </Field>
              </span>
              {n.personId in declined ? (
                <Field required>
                  <FieldLabel>
                    {t('reviews.why_decline', 'Why decline {{value}}', {
                      value: n.name.split(' ')[0] ?? '',
                    })}
                  </FieldLabel>
                  <Input
                    value={declined[n.personId] ?? ''}
                    onChange={(e) => {
                      setDeclined({ ...declined, [n.personId]: e.target.value });
                    }}
                  />
                </Field>
              ) : null}
            </div>
          ))}
          {Object.keys(declined).length > 0 ? (
            <Field>
              <FieldLabel>{t('reviews.replace_with', 'Replace with')}</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {[...data.team, ...data.worksWith]
                  .filter((p) => !data.nomination.nominees.some((x) => x.personId === p.personId))
                  .slice(0, 8)
                  .map((p) => (
                    <Button
                      key={p.personId}
                      size="xs"
                      variant={replace === p.personId ? 'primary' : 'secondary'}
                      onClick={() => {
                        setReplace(replace === p.personId ? null : p.personId);
                      }}
                    >
                      {p.name}
                    </Button>
                  ))}
              </div>
              <FieldDescription>
                {t(
                  'reviews.or_leave_it_to_they_get',
                  'Or leave it to {{value}}: they get an Inbox task to pick someone else.',
                  { value: data.nomination.subject.split(' ')[0] ?? '' },
                )}
              </FieldDescription>
            </Field>
          ) : null}
          <div>
            <Button
              disabled={Object.values(declined).some((r) => r.trim() === '')}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'DecidePerformanceNominations',
                  {
                    id: data.nomination.id,
                    input: {
                      decisions: data.nomination.nominees.map((n) => ({
                        personId: n.personId,
                        approve: !(n.personId in declined),
                        reason: declined[n.personId] ?? null,
                      })),
                      replacements: replace === null ? [] : [replace],
                    },
                  },
                  () => {
                    props.onNavigate?.('/performance/reviews');
                  },
                );
              }}
            >
              {Object.keys(declined).length > 0
                ? t('reviews.approve_with_changes', 'Approve with changes')
                : t('reviews.approve', 'Approve')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
