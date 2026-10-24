import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  List,
  ListItem,
  NumberField,
  Progress,
  RadioCard,
  RadioGroup,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  Textarea,
} from '@reach/ui-native';
import { locale } from '@reach/ui-native/words';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { ask, useRead, useSigned, type Load } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { sessionCode } from './session-code';
import { t as tr } from '../i18n';

/**
 * Performance on the phone (PRF-080 to PRF-089; design Mobile v2, PFM1 to
 * PFM11): my reviews, writing one question at a time with the evidence a tap
 * away, reading what was released, nominations, feedback, goals and
 * check-ins, learning, a manager's team, HR's unlocks, Ask Kithena and my
 * connected tools. Setting up cycles, templates, calibration and analytics
 * stay on the web (`desktop-only.json`).
 */

type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

const day = (iso: string | null | undefined): string =>
  iso === null || iso === undefined || iso === ''
    ? '—'
    : new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale(), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

/**
 * Rich text as lines of plain text, in one pass (form-kit's `plainLines`,
 * copied: the app imports no package of Kithena's): a tag is skipped whole,
 * an entity decoded once, and an unclosed tag ends the text.
 */
function paragraphs(html: string): string[] {
  const lines: string[] = [];
  let line = '';
  let i = 0;
  while (i < html.length) {
    const c = html.charAt(i);
    if (c === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) break;
      const tag = html
        .slice(i + 1, end)
        .trim()
        .toLowerCase();
      if (/^(\/(p|li|h[1-6])|br)\b/u.test(tag)) {
        lines.push(line);
        line = '';
      }
      i = end + 1;
    } else if (c === '&') {
      const end = html.indexOf(';', i);
      const decoded = end === -1 || end - i > 8 ? undefined : ENTITIES[html.slice(i + 1, end)];
      line += decoded ?? c;
      i = decoded === undefined ? i + 1 : end + 1;
    } else {
      line += c;
      i += 1;
    }
  }
  lines.push(line);
  return lines.map((l) => l.trim()).filter((l) => l !== '');
}

/** Stored rich text, read as plain text: markup a writer sent never reaches a reader as markup. */
const plain = (html: string): string => paragraphs(html).join('\n');

/** What is typed on a phone, as the rich text the web stores. */
const html = (text: string): string =>
  text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map(
      (l) => `<p>${l.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`,
    )
    .join('');

const KIND = (): Readonly<Record<string, string>> => ({
  self: tr('performance.screens.self_review', 'Self review'),
  manager: tr('performance.screens.manager_review_2', 'Manager review'),
  peer: tr('performance.screens.peer_review', 'Peer review'),
  upward: tr('performance.screens.upward_review', 'Upward review'),
  skip: tr('performance.screens.skip_level_review', 'Skip-level review'),
  goals: tr('performance.screens.goals_review', 'Goals review'),
});
const kindLabel = (k: string): string => KIND()[k] ?? k;

const STATE = (): Readonly<Record<string, readonly [string, Tone]>> => ({
  not_started: [tr('performance.screens.not_started', 'Not started'), 'neutral'],
  draft: [tr('performance.screens.in_progress', 'In progress'), 'warning'],
  submitted: [tr('performance.screens.submitted_2', 'Submitted'), 'success'],
  unlock: [tr('performance.screens.unlock_requested', 'Unlock requested'), 'warning'],
  unlocked: [tr('performance.screens.unlocked', 'Unlocked'), 'info'],
  released: [tr('performance.screens.released_2', 'Released'), 'accent'],
  ack: [tr('performance.screens.acknowledged_2', 'Acknowledged'), 'success'],
  detached: [tr('performance.screens.detached', 'Detached'), 'neutral'],
  overdue: [tr('performance.screens.overdue_2', 'Overdue'), 'danger'],
  declined: [tr('performance.screens.declined', 'Declined'), 'neutral'],
});

function StateBadge({ state }: { readonly state: string }): React.JSX.Element {
  const [label, tone] = STATE()[state] ?? [state, 'neutral'];
  return (
    <Badge size="sm" tone={tone}>
      {label}
    </Badge>
  );
}

/** A read's page: loading, refused, or what it answered. */
function Screen<T>({
  title,
  back,
  load,
  reload,
  what,
  children,
  foot,
}: {
  readonly title: string;
  readonly back: { label: string; onPress: () => void };
  readonly load: Load<T>;
  readonly reload: () => void;
  readonly what: string;
  readonly children: (data: T) => ReactNode;
  readonly foot?: (data: T) => ReactNode;
}): React.JSX.Element {
  if (load.status !== 'ready')
    return (
      <Page title={title} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('performance.screens.loading', 'Loading {{what}}', { what })} />
        )}
      </Page>
    );
  return (
    <Page title={title} back={back} {...(foot === undefined ? {} : { foot: foot(load.data) })}>
      {children(load.data)}
    </Page>
  );
}

/** One write, its refusal shown, the screen read again when it lands. */
function useWrite(reload: () => void): {
  readonly problem: string | null;
  readonly busy: boolean;
  readonly run: (
    operation: string,
    variables: Record<string, unknown>,
    after?: (data: unknown) => void,
  ) => void;
} {
  const signed = useSigned();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    problem,
    busy,
    run: (operation, variables, after) => {
      setBusy(true);
      setProblem(null);
      void ask(signed, operation, variables, 'performance').then((r) => {
        setBusy(false);
        if (!r.ok) {
          setProblem(r.message);
          return;
        }
        after?.(r.data);
        reload();
      });
    },
  };
}

function Problem({ text }: { readonly text: string | null }): React.JSX.Element | null {
  return text === null ? null : <Alert tone="danger">{text}</Alert>;
}

/* ---------------------------------------------------------- my reviews -- */

interface Viewer {
  readonly hr: boolean;
  readonly manager: boolean;
  readonly calibrator: boolean;
}

interface MyReviews {
  readonly tab: string;
  readonly rows: readonly {
    id: string;
    kind: string;
    title: string;
    about: string;
    cycle: string | null;
    due: string;
    state: string;
  }[];
  readonly nominations: readonly {
    id: string;
    kind: 'nominate' | 'approve';
    cycle: string;
    subject: string;
    min: number;
    max: number;
    due: string | null;
  }[];
  readonly about:
    | readonly {
        cycleId: string;
        cycle: string;
        self: { id: string; state: string; due: string } | null;
        manager: {
          id: string;
          by: string;
          released: string | null;
          acknowledged: string | null;
          writing: boolean;
        } | null;
        score: { display: string; label: string; final: boolean } | null;
        peers: { count: number; ids: readonly string[] } | null;
      }[]
    | null;
}

/** PFM1: I owe (with peers to pick or approve) and owed to me, with feedback, goals and learning a tap away. */
export function PerformanceReviews({ navigation }: PeopleScreen<'Performance'>): React.JSX.Element {
  const [tab, setTab] = useState<'write' | 'about'>('write');
  const { load, reload } = useRead<MyReviews>('PerformanceMyReviews', { tab }, 'performance');
  const viewer = useRead<Viewer>('PerformanceViewer', {}, 'performance').load;
  const roles =
    viewer.status === 'ready' ? viewer.data : { hr: false, manager: false, calibrator: false };
  return (
    <Screen
      title={tr('performance.screens.performance', 'Performance')}
      back={{ label: tr('performance.screens.more', 'More'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="your reviews"
    >
      {(data) => (
        <>
          <List>
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceFeedback');
              }}
            >
              {tr('performance.screens.feedback', 'Feedback')}
            </ListItem>
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceGoals');
              }}
            >
              {tr('performance.screens.goals', 'Goals')}
            </ListItem>
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceLearning');
              }}
            >
              {tr('performance.screens.learning', 'Learning')}
            </ListItem>
            {roles.manager || roles.hr ? (
              <ListItem
                chevron
                onPress={() => {
                  navigation.navigate('PerformanceTeam');
                }}
              >
                {tr('performance.screens.my_teams_cycles', 'My team’s cycles')}
              </ListItem>
            ) : null}
            {roles.hr ? (
              <ListItem
                chevron
                onPress={() => {
                  navigation.navigate('PerformanceUnlocks');
                }}
              >
                {tr('performance.screens.unlock_requests', 'Unlock requests')}
              </ListItem>
            ) : null}
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceAsk');
              }}
            >
              {tr('performance.screens.ask_kithena', 'Ask Kithena')}
            </ListItem>
          </List>
          <SegmentedControl
            fullWidth
            accessibilityLabel={tr('performance.screens.reviews', 'Reviews')}
            value={tab}
            onValueChange={(v) => {
              setTab(v === 'about' ? 'about' : 'write');
            }}
          >
            <SegmentedControlItem value="write">
              {tr('performance.screens.i_owe', 'I owe')}
            </SegmentedControlItem>
            <SegmentedControlItem value="about">
              {tr('performance.screens.owed_to_me', 'Owed to me')}
            </SegmentedControlItem>
          </SegmentedControl>
          {tab === 'write' ? (
            data.rows.length === 0 ? (
              <Text tone="muted">
                {tr('performance.screens.no_reviews_to_write', 'No reviews to write.')}
              </Text>
            ) : (
              <List>
                {data.rows.map((r) => (
                  <ListItem
                    key={r.id}
                    chevron
                    description={tr('performance.screens.due', '{{about}} · due {{day}}', {
                      about: r.about,
                      day: day(r.due),
                    })}
                    trailing={<StateBadge state={r.state} />}
                    onPress={() => {
                      navigation.navigate('PerformanceWrite', { id: r.id, title: r.title });
                    }}
                  >
                    {r.title}
                  </ListItem>
                ))}
              </List>
            )
          ) : null}
          {tab === 'about'
            ? (data.about ?? []).map((c) => (
                <View key={c.cycleId} className="gap-2">
                  <Heading title={c.cycle} />
                  <List>
                    {c.self === null ? null : (
                      <ListItem
                        chevron
                        description={tr('performance.screens.due_2', 'Due {{day}}', {
                          day: day(c.self.due),
                        })}
                        trailing={<StateBadge state={c.self.state} />}
                        onPress={() => {
                          if (c.self !== null)
                            navigation.navigate('PerformanceWrite', {
                              id: c.self.id,
                              title: tr('performance.screens.self_review', 'Self review'),
                            });
                        }}
                      >
                        {tr('performance.screens.your_self_review', 'Your self review')}
                      </ListItem>
                    )}
                    {c.manager === null ? null : (
                      <ListItem
                        chevron={c.manager.released !== null}
                        description={
                          c.manager.released === null
                            ? c.manager.writing
                              ? tr('performance.screens.is_writing_it', '{{by}} is writing it', {
                                  by: c.manager.by,
                                })
                              : tr(
                                  'performance.screens.submitted_not_released_yet',
                                  'Submitted, not released yet',
                                )
                            : tr('performance.screens.released', 'Released {{day}}', {
                                day: day(c.manager.released),
                              })
                        }
                        trailing={
                          c.score === null ? undefined : (
                            <Badge
                              size="sm"
                              tone="accent"
                            >{`${c.score.display} · ${c.score.label}`}</Badge>
                          )
                        }
                        onPress={() => {
                          if (c.manager?.released != null)
                            navigation.navigate('PerformanceReleased', { id: c.manager.id });
                        }}
                      >
                        {tr('performance.screens.manager_review', 'Manager review · {{by}}', {
                          by: c.manager.by,
                        })}
                      </ListItem>
                    )}
                    {c.peers === null ? null : (
                      <ListItem
                        chevron={c.peers.count > 0}
                        description={
                          c.peers.count === 0
                            ? tr(
                                'performance.screens.not_enough_peers_answered_to_show',
                                'Not enough peers answered to show them',
                              )
                            : tr('performance.screens.without_names', 'Without names')
                        }
                        onPress={() => {
                          const first = c.peers?.ids[0];
                          if (first !== undefined)
                            navigation.navigate('PerformanceReleased', { id: first });
                        }}
                      >
                        {tr('performance.screens.peer_reviews', 'Peer reviews · {{String}}', {
                          String: String(c.peers.count),
                        })}
                      </ListItem>
                    )}
                  </List>
                </View>
              ))
            : null}
          {/* Peers to pick or approve sit with what you owe, as on the web. */}
          {tab === 'write' && data.nominations.length > 0 ? (
            <>
              <Text variant="headline">
                {tr('performance.screens.peers_to_pick_or_approve', 'Peers to pick or approve')}
              </Text>
              <List>
                {data.nominations.map((n) => (
                  <ListItem
                    key={n.id}
                    chevron
                    description={`${n.cycle}${n.due === null ? '' : ` · due ${day(n.due)}`}`}
                    onPress={() => {
                      navigation.navigate('PerformanceNominate', { id: n.id });
                    }}
                  >
                    {n.kind === 'nominate'
                      ? tr(
                          'performance.screens.pick_to_peers_for',
                          'Pick {{String}} to {{String2}} peers for {{subject}}',
                          { String: String(n.min), String2: String(n.max), subject: n.subject },
                        )
                      : tr('performance.screens.approve_s_peers', 'Approve {{subject}}’s peers', {
                          subject: n.subject,
                        })}
                  </ListItem>
                ))}
              </List>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------- writing -- */

interface Option {
  readonly value: number;
  readonly label: string;
  readonly description: string | null;
}

type Question =
  | {
      id: string;
      type: 'text';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
    }
  | {
      id: string;
      type: 'scale';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
      options: readonly Option[];
    }
  | {
      id: string;
      type: 'binary';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
      yes: string;
      no: string;
    }
  | {
      id: string;
      type: 'choice';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
      multiple: boolean;
      options: readonly { id: string; label: string }[];
    }
  | {
      id: string;
      type: 'number';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
      min: number | null;
      max: number | null;
    }
  | {
      id: string;
      type: 'performance_score';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
    }
  | {
      id: string;
      type: 'goals';
      prompt: string;
      help: string | null;
      required: boolean;
      private: boolean;
      progress: number | null;
    };

type Value = string | number | boolean | readonly string[] | null;
type Answers = Readonly<Record<string, { value: Value; comment: string | null }>>;

interface Write {
  readonly review: {
    id: string;
    kind: string;
    title: string;
    revision: number;
    due: string;
    subject: { name: string };
    cycle: { names: string } | null;
    handover: { from: string; note: string | null } | null;
    unlock: { reason: string; decided: { approved: boolean } | null } | null;
    /** They stopped being the subject's manager while writing it (§8.8): `to` writes theirs. */
    formerManager?: { at: string; to: string | null } | null;
  };
  readonly form: {
    sections: readonly { id: string; title: string; questions: readonly Question[] }[];
  };
  readonly answers: Answers;
  readonly suggestions: Readonly<
    Record<string, { value: Value; reason: string; confirmed: boolean }>
  >;
  readonly missing: readonly string[];
  readonly score: { display: string; label: string } | null;
  readonly panel: {
    goals: readonly { id: string; title: string; progress: number }[];
    feedback: readonly { id: string; from: string; at: string; text: string }[];
    reviews: readonly { id: string; title: string; by: string; excerpt: string | null }[];
  };
  readonly may: { write: boolean; unlock: boolean; withdraw: boolean; decline: boolean };
  readonly scale?: readonly Option[];
  /** The company's AI switches: `writingChecks` brings Rephrase. */
  readonly ai?: Readonly<Record<string, boolean>>;
}

/** The tones an answer can be rephrased in, several at once (the server's `REPHRASE_TONES`). */
const TONES = () =>
  [
    ['clearer', tr('performance.screens.clearer', 'Clearer')],
    ['concise', tr('performance.screens.more_concise', 'More concise')],
    ['specific', tr('performance.screens.more_specific', 'More specific')],
    ['warmer', tr('performance.screens.warmer', 'Warmer')],
    ['direct', tr('performance.screens.more_direct', 'More direct')],
    ['formal', tr('performance.screens.more_formal', 'More formal')],
    ['constructive', tr('performance.screens.more_constructive', 'More constructive')],
    ['confident', tr('performance.screens.more_confident', 'More confident')],
  ] as const;

/**
 * Rephrase, as on the web: choose one tone or several, see the answer said
 * again, then use it or try again. Nothing changes until Use this.
 */
function Rephrase({
  reviewId,
  text,
  onUse,
}: {
  readonly reviewId: string;
  readonly text: string;
  readonly onUse: (html: string) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [open, setOpen] = useState(false);
  const [tones, setTones] = useState<readonly string[]>(['clearer']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (): void => {
    setBusy(true);
    setError(null);
    void ask<{ html: string }>(
      signed,
      'RephrasePerformanceAnswer',
      { id: reviewId, input: { html: html(text), tones } },
      'performance',
    ).then((r) => {
      setBusy(false);
      if (r.ok) setResult(r.data.html);
      else setError(r.message);
    });
  };
  const close = (): void => {
    setOpen(false);
    setResult(null);
    setError(null);
  };
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={text.trim() === ''}
        onPress={() => {
          setOpen(true);
        }}
      >
        {tr('performance.screens.rephrase', 'Rephrase')}
      </Button>
      {open ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {tr('performance.screens.rephrase_this_answer', 'Rephrase this answer')}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Text tone="muted">
                {tr(
                  'performance.screens.choose_one_or_more_tones_the',
                  'Choose one or more tones. The meaning and the lists stay.',
                )}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {TONES().map(([v, l]) => (
                  <Chip
                    key={v}
                    selected={tones.includes(v)}
                    onPress={() => {
                      setTones((t) => (t.includes(v) ? t.filter((x) => x !== v) : [...t, v]));
                    }}
                  >
                    {l}
                  </Chip>
                ))}
              </View>
              {result === null ? null : <Text>{plain(result)}</Text>}
              {error === null ? null : <Alert tone="danger">{error}</Alert>}
            </DialogBody>
            <DialogFooter>
              <Button onPress={close}>{tr('performance.screens.cancel', 'Cancel')}</Button>
              {result === null ? (
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={tones.length === 0}
                  onPress={run}
                >
                  {tr('performance.screens.rephrase', 'Rephrase')}
                </Button>
              ) : (
                <>
                  <Button loading={busy} disabled={tones.length === 0} onPress={run}>
                    {tr('performance.screens.try_again', 'Try again')}
                  </Button>
                  <Button
                    variant="primary"
                    onPress={() => {
                      onUse(result);
                      close();
                    }}
                  >
                    {tr('performance.screens.use_this', 'Use this')}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** PFM3, PFM3b, PFM3c: one question a screen, the evidence in a dialog, and submitting. */
export function PerformanceWrite({
  navigation,
  route,
}: PeopleScreen<'PerformanceWrite'>): React.JSX.Element {
  const { load, reload } = useRead<Write>(
    'PerformanceReview',
    { id: route.params.id },
    'performance',
  );
  const back = { label: tr('performance.screens.reviews', 'Reviews'), onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title={route.params.title} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('performance.screens.loading_the_review', 'Loading the review')} />
        )}
      </Page>
    );
  return (
    <Writing
      key={load.data.review.id}
      data={load.data}
      reload={reload}
      back={back}
      onDone={navigation.goBack}
    />
  );
}

function Writing({
  data,
  reload,
  back,
  onDone,
}: {
  readonly data: Write;
  readonly reload: () => void;
  readonly back: { label: string; onPress: () => void };
  readonly onDone: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const questions = data.form.sections.flatMap((s) =>
    s.questions.map((q) => ({ q, section: s.title })),
  );
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Answers>(data.answers);
  const [text, setText] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(data.answers).map(([k, a]) => [
        k,
        typeof a.value === 'string' ? plain(a.value) : '',
      ]),
    ),
  );
  const revision = useRef(data.review.revision);
  const [problem, setProblem] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hideName, setHideName] = useState(true);
  const [asking, setAsking] = useState<'unlock' | 'decline' | 'discard' | null>(null);
  const former = data.review.formerManager ?? null;
  const [reason, setReason] = useState('');
  const write = useWrite(reload);
  const current = questions[at];
  const save = (id: string, value: Value): void => {
    const next = { ...answers, [id]: { value, comment: answers[id]?.comment ?? null } };
    setAnswers(next);
    const patch = { [id]: next[id] };
    void ask<{ revision: number }>(
      signed,
      'SavePerformanceAnswers',
      { id: data.review.id, input: { revision: revision.current, answers: patch } },
      'performance',
    ).then((r) => {
      if (r.ok) revision.current = r.data.revision;
      else
        setProblem(
          r.code === 'STALE' || r.code === 'CONFLICT'
            ? tr(
                'performance.screens.saved_elsewhere_since_you_opened_it',
                'Saved elsewhere since you opened it: reopen the review to see both.',
              )
            : r.message,
        );
    });
  };
  const unconfirmed = Object.entries(data.suggestions)
    .filter(([, s]) => !s.confirmed)
    .map(([id]) => id);
  if (current === undefined)
    return (
      <Page title={data.review.title} back={back}>
        <Text tone="muted">
          {tr('performance.screens.this_form_has_no_questions', 'This form has no questions.')}
        </Text>
      </Page>
    );
  const q = current.q;
  const a = answers[q.id];
  const scale = q.type === 'scale' ? q.options : q.type === 'goals' ? (data.scale ?? []) : [];
  return (
    <Page
      title={data.review.title}
      back={back}
      foot={
        <View className="flex-row gap-2">
          <Button
            disabled={at === 0}
            onPress={() => {
              setAt(at - 1);
            }}
          >
            {tr('performance.screens.back', 'Back')}
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              setEvidence(true);
            }}
          >
            {tr('performance.screens.evidence', 'Evidence')}
          </Button>
          {at < questions.length - 1 ? (
            <Button
              variant="primary"
              onPress={() => {
                setAt(at + 1);
              }}
            >
              {tr('performance.screens.next', 'Next')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!data.may.write || former !== null}
              onPress={() => {
                setSubmitting(true);
              }}
            >
              {tr('performance.screens.submit', 'Submit')}
            </Button>
          )}
        </View>
      }
    >
      <Text tone="muted">
        {tr('performance.screens.of', '{{name}} · {{section}} · {{String}} of {{String2}}', {
          name: data.review.subject.name,
          section: current.section,
          String: String(at + 1),
          String2: String(questions.length),
        })}
      </Text>
      <Progress
        label={tr('performance.screens.questions', 'Questions')}
        value={((at + 1) / questions.length) * 100}
      />
      {former === null ? null : (
        <>
          <Alert tone="warning">{`You are no longer ${data.review.subject.name}’s manager, so this review cannot be submitted; ${former.to ?? 'their new manager'} writes theirs. It stays here for you to read until you delete it.`}</Alert>
          {data.may.write ? (
            <Button
              size="sm"
              variant="danger"
              onPress={() => {
                setAsking('discard');
              }}
            >
              {tr('performance.screens.delete_this_review', 'Delete this review')}
            </Button>
          ) : null}
        </>
      )}
      {data.review.handover === null ? null : (
        <Alert tone="info">
          {tr('performance.screens.handed_over_from', 'Handed over from {{from}}{{value}}', {
            from: data.review.handover.from,
            value: data.review.handover.note === null ? '' : `: ${data.review.handover.note}`,
          })}
        </Alert>
      )}
      <Problem text={problem ?? write.problem} />
      <Heading title={q.prompt} />
      {q.help === null ? null : <Text tone="muted">{q.help}</Text>}
      {q.private ? (
        <Badge tone="warning">
          {tr('performance.screens.private_hidden_from', 'Private: hidden from {{value}}', {
            value: data.review.subject.name.split(' ')[0] ?? 'them',
          })}
        </Badge>
      ) : null}
      {data.suggestions[q.id] !== undefined && data.suggestions[q.id]?.confirmed === false ? (
        <>
          <Alert tone="info">
            {tr('performance.screens.suggested_by_ai', 'Suggested by AI: {{String}}. {{value}}', {
              String: String(data.suggestions[q.id]?.value ?? ''),
              value: data.suggestions[q.id]?.reason ?? '',
            })}
          </Alert>
          {data.may.write ? (
            <Button
              size="sm"
              onPress={() => {
                write.run('ConfirmPerformanceSuggestion', { id: data.review.id, questionId: q.id });
              }}
            >
              {tr('performance.screens.confirm_the_suggestion', 'Confirm the suggestion')}
            </Button>
          ) : null}
        </>
      ) : null}
      {!data.may.write ? (
        <Text>{typeof a?.value === 'string' ? plain(a.value) : String(a?.value ?? '—')}</Text>
      ) : q.type === 'text' ? (
        <>
          <Textarea
            accessibilityLabel={q.prompt}
            value={text[q.id] ?? ''}
            onChange={(v) => {
              setText({ ...text, [q.id]: v });
            }}
            onBlur={() => {
              save(q.id, html(text[q.id] ?? ''));
            }}
          />
          {data.ai?.['writingChecks'] === true ? (
            <Rephrase
              reviewId={data.review.id}
              text={text[q.id] ?? ''}
              onUse={(rephrased) => {
                setText({ ...text, [q.id]: plain(rephrased) });
                save(q.id, rephrased);
              }}
            />
          ) : null}
        </>
      ) : q.type === 'scale' || q.type === 'goals' ? (
        <RadioGroup
          accessibilityLabel={q.prompt}
          value={typeof a?.value === 'number' ? String(a.value) : ''}
          onValueChange={(v) => {
            save(q.id, Number(v));
          }}
        >
          {scale.map((o) => (
            <RadioCard
              key={o.value}
              value={String(o.value)}
              {...(o.description === null ? {} : { description: o.description })}
            >
              {o.label}
            </RadioCard>
          ))}
        </RadioGroup>
      ) : q.type === 'binary' ? (
        <SegmentedControl
          fullWidth
          accessibilityLabel={q.prompt}
          value={a?.value === true ? 'yes' : a?.value === false ? 'no' : ''}
          onValueChange={(v) => {
            save(q.id, v === 'yes');
          }}
        >
          <SegmentedControlItem value="yes">{q.yes}</SegmentedControlItem>
          <SegmentedControlItem value="no">{q.no}</SegmentedControlItem>
        </SegmentedControl>
      ) : q.type === 'choice' ? (
        <List>
          {q.options.map((o) => {
            const picked = Array.isArray(a?.value) ? (a.value as readonly string[]) : [];
            return (
              <ListItem
                key={o.id}
                leading={
                  <Checkbox
                    accessibilityLabel={o.label}
                    checked={picked.includes(o.id)}
                    onCheckedChange={(on) => {
                      save(
                        q.id,
                        q.multiple
                          ? on
                            ? [...picked, o.id]
                            : picked.filter((x) => x !== o.id)
                          : [o.id],
                      );
                    }}
                  />
                }
              >
                {o.label}
              </ListItem>
            );
          })}
        </List>
      ) : q.type === 'number' ? (
        <NumberField
          label={q.prompt}
          value={typeof a?.value === 'number' ? a.value : null}
          onChange={(v) => {
            save(q.id, v);
          }}
          {...(q.min === null ? {} : { min: q.min })}
          {...(q.max === null ? {} : { max: q.max })}
        />
      ) : (
        <Text variant="title2">
          {data.score === null
            ? tr(
                'performance.screens.computed_once_the_ratings_are_in',
                'Computed once the ratings are in',
              )
            : `${data.score.display} · ${data.score.label}`}
        </Text>
      )}
      {data.may.unlock ? (
        <Button
          onPress={() => {
            setAsking('unlock');
          }}
        >
          {tr('performance.screens.ask_to_change_it', 'Ask to change it')}
        </Button>
      ) : null}
      {data.may.withdraw ? (
        <Button
          onPress={() => {
            write.run('WithdrawPerformanceUnlock', { id: data.review.id });
          }}
        >
          {tr('performance.screens.withdraw_the_unlock_request', 'Withdraw the unlock request')}
        </Button>
      ) : null}
      {data.may.decline ? (
        <Button
          variant="danger"
          onPress={() => {
            setAsking('decline');
          }}
        >
          {tr('performance.screens.i_cant_review_them', 'I can’t review them')}
        </Button>
      ) : null}
      {asking === 'discard' ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setAsking(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {tr('performance.screens.delete_this_review_2', 'Delete this review?')}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Text tone="muted">
                {tr(
                  'performance.screens.what_you_wrote_about_is_deleted',
                  'What you wrote about {{name}} is deleted, and nobody sees it. This cannot be undone.',
                  { name: data.review.subject.name },
                )}
              </Text>
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setAsking(null);
                }}
              >
                {tr('performance.screens.keep_it', 'Keep it')}
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  write.run('DiscardPerformanceReview', { id: data.review.id }, onDone);
                  setAsking(null);
                }}
              >
                {tr('performance.screens.delete', 'Delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {asking === null || asking === 'discard' ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setAsking(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {asking === 'unlock'
                  ? tr('performance.screens.ask_hr_to_unlock_it', 'Ask HR to unlock it')
                  : tr('performance.screens.decline_reviewing', 'Decline reviewing {{name}}?', {
                      name: data.review.subject.name,
                    })}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Textarea
                accessibilityLabel={tr('performance.screens.why', 'Why')}
                placeholder={
                  asking === 'unlock'
                    ? tr(
                        'performance.screens.what_you_need_to_change_and',
                        'What you need to change, and why',
                      )
                    : tr('performance.screens.why_for_whoever_asked', 'Why, for whoever asked')
                }
                value={reason}
                onChange={setReason}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setAsking(null);
                }}
              >
                {tr('performance.screens.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={reason.trim().length < (asking === 'unlock' ? 10 : 3)}
                onPress={() => {
                  if (asking === 'unlock')
                    write.run('RequestPerformanceUnlock', {
                      id: data.review.id,
                      input: { reason },
                    });
                  else
                    write.run(
                      'DeclinePerformanceReview',
                      { id: data.review.id, input: { reason } },
                      onDone,
                    );
                  setAsking(null);
                  setReason('');
                }}
              >
                {tr('performance.screens.send', 'Send')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {evidence ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEvidence(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr('performance.screens.evidence', 'Evidence')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <View className="gap-3">
                {data.panel.goals.length === 0 ? null : (
                  <Heading title={tr('performance.screens.goals', 'Goals')} />
                )}
                {data.panel.goals.map((g) => (
                  <Progress
                    key={g.id}
                    label={`${g.title}: ${String(g.progress)}%`}
                    value={g.progress}
                  />
                ))}
                {data.panel.feedback.length === 0 ? null : (
                  <Heading title={tr('performance.screens.feedback', 'Feedback')} />
                )}
                {data.panel.feedback.slice(0, 5).map((f) => (
                  <Text key={f.id}>{`${f.from}, ${day(f.at)}: ${plain(f.text)}`}</Text>
                ))}
                {data.panel.reviews.length === 0 ? null : (
                  <Heading title={tr('performance.screens.other_reviews', 'Other reviews')} />
                )}
                {data.panel.reviews.map((r) => (
                  <Text
                    key={r.id}
                  >{`${r.title} · ${r.by}${r.excerpt === null ? '' : `: ${plain(r.excerpt)}`}`}</Text>
                ))}
                {data.panel.goals.length +
                  data.panel.feedback.length +
                  data.panel.reviews.length ===
                0 ? (
                  <Text tone="muted">
                    {tr(
                      'performance.screens.nothing_yet_for_this_cycle',
                      'Nothing yet for this cycle.',
                    )}
                  </Text>
                ) : null}
              </View>
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setEvidence(false);
                }}
              >
                {tr('performance.screens.close', 'Close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {submitting ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setSubmitting(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {tr('performance.screens.submit_your', 'Submit your {{toLowerCase}}?', {
                  toLowerCase: kindLabel(data.review.kind).toLowerCase(),
                })}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <View className="gap-3">
                {data.score === null ? null : (
                  <Text>
                    {tr(
                      'performance.screens.performance_score',
                      'Performance score {{display}} · {{label}}',
                      { display: data.score.display, label: data.score.label },
                    )}
                  </Text>
                )}
                {data.missing.length === 0 ? null : (
                  <Alert tone="warning">
                    {tr(
                      'performance.screens.required_question_still_need_an_answer',
                      {
                        one: '{{count}} required question still need an answer.',
                        other: '{{count}} required questions still need an answer.',
                      },
                      { count: data.missing.length },
                    )}
                  </Alert>
                )}
                {unconfirmed.length === 0 ? null : (
                  <Text>
                    {tr(
                      'performance.screens.submitting_confirms_the_ai_suggestion_as',
                      {
                        one: 'Submitting confirms the {{count}} AI suggestion as your own answer.',
                        other:
                          'Submitting confirms the {{count}} AI suggestions as your own answer.',
                      },
                      { count: unconfirmed.length },
                    )}
                  </Text>
                )}
                {data.review.cycle?.names === 'writer' ? (
                  <Switch
                    checked={!hideName}
                    onCheckedChange={(on) => {
                      setHideName(!on);
                    }}
                  >
                    {tr('performance.screens.show_my_name_to', 'Show my name to {{value}}', {
                      value: data.review.subject.name.split(' ')[0] ?? 'them',
                    })}
                  </Switch>
                ) : null}
              </View>
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setSubmitting(false);
                }}
              >
                {tr('performance.screens.not_yet', 'Not yet')}
              </Button>
              <Button
                variant="primary"
                disabled={write.busy}
                onPress={() => {
                  write.run(
                    'SubmitPerformanceReview',
                    {
                      id: data.review.id,
                      input: {
                        confidential: data.review.cycle?.names === 'writer' ? hideName : null,
                        confirm: unconfirmed,
                      },
                    },
                    () => {
                      setSubmitting(false);
                      onDone();
                    },
                  );
                }}
              >
                {tr('performance.screens.submit', 'Submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Page>
  );
}

interface Released {
  readonly review: {
    id: string;
    title: string;
    by: string | null;
    released: string | null;
    acknowledged: { at: string; comment: string | null } | null;
    cycle: string | null;
  };
  readonly definition: {
    sections: readonly { id: string; title: string; questions: readonly Question[] }[];
  };
  readonly answers: Answers;
  readonly score: { display: string; label: string; final: boolean } | null;
  readonly may: { acknowledge: boolean; comment: boolean };
}

/** PFM2: a released review, read and acknowledged. */
export function PerformanceReleased({
  navigation,
  route,
}: PeopleScreen<'PerformanceReleased'>): React.JSX.Element {
  const { load, reload } = useRead<Released>(
    'PerformanceReleased',
    { id: route.params.id },
    'performance',
  );
  const write = useWrite(reload);
  const [comment, setComment] = useState('');
  return (
    <Screen
      title={tr('performance.screens.your_review', 'Your review')}
      back={{ label: tr('performance.screens.reviews', 'Reviews'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the review"
    >
      {(data) => (
        <>
          <Text tone="muted">{`${data.review.title}${data.review.by === null ? '' : ` · ${data.review.by}`} · ${data.review.cycle ?? ''}`}</Text>
          {data.score === null ? null : (
            <Text variant="title2">{`${data.score.display} · ${data.score.label}${data.score.final ? '' : tr('performance.screens.not_final', ' (not final)')}`}</Text>
          )}
          {data.definition.sections.map((s) => (
            <View key={s.id} className="gap-2">
              <Heading title={s.title} />
              {s.questions.map((q) => {
                const v = data.answers[q.id]?.value;
                const shown =
                  q.type === 'scale'
                    ? (q.options.find((o) => o.value === v)?.label ?? '—')
                    : q.type === 'binary'
                      ? v === true
                        ? q.yes
                        : v === false
                          ? q.no
                          : '—'
                      : typeof v === 'string'
                        ? plain(v)
                        : v === null || v === undefined
                          ? '—'
                          : String(v);
                return (
                  <View key={q.id} className="gap-1">
                    <Text variant="headline">{q.prompt}</Text>
                    <Text>{shown}</Text>
                  </View>
                );
              })}
            </View>
          ))}
          <Problem text={write.problem} />
          {data.review.acknowledged !== null ? (
            <Alert tone="success">
              {tr('performance.screens.acknowledged', 'Acknowledged {{day}}', {
                day: day(data.review.acknowledged.at),
              })}
            </Alert>
          ) : data.may.acknowledge ? (
            <>
              {data.may.comment ? (
                <Field>
                  <FieldLabel>
                    {tr('performance.screens.a_response_optional', 'A response (optional)')}
                  </FieldLabel>
                  <Textarea
                    value={comment}
                    onChange={setComment}
                    accessibilityLabel={tr('performance.screens.your_response', 'Your response')}
                  />
                </Field>
              ) : null}
              <Button
                variant="primary"
                disabled={write.busy}
                onPress={() => {
                  write.run('AcknowledgePerformanceReview', {
                    id: data.review.id,
                    input: { comment: comment.trim() === '' ? null : comment },
                  });
                }}
              >
                {tr('performance.screens.ive_read_this', 'I’ve read this')}
              </Button>
              <Text variant="footnote" tone="muted">
                {tr(
                  'performance.screens.acknowledging_is_not_agreeing',
                  'Acknowledging is not agreeing.',
                )}
              </Text>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

interface Pick {
  readonly personId: string;
  readonly name: string;
  readonly title: string;
}

interface Nominate {
  readonly nomination: {
    id: string;
    state: string;
    subject: string;
    picked: readonly string[];
    nominees: readonly { personId: string; name: string; state: string }[];
  };
  readonly bounds: { min: number; max: number };
  readonly approver: string;
  readonly team: readonly Pick[];
  readonly worksWith: readonly Pick[];
  readonly found: readonly Pick[];
  readonly cycle: string;
}

/** PFM4, PFM4b: pick peers, or approve the ones picked. */
export function PerformanceNominate({
  navigation,
  route,
}: PeopleScreen<'PerformanceNominate'>): React.JSX.Element {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { load, reload } = useRead<Nominate>(
    'PerformancePicker',
    { id: route.params.id, q: search === '' ? null : search },
    'performance',
  );
  const write = useWrite(reload);
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [declined, setDeclined] = useState<readonly string[]>([]);
  return (
    <Screen
      title={tr('performance.screens.nominations', 'Nominations')}
      back={{ label: tr('performance.screens.reviews', 'Reviews'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the nomination"
    >
      {(data) => {
        const chosen = picked ?? data.nomination.picked;
        const approving = data.nomination.state === 'waiting';
        if (approving)
          return (
            <>
              <Text>
                {tr(
                  'performance.screens.s_peers_for_untick_anyone_who',
                  '{{subject}}’s peers for {{cycle}}. Untick anyone who should not review them.',
                  { subject: data.nomination.subject, cycle: data.cycle },
                )}
              </Text>
              <Problem text={write.problem} />
              <List>
                {data.nomination.nominees.map((n) => (
                  <ListItem
                    key={n.personId}
                    leading={
                      <Checkbox
                        accessibilityLabel={n.name}
                        checked={!declined.includes(n.personId)}
                        onCheckedChange={(on) => {
                          setDeclined(
                            on
                              ? declined.filter((x) => x !== n.personId)
                              : [...declined, n.personId],
                          );
                        }}
                      />
                    }
                  >
                    {n.name}
                  </ListItem>
                ))}
              </List>
              <Button
                variant="primary"
                disabled={write.busy}
                onPress={() => {
                  write.run(
                    'DecidePerformanceNominations',
                    {
                      id: data.nomination.id,
                      input: {
                        decisions: data.nomination.nominees.map((n) => ({
                          personId: n.personId,
                          approve: !declined.includes(n.personId),
                          reason: null,
                        })),
                        replacements: [],
                      },
                    },
                    navigation.goBack,
                  );
                }}
              >
                {tr('performance.screens.approve', 'Approve')}
              </Button>
            </>
          );
        const rows = [...data.team, ...data.worksWith, ...data.found].filter(
          (p, i, all) => all.findIndex((x) => x.personId === p.personId) === i,
        );
        return (
          <>
            <Text>
              {tr(
                'performance.screens.pick_to_peers_to_review_approves',
                'Pick {{String}} to {{String2}} peers to review {{subject}}. {{approver}} approves them.',
                {
                  String: String(data.bounds.min),
                  String2: String(data.bounds.max),
                  subject: data.nomination.subject,
                  approver: data.approver,
                },
              )}
            </Text>
            <SearchField
              value={q}
              onValueChange={setQ}
              onSearch={setSearch}
              label={tr('performance.screens.search_people', 'Search people')}
              placeholder={tr('performance.screens.search_everyone', 'Search everyone')}
            />
            <Problem text={write.problem} />
            <List>
              {rows.map((p) => (
                <ListItem
                  key={p.personId}
                  description={p.title}
                  leading={
                    <Checkbox
                      accessibilityLabel={p.name}
                      checked={chosen.includes(p.personId)}
                      onCheckedChange={(on) => {
                        setPicked(
                          on ? [...chosen, p.personId] : chosen.filter((x) => x !== p.personId),
                        );
                      }}
                    />
                  }
                >
                  {p.name}
                </ListItem>
              ))}
            </List>
            <Button
              variant="primary"
              disabled={
                write.busy || chosen.length < data.bounds.min || chosen.length > data.bounds.max
              }
              onPress={() => {
                write.run(
                  'NominatePerformancePeers',
                  { id: data.nomination.id, input: { people: chosen, note: null } },
                  navigation.goBack,
                );
              }}
            >
              {tr('performance.screens.send_for_approval', 'Send {{String}} for approval', {
                String: String(chosen.length),
              })}
            </Button>
          </>
        );
      }}
    </Screen>
  );
}

/* ------------------------------------------------------------ feedback -- */

interface Feedback {
  readonly received: readonly {
    id: string;
    from: string | null;
    kind: string;
    body: string;
    at: string;
  }[];
  readonly sent: readonly {
    id: string;
    to: string;
    kind: string;
    body: string;
    at: string;
    undone: boolean;
    undoUntil: string | null;
  }[];
  readonly open: readonly {
    id: string;
    from: string;
    about: string;
    aboutId: string;
    question: string | null;
  }[];
  readonly settings: { names: string; audiences: readonly string[]; on: boolean };
}

/** PFM5: what reached me, what I sent, requests, and giving. */
export function PerformanceFeedback({
  navigation,
}: PeopleScreen<'PerformanceFeedback'>): React.JSX.Element {
  const [tab, setTab] = useState<'received' | 'sent' | 'requests'>('received');
  const { load, reload } = useRead<Feedback>('PerformanceFeedback', { tab }, 'performance');
  const write = useWrite(reload);
  return (
    <Screen
      title={tr('performance.screens.feedback', 'Feedback')}
      back={{
        label: tr('performance.screens.performance', 'Performance'),
        onPress: navigation.goBack,
      }}
      load={load}
      reload={reload}
      what="feedback"
    >
      {(data) => (
        <>
          {data.settings.on ? (
            <View className="flex-row gap-2">
              <Button
                variant="primary"
                onPress={() => {
                  navigation.navigate('PerformanceGive', {});
                }}
              >
                {tr('performance.screens.give_feedback', 'Give feedback')}
              </Button>
              <Button
                onPress={() => {
                  navigation.navigate('PerformanceRequest');
                }}
              >
                {tr('performance.screens.request', 'Request')}
              </Button>
            </View>
          ) : (
            <Alert tone="info">
              {tr(
                'performance.screens.feedback_is_off_at_this_company',
                'Feedback is off at this company.',
              )}
            </Alert>
          )}
          <SegmentedControl
            fullWidth
            accessibilityLabel={tr('performance.screens.feedback', 'Feedback')}
            value={tab}
            onValueChange={(v) => {
              setTab(v === 'sent' ? 'sent' : v === 'requests' ? 'requests' : 'received');
            }}
          >
            <SegmentedControlItem value="received">
              {tr('performance.screens.received', 'Received')}
            </SegmentedControlItem>
            <SegmentedControlItem value="sent">
              {tr('performance.screens.sent', 'Sent')}
            </SegmentedControlItem>
            <SegmentedControlItem value="requests">
              {tr('performance.screens.requests', 'Requests')}
            </SegmentedControlItem>
          </SegmentedControl>
          <Problem text={write.problem} />
          {tab === 'received' ? (
            data.received.length === 0 ? (
              <Text tone="muted">
                {tr(
                  'performance.screens.feedback_you_receive_shows_here',
                  'Feedback you receive shows here.',
                )}
              </Text>
            ) : (
              data.received.map((f) => (
                <View key={f.id} className="gap-1">
                  <Text variant="headline">{`${f.from ?? tr('performance.screens.someone_at_the_company', 'Someone at the company')} · ${day(f.at)}`}</Text>
                  <Text>{plain(f.body)}</Text>
                </View>
              ))
            )
          ) : null}
          {tab === 'sent'
            ? data.sent.map((f) => (
                <View key={f.id} className="gap-1">
                  <Text variant="headline">
                    {tr('performance.screens.to', 'To {{to}} · {{day}}', {
                      to: f.to,
                      day: day(f.at),
                    })}
                  </Text>
                  <Text tone={f.undone ? 'muted' : undefined}>{plain(f.body)}</Text>
                  {!f.undone && f.undoUntil !== null && Date.parse(f.undoUntil) > Date.now() ? (
                    <Button
                      size="sm"
                      onPress={() => {
                        write.run('UndoPerformanceFeedback', { id: f.id });
                      }}
                    >
                      {tr('performance.screens.delete', 'Delete')}
                    </Button>
                  ) : null}
                </View>
              ))
            : null}
          {tab === 'requests' ? (
            data.open.length === 0 ? (
              <Text tone="muted">
                {tr('performance.screens.nobody_is_waiting_on_you', 'Nobody is waiting on you.')}
              </Text>
            ) : (
              <List>
                {data.open.map((r) => (
                  <ListItem
                    key={r.id}
                    chevron
                    description={
                      r.question ??
                      tr('performance.screens.about', 'About {{about}}', { about: r.about })
                    }
                    trailing={
                      <Button
                        size="sm"
                        onPress={() => {
                          write.run('DeclinePerformanceRequest', { id: r.id });
                        }}
                      >
                        {tr('performance.screens.decline', 'Decline')}
                      </Button>
                    }
                    onPress={() => {
                      navigation.navigate('PerformanceGive', {
                        to: r.aboutId,
                        name: r.about,
                        requestId: r.id,
                      });
                    }}
                  >
                    {tr('performance.screens.asks_about', '{{from}} asks about {{about}}', {
                      from: r.from,
                      about: r.about,
                    })}
                  </ListItem>
                ))}
              </List>
            )
          ) : null}
        </>
      )}
    </Screen>
  );
}

/** Search Performance's directory and pick one person. */
function PickPerson({
  onPick,
  label,
}: {
  readonly onPick: (p: Pick) => void;
  readonly label: string;
}): React.JSX.Element {
  const signed = useSigned();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<readonly Pick[]>([]);
  return (
    <>
      <SearchField
        value={q}
        onValueChange={setQ}
        label={label}
        placeholder={tr('performance.screens.type_a_name', 'Type a name')}
        onSearch={(v) => {
          void ask<{ rows: readonly Pick[] }>(
            signed,
            'PerformanceDirectory',
            { q: v },
            'performance',
          ).then((r) => {
            if (r.ok) setFound(r.data.rows);
          });
        }}
      />
      <List>
        {found.map((p) => (
          <ListItem
            key={p.personId}
            chevron
            description={p.title}
            onPress={() => {
              onPick(p);
            }}
          >
            {p.name}
          </ListItem>
        ))}
      </List>
    </>
  );
}

/** PFM5b–5d: to whom, what, and who sees it. */
export function PerformanceGive({
  navigation,
  route,
}: PeopleScreen<'PerformanceGive'>): React.JSX.Element {
  const signed = useSigned();
  const settings = useRead<Feedback>(
    'PerformanceFeedback',
    { tab: 'received' },
    'performance',
  ).load;
  const [to, setTo] = useState<{ id: string; name: string } | null>(
    route.params.to === undefined
      ? null
      : { id: route.params.to, name: route.params.name ?? 'them' },
  );
  const [body, setBody] = useState('');
  const [praise, setPraise] = useState(false);
  const [showName, setShowName] = useState(true);
  const [audience, setAudience] = useState('recipient_manager');
  const [problem, setProblem] = useState<string | null>(null);
  const names = settings.status === 'ready' ? settings.data.settings.names : 'writer';
  const first = to?.name.split(' ')[0] ?? 'them';
  return (
    <Page
      title={tr('performance.screens.give_feedback', 'Give feedback')}
      back={{ label: tr('performance.screens.feedback', 'Feedback'), onPress: navigation.goBack }}
    >
      {to === null ? (
        <PickPerson
          label={tr('performance.screens.who_is_it_for', 'Who is it for?')}
          onPick={(p) => {
            setTo({ id: p.personId, name: p.name });
          }}
        />
      ) : (
        <>
          <Text variant="headline">
            {tr('performance.screens.to_2', 'To {{name}}', { name: to.name })}
          </Text>
          <SegmentedControl
            fullWidth
            accessibilityLabel={tr('performance.screens.kind', 'Kind')}
            value={praise ? 'praise' : 'feedback'}
            onValueChange={(v) => {
              setPraise(v === 'praise');
            }}
          >
            <SegmentedControlItem value="feedback">
              {tr('performance.screens.feedback', 'Feedback')}
            </SegmentedControlItem>
            <SegmentedControlItem value="praise">
              {tr('performance.screens.praise', 'Praise')}
            </SegmentedControlItem>
          </SegmentedControl>
          <Textarea
            accessibilityLabel={tr('performance.screens.your_feedback', 'Your feedback')}
            value={body}
            onChange={setBody}
          />
          {praise ? (
            <Text tone="muted">
              {tr(
                'performance.screens.praise_is_shown_with_your_name',
                'Praise is shown with your name.',
              )}
            </Text>
          ) : (
            <>
              {names === 'writer' ? (
                <Switch checked={showName} onCheckedChange={setShowName}>
                  {tr('performance.screens.show_my_name', 'Show my name')}
                </Switch>
              ) : null}
              <RadioGroup
                accessibilityLabel={tr('performance.screens.who_sees_it', 'Who sees it')}
                value={audience}
                onValueChange={setAudience}
              >
                <RadioCard value="recipient_manager">
                  {tr('performance.screens.and_their_manager', '{{first}} and their manager', {
                    first,
                  })}
                </RadioCard>
                <RadioCard value="manager_only">
                  {tr('performance.screens.only_s_manager', 'Only {{first}}’s manager', { first })}
                </RadioCard>
              </RadioGroup>
            </>
          )}
          <Problem text={problem} />
          <Button
            variant="primary"
            disabled={body.trim() === ''}
            onPress={() => {
              void ask(
                signed,
                'GivePerformanceFeedback',
                {
                  input: {
                    to: to.id,
                    kind: praise ? 'praise' : 'feedback',
                    body: html(body),
                    audience: praise ? 'everyone' : audience,
                    showName: praise || names === 'always' || (names === 'writer' && showName),
                    value: null,
                    templateId: null,
                    answers: null,
                    requestId: route.params.requestId ?? null,
                  },
                },
                'performance',
              ).then((r) => {
                if (r.ok) navigation.goBack();
                else setProblem(r.message);
              });
            }}
          >
            {tr('performance.screens.send', 'Send')}
          </Button>
        </>
      )}
    </Page>
  );
}

/** PFM5d: ask people for feedback about me. */
export function PerformanceRequest({
  navigation,
}: PeopleScreen<'PerformanceRequest'>): React.JSX.Element {
  const signed = useSigned();
  const [people, setPeople] = useState<readonly Pick[]>([]);
  const [question, setQuestion] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Page
      title={tr('performance.screens.request_feedback', 'Request feedback')}
      back={{ label: tr('performance.screens.feedback', 'Feedback'), onPress: navigation.goBack }}
    >
      <PickPerson
        label={tr('performance.screens.who_to_ask', 'Who to ask')}
        onPick={(p) => {
          if (!people.some((x) => x.personId === p.personId))
            setPeople([...people, p].slice(0, 10));
        }}
      />
      {people.length === 0 ? null : (
        <Text>
          {tr('performance.screens.asking', 'Asking {{join}}', {
            join: people.map((p) => p.name).join(', '),
          })}
        </Text>
      )}
      <Field>
        <FieldLabel>{tr('performance.screens.your_question', 'Your question')}</FieldLabel>
        <Textarea
          accessibilityLabel={tr('performance.screens.your_question', 'Your question')}
          value={question}
          onChange={setQuestion}
        />
      </Field>
      <Problem text={problem} />
      <Button
        variant="primary"
        disabled={people.length === 0}
        onPress={() => {
          void ask(
            signed,
            'RequestPerformanceFeedback',
            {
              input: {
                to: people.map((p) => p.personId),
                about: null,
                question: question.trim() === '' ? null : question,
                templateId: null,
                topic: null,
                due: null,
              },
            },
            'performance',
          ).then((r) => {
            if (r.ok) navigation.goBack();
            else setProblem(r.message);
          });
        }}
      >
        {tr('performance.screens.send_requests', 'Send requests')}
      </Button>
    </Page>
  );
}

/* --------------------------------------------------------------- goals -- */

const CONFIDENCE = (): Readonly<Record<string, readonly [string, Tone]>> => ({
  on_track: [tr('performance.screens.on_track', 'On track'), 'success'],
  at_risk: [tr('performance.screens.at_risk', 'At risk'), 'warning'],
  off_track: [tr('performance.screens.off_track', 'Off track'), 'danger'],
  done: [tr('performance.screens.done_2', 'Done'), 'accent'],
});

interface Goals {
  readonly rows: readonly {
    id: string;
    title: string;
    owner: string;
    progress: number;
    confidence: string;
    status: string;
  }[];
  readonly due: readonly { id: string; title: string }[];
}

/** PFM6: my goals and my team's, each with its progress. */
export function PerformanceGoals({
  navigation,
}: PeopleScreen<'PerformanceGoals'>): React.JSX.Element {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const { load, reload } = useRead<Goals>(
    'PerformanceGoals',
    { tab: 'list', scope },
    'performance',
  );
  return (
    <Screen
      title={tr('performance.screens.goals', 'Goals')}
      back={{
        label: tr('performance.screens.performance', 'Performance'),
        onPress: navigation.goBack,
      }}
      load={load}
      reload={reload}
      what="goals"
    >
      {(data) => (
        <>
          <SegmentedControl
            fullWidth
            accessibilityLabel={tr('performance.screens.whose', 'Whose')}
            value={scope}
            onValueChange={(v) => {
              setScope(v === 'team' ? 'team' : 'mine');
            }}
          >
            <SegmentedControlItem value="mine">
              {tr('performance.screens.mine', 'Mine')}
            </SegmentedControlItem>
            <SegmentedControlItem value="team">
              {tr('performance.screens.my_team', 'My team')}
            </SegmentedControlItem>
          </SegmentedControl>
          {data.due.length === 0 ? null : (
            <Alert tone="info">
              {tr('performance.screens.check_in_due', 'Check-in due: {{join}}', {
                join: data.due.map((g) => g.title).join(', '),
              })}
            </Alert>
          )}
          {data.rows.length === 0 ? (
            <Text tone="muted">
              {tr('performance.screens.no_goals_for_this_period', 'No goals for this period.')}
            </Text>
          ) : (
            <List>
              {data.rows.map((g) => {
                const [label, tone] = CONFIDENCE()[g.confidence] ?? [
                  tr('performance.screens.on_track', 'On track'),
                  'success',
                ];
                return (
                  <ListItem
                    key={g.id}
                    chevron
                    description={`${g.owner} · ${String(g.progress)}%`}
                    trailing={
                      <Badge size="sm" tone={tone}>
                        {label}
                      </Badge>
                    }
                    onPress={() => {
                      navigation.navigate('PerformanceGoal', { id: g.id, title: g.title });
                    }}
                  >
                    {g.title}
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      )}
    </Screen>
  );
}

interface Goal {
  readonly goal: {
    id: string;
    title: string;
    owner: string;
    progress: number;
    confidence: string;
    /** Who sees it (§14.2): private to its owner and their managers until shared. */
    visibility: string;
    keyResults: readonly {
      id: string;
      title: string;
      measure: string;
      start: number;
      target: number;
      current: number;
      unit: string | null;
      progress: number;
    }[];
  };
  readonly checkIns: readonly { at: string; by: string; confidence: string; note: string | null }[];
  readonly may: { checkIn: boolean; edit: boolean };
}

/** PFM6b: a goal, its key results, and a check-in. */
export function PerformanceGoal({
  navigation,
  route,
}: PeopleScreen<'PerformanceGoal'>): React.JSX.Element {
  const { load, reload } = useRead<Goal>('PerformanceGoal', { id: route.params.id }, 'performance');
  const write = useWrite(reload);
  const [values, setValues] = useState<Record<string, number>>({});
  const [confidence, setConfidence] = useState('on_track');
  const [note, setNote] = useState('');
  return (
    <Screen
      title={route.params.title}
      back={{ label: tr('performance.screens.goals', 'Goals'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the goal"
    >
      {(data) => (
        <>
          <Progress
            label={tr('performance.screens.done', '{{String}}% done', {
              String: String(data.goal.progress),
            })}
            value={data.goal.progress}
          />
          {data.goal.keyResults.map((k) => (
            <View key={k.id} className="gap-1">
              <Text variant="headline">{k.title}</Text>
              {data.may.checkIn ? (
                k.measure === 'done' ? (
                  <Switch
                    checked={(values[k.id] ?? k.current) >= 1}
                    onCheckedChange={(on) => {
                      setValues({ ...values, [k.id]: on ? 1 : 0 });
                    }}
                  >
                    {tr('performance.screens.done_2', 'Done')}
                  </Switch>
                ) : (
                  <NumberField
                    label={tr(
                      'performance.screens.now_from_to',
                      'Now, from {{String}} to {{String2}}{{value}}',
                      {
                        String: String(k.start),
                        String2: String(k.target),
                        value: k.unit === null ? '' : ` ${k.unit}`,
                      },
                    )}
                    value={values[k.id] ?? k.current}
                    onChange={(v) => {
                      if (v !== null) setValues({ ...values, [k.id]: v });
                    }}
                  />
                )
              ) : (
                <Progress
                  label={tr('performance.screens.of_2', '{{String}} of {{String2}}', {
                    String: String(k.current),
                    String2: String(k.target),
                  })}
                  value={k.progress}
                />
              )}
            </View>
          ))}
          <Problem text={write.problem} />
          {data.may.checkIn ? (
            <>
              <SegmentedControl
                fullWidth
                accessibilityLabel={tr('performance.screens.confidence', 'Confidence')}
                value={confidence}
                onValueChange={setConfidence}
              >
                <SegmentedControlItem value="on_track">
                  {tr('performance.screens.on_track', 'On track')}
                </SegmentedControlItem>
                <SegmentedControlItem value="at_risk">
                  {tr('performance.screens.at_risk', 'At risk')}
                </SegmentedControlItem>
                <SegmentedControlItem value="off_track">
                  {tr('performance.screens.off_track', 'Off track')}
                </SegmentedControlItem>
              </SegmentedControl>
              <Textarea
                accessibilityLabel={tr('performance.screens.note', 'Note')}
                placeholder={tr(
                  'performance.screens.what_changed_optional',
                  'What changed (optional)',
                )}
                value={note}
                onChange={setNote}
              />
              <Button
                variant="primary"
                disabled={write.busy}
                onPress={() => {
                  write.run(
                    'CheckInPerformanceGoal',
                    {
                      id: data.goal.id,
                      input: {
                        values: Object.fromEntries(
                          data.goal.keyResults.map((k) => [k.id, values[k.id] ?? k.current]),
                        ),
                        confidence,
                        note: note.trim() === '' ? null : note,
                      },
                    },
                    () => {
                      setNote('');
                    },
                  );
                }}
              >
                {tr('performance.screens.check_in', 'Check in')}
              </Button>
            </>
          ) : null}
          {data.may.edit ? (
            <>
              <Heading title={tr('performance.screens.who_can_see_it', 'Who can see it')} />
              <SegmentedControl
                fullWidth
                accessibilityLabel={tr('performance.screens.who_can_see_it', 'Who can see it')}
                value={data.goal.visibility}
                onValueChange={(visibility) => {
                  write.run('SetPerformanceGoalVisibility', {
                    id: data.goal.id,
                    input: { visibility },
                  });
                }}
              >
                <SegmentedControlItem value="owner">
                  {tr('performance.screens.managers', 'Managers')}
                </SegmentedControlItem>
                <SegmentedControlItem value="team">
                  {tr('performance.screens.team', 'Team')}
                </SegmentedControlItem>
                <SegmentedControlItem value="everyone">
                  {tr('performance.screens.everyone', 'Everyone')}
                </SegmentedControlItem>
              </SegmentedControl>
            </>
          ) : null}
          {data.checkIns.length === 0 ? null : (
            <Heading title={tr('performance.screens.check_ins', 'Check-ins')} />
          )}
          {data.checkIns.slice(0, 6).map((c) => (
            <Text
              key={c.at}
            >{`${day(c.at)} · ${c.by} · ${(CONFIDENCE()[c.confidence] ?? ['On track'])[0]}${c.note === null ? '' : `: ${c.note}`}`}</Text>
          ))}
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------ learning -- */

interface Learning {
  readonly assigned: readonly {
    id: string;
    itemId: string;
    title: string;
    kind: string;
    why: string;
    due: string | null;
    state: string;
    progress: string | null;
  }[];
}

const LEARNING = (): Readonly<Record<string, readonly [string, Tone]>> => ({
  not_started: [tr('performance.screens.assigned', 'Assigned'), 'neutral'],
  in_progress: [tr('performance.screens.in_progress', 'In progress'), 'warning'],
  done: [tr('performance.screens.completed', 'Completed'), 'success'],
  going: [tr('performance.screens.going', 'Going'), 'info'],
});

/** PFM7: what is assigned to me, and the door code of a session. */
export function PerformanceLearning({
  navigation,
}: PeopleScreen<'PerformanceLearning'>): React.JSX.Element {
  const { load, reload } = useRead<Learning>(
    'PerformanceLearning',
    { tab: 'assigned' },
    'performance',
  );
  const write = useWrite(reload);
  const [code, setCode] = useState('');
  const [scanned, setScanned] = useState<string | null>(null);
  return (
    <Screen
      title={tr('performance.screens.learning', 'Learning')}
      back={{
        label: tr('performance.screens.performance', 'Performance'),
        onPress: navigation.goBack,
      }}
      load={load}
      reload={reload}
      what="your learning"
    >
      {(data) => (
        <>
          {data.assigned.length === 0 ? (
            <Text tone="muted">
              {tr('performance.screens.nothing_assigned_to_you', 'Nothing assigned to you.')}
            </Text>
          ) : (
            <List>
              {data.assigned.map((a) => {
                const [label, tone] = LEARNING()[a.state] ?? [a.state, 'neutral'];
                return (
                  <ListItem
                    key={a.id}
                    chevron
                    description={`${a.kind}${a.due === null ? '' : ` · due ${day(a.due)}`}`}
                    trailing={
                      <Badge size="sm" tone={tone}>
                        {label}
                      </Badge>
                    }
                    onPress={() => {
                      navigation.navigate('PerformanceItem', { id: a.itemId, title: a.title });
                    }}
                  >
                    {a.title}
                  </ListItem>
                );
              })}
            </List>
          )}
          <Heading title={tr('performance.screens.at_a_session', 'At a session')} />
          <Button
            variant="primary"
            onPress={() => {
              navigation.navigate('PerformanceScan');
            }}
          >
            {tr('performance.screens.scan_the_code_at_the_door', 'Scan the code at the door')}
          </Button>
          <Field>
            <FieldLabel>
              {tr(
                'performance.screens.or_type_the_code_shown_there',
                'Or type the code shown there',
              )}
            </FieldLabel>
            <Input
              value={code}
              onChange={setCode}
              accessibilityLabel={tr('performance.screens.session_code', 'Session code')}
            />
          </Field>
          <Problem text={write.problem} />
          {scanned === null ? null : <Alert tone="success">{scanned}</Alert>}
          <Button
            disabled={code.trim().length < 4 || write.busy}
            onPress={() => {
              write.run('ScanPerformanceSession', { input: { code: code.trim() } }, () => {
                setScanned(
                  tr(
                    'performance.screens.you_are_marked_as_attending',
                    'You are marked as attending.',
                  ),
                );
                setCode('');
              });
            }}
          >
            {tr('performance.screens.im_here', 'I’m here')}
          </Button>
        </>
      )}
    </Screen>
  );
}

/**
 * PFM7c: the code at the door, read with the camera (PRD §15.5): the first QR
 * it sees marks the learner as attending, as a typed code does. The camera is
 * asked for here, the first time, and nothing it sees is kept.
 */
export function PerformanceScan({
  navigation,
}: PeopleScreen<'PerformanceScan'>): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const write = useWrite(() => undefined);
  const [done, setDone] = useState(false);
  // One read at a time: the camera reports the same code many times a second.
  const reading = useRef(false);
  const onScan = (scan: BarcodeScanningResult): void => {
    if (reading.current || done) return;
    reading.current = true;
    write.run('ScanPerformanceSession', { input: { code: sessionCode(scan.data) } }, () => {
      setDone(true);
    });
  };
  useEffect(() => {
    // A refused code: the next one the camera sees is read.
    if (write.problem !== null) reading.current = false;
  }, [write.problem]);
  return (
    <Page
      title={tr('performance.screens.scan_the_code', 'Scan the code')}
      back={{ label: tr('performance.screens.learning', 'Learning'), onPress: navigation.goBack }}
    >
      {permission === null ? (
        <Loading label={tr('performance.screens.opening_the_camera', 'Opening the camera')} />
      ) : done ? (
        <>
          <Alert tone="success">
            {tr('performance.screens.you_are_marked_as_attending', 'You are marked as attending.')}
          </Alert>
          <Button variant="primary" onPress={navigation.goBack}>
            {tr('performance.screens.done_2', 'Done')}
          </Button>
        </>
      ) : !permission.granted ? (
        <>
          <Text>
            {tr(
              'performance.screens.kithena_reads_the_sessions_code_with',
              'Kithena reads the session’s code with the camera. Nothing it sees is kept.',
            )}
          </Text>
          <Button
            variant="primary"
            onPress={() => {
              if (permission.canAskAgain) void requestPermission();
              else void Linking.openSettings();
            }}
          >
            {permission.canAskAgain
              ? tr('performance.screens.allow_the_camera', 'Allow the camera')
              : tr(
                  'performance.screens.turn_the_camera_on_in_settings',
                  'Turn the camera on in Settings',
                )}
          </Button>
        </>
      ) : (
        <>
          <View className="aspect-square w-full overflow-hidden rounded-lg">
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={write.busy ? undefined : onScan}
            />
          </View>
          <Text tone="muted">
            {tr(
              'performance.screens.point_the_camera_at_the_code',
              'Point the camera at the code shown at the door.',
            )}
          </Text>
          <Problem text={write.problem} />
        </>
      )}
    </Page>
  );
}

interface Item {
  readonly item: {
    id: string;
    title: string;
    provider: string;
    parts: readonly { id: string; title: string }[];
    acknowledgement: string | null;
    sessions: readonly { id: string; start: string; place: string | null; online: string | null }[];
    quiz: unknown;
  };
  readonly assignment: {
    id: string;
    done: readonly string[];
    acknowledgedAt: string | null;
    attendance: readonly { sessionId: string; invitation: string }[];
    state: string;
  } | null;
}

/** PFM7b: an item's parts, its acknowledgement and its sessions. */
export function PerformanceItem({
  navigation,
  route,
}: PeopleScreen<'PerformanceItem'>): React.JSX.Element {
  const { load, reload } = useRead<Item>(
    'PerformanceLearningItem',
    { id: route.params.id },
    'performance',
  );
  const write = useWrite(reload);
  return (
    <Screen
      title={route.params.title}
      back={{ label: tr('performance.screens.learning', 'Learning'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the item"
    >
      {({ item, assignment: a }) => (
        <>
          <Text tone="muted">{item.provider}</Text>
          <Problem text={write.problem} />
          {item.parts.length === 0 ? null : (
            <List>
              {item.parts.map((p) => (
                <ListItem
                  key={p.id}
                  leading={
                    <Checkbox
                      accessibilityLabel={p.title}
                      checked={a?.done.includes(p.id) === true}
                      disabled={a === null || a.done.includes(p.id)}
                      onCheckedChange={() => {
                        if (a !== null)
                          write.run('MarkPerformancePart', { id: a.id, partId: p.id });
                      }}
                    />
                  }
                >
                  {p.title}
                </ListItem>
              ))}
            </List>
          )}
          {item.sessions.map((s) => {
            const mine = a?.attendance.find((x) => x.sessionId === s.id)?.invitation ?? '';
            return (
              <View key={s.id} className="gap-2">
                <Text variant="headline">{`${day(s.start)} · ${s.place ?? s.online ?? 'Online'}`}</Text>
                {a === null ? null : (
                  <SegmentedControl
                    fullWidth
                    accessibilityLabel={tr('performance.screens.going', 'Going')}
                    value={mine}
                    onValueChange={(v) => {
                      write.run('RespondPerformanceSession', {
                        id: a.id,
                        sessionId: s.id,
                        input: { invitation: v },
                      });
                    }}
                  >
                    <SegmentedControlItem value="accepted">
                      {tr('performance.screens.going', 'Going')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="tentative">
                      {tr('performance.screens.maybe', 'Maybe')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="declined">
                      {tr('performance.screens.no', 'No')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                )}
              </View>
            );
          })}
          {item.acknowledgement === null || a === null ? null : a.acknowledgedAt === null ? (
            <>
              <Text>{item.acknowledgement}</Text>
              <Button
                variant="primary"
                onPress={() => {
                  write.run('AcknowledgePerformanceLearning', { id: a.id });
                }}
              >
                {tr('performance.screens.i_confirm', 'I confirm')}
              </Button>
            </>
          ) : (
            <Alert tone="success">
              {tr('performance.screens.confirmed', 'Confirmed {{day}}', {
                day: day(a.acknowledgedAt),
              })}
            </Alert>
          )}
          {item.quiz === null ? null : (
            <Text tone="muted">
              {tr('performance.screens.the_quiz_is_taken_on_the', 'The quiz is taken on the web.')}
            </Text>
          )}
        </>
      )}
    </Screen>
  );
}

/* --------------------------------------------------- team and unlocks -- */

interface Cycles {
  readonly rows: readonly {
    id: string;
    name: string;
    state: string;
    who: string;
    progress: number;
  }[];
}

/** PFM8: the cycles my team is in, and how far along. */
export function PerformanceTeam({
  navigation,
}: PeopleScreen<'PerformanceTeam'>): React.JSX.Element {
  const { load, reload } = useRead<Cycles>(
    'PerformanceCycles',
    { state: 'in_progress' },
    'performance',
  );
  return (
    <Screen
      title={tr('performance.screens.my_teams_cycles', 'My team’s cycles')}
      back={{
        label: tr('performance.screens.performance', 'Performance'),
        onPress: navigation.goBack,
      }}
      load={load}
      reload={reload}
      what="cycles"
    >
      {(data) =>
        data.rows.length === 0 ? (
          <Text tone="muted">
            {tr('performance.screens.no_cycle_is_running', 'No cycle is running.')}
          </Text>
        ) : (
          <List>
            {data.rows.map((c) => (
              <ListItem
                key={c.id}
                chevron
                description={tr(
                  'performance.screens.submitted',
                  '{{who}} · {{String}}% submitted',
                  { who: c.who, String: String(c.progress) },
                )}
                onPress={() => {
                  navigation.navigate('PerformanceCycle', { id: c.id, name: c.name });
                }}
              >
                {c.name}
              </ListItem>
            ))}
          </List>
        )
      }
    </Screen>
  );
}

interface Cycle {
  readonly rows: readonly {
    personId: string;
    name: string;
    self: string;
    managerReview: string;
    managerReviewId: string | null;
  }[];
  readonly overdue: number;
}

export function PerformanceCycle({
  navigation,
  route,
}: PeopleScreen<'PerformanceCycle'>): React.JSX.Element {
  // Who to show, in words: the same filter the web's table takes, chosen by the assistant.
  const [view, setView] = useState<{ filter: string; match: string; group: string | null } | null>(
    null,
  );
  const [words, setWords] = useState('');
  const [said, setSaid] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const signed = useSigned();
  const { load, reload } = useRead<Cycle>(
    'PerformanceCycle',
    { id: route.params.id, ...(view === null ? {} : view) },
    'performance',
  );
  const filterInWords = (text: string): void => {
    if (text.trim().length < 3) return;
    setAsking(true);
    setProblem(null);
    void ask<{ filter: unknown[]; match: string; group: string | null; summary: string[] }>(
      signed,
      'PerformanceOverviewInWords',
      {
        id: route.params.id,
        input: { text, current: [], places: { locations: {}, entities: {} } },
      },
      'performance',
    ).then((r) => {
      setAsking(false);
      if (!r.ok) {
        setProblem(r.message);
        return;
      }
      setSaid(r.data.summary);
      setView({ filter: JSON.stringify(r.data.filter), match: r.data.match, group: r.data.group });
    });
  };
  return (
    <Screen
      title={route.params.name}
      back={{ label: tr('performance.screens.cycles', 'Cycles'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the cycle"
    >
      {(data) => (
        <>
          {data.overdue === 0 ? null : (
            <Alert tone="warning">
              {tr('performance.screens.overdue', '{{String}} overdue', {
                String: String(data.overdue),
              })}
            </Alert>
          )}
          <SearchField
            value={words}
            onValueChange={setWords}
            onSearch={filterInWords}
            label={tr('performance.screens.filter_in_words', 'Filter in words')}
            placeholder={tr(
              'performance.screens.whose_self_review_is_overdue',
              'Whose self review is overdue',
            )}
          />
          <Problem text={problem} />
          {asking ? (
            <Text tone="muted">
              {tr('performance.screens.working_out_who', 'Working out who…')}
            </Text>
          ) : null}
          {said.length === 0 ? null : (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text tone="muted">{said.join(' · ')}</Text>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setView(null);
                  setSaid([]);
                  setWords('');
                }}
              >
                {tr('performance.screens.show_everyone', 'Show everyone')}
              </Button>
            </View>
          )}
          <List>
            {data.rows.map((r) => (
              <ListItem
                key={r.personId}
                chevron={r.managerReviewId !== null}
                description={tr(
                  'performance.screens.self_manager',
                  'Self: {{value}} · Manager: {{value2}}',
                  {
                    value: (STATE()[r.self] ?? [r.self])[0],
                    value2: (STATE()[r.managerReview] ?? [r.managerReview])[0],
                  },
                )}
                onPress={() => {
                  if (r.managerReviewId !== null)
                    navigation.navigate('PerformanceWrite', {
                      id: r.managerReviewId,
                      title: tr('performance.screens.s_review', '{{name}}’s review', {
                        name: r.name,
                      }),
                    });
                }}
              >
                {r.name}
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Screen>
  );
}

interface Unlocks {
  readonly rows: readonly {
    reviewId: string;
    by: string;
    review: string;
    cycle: string | null;
    reason: string;
    at: string;
    decided: string | null;
  }[];
}

/** PFM9, PFM9b: unlock requests, decided by HR. */
export function PerformanceUnlocks({
  navigation,
}: PeopleScreen<'PerformanceUnlocks'>): React.JSX.Element {
  const { load, reload } = useRead<Unlocks>('PerformanceUnlocks', {}, 'performance');
  const write = useWrite(reload);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Screen
      title={tr('performance.screens.unlock_requests', 'Unlock requests')}
      back={{
        label: tr('performance.screens.performance', 'Performance'),
        onPress: navigation.goBack,
      }}
      load={load}
      reload={reload}
      what="unlock requests"
    >
      {(data) => (
        <>
          <Problem text={write.problem} />
          {data.rows.filter((r) => r.decided === null).length === 0 ? (
            <Text tone="muted">
              {tr('performance.screens.nothing_to_decide', 'Nothing to decide.')}
            </Text>
          ) : null}
          {data.rows
            .filter((r) => r.decided === null)
            .map((r) => (
              <View key={r.reviewId} className="gap-2">
                <Text variant="headline">{`${r.by} · ${r.review}`}</Text>
                <Text>{r.reason}</Text>
                <View className="flex-row gap-2">
                  <Button
                    variant="primary"
                    disabled={write.busy}
                    onPress={() => {
                      write.run('DecidePerformanceUnlock', {
                        id: r.reviewId,
                        input: { approve: true, note: '' },
                      });
                    }}
                  >
                    {tr('performance.screens.unlock', 'Unlock')}
                  </Button>
                  <Button
                    onPress={() => {
                      setDeclining(r.reviewId);
                    }}
                  >
                    {tr('performance.screens.decline', 'Decline')}
                  </Button>
                </View>
              </View>
            ))}
          {declining === null ? null : (
            <Dialog
              open
              onOpenChange={(o) => {
                if (!o) setDeclining(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {tr('performance.screens.decline_the_request', 'Decline the request?')}
                  </DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <Textarea
                    accessibilityLabel={tr('performance.screens.why', 'Why')}
                    placeholder={tr(
                      'performance.screens.why_for_the_writer',
                      'Why, for the writer',
                    )}
                    value={note}
                    onChange={setNote}
                  />
                </DialogBody>
                <DialogFooter>
                  <Button
                    onPress={() => {
                      setDeclining(null);
                    }}
                  >
                    {tr('performance.screens.keep_it', 'Keep it')}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={note.trim() === ''}
                    onPress={() => {
                      write.run('DecidePerformanceUnlock', {
                        id: declining,
                        input: { approve: false, note },
                      });
                      setDeclining(null);
                      setNote('');
                    }}
                  >
                    {tr('performance.screens.decline', 'Decline')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------ Ask Kithena and tools -- */

interface Plan {
  readonly reply: string;
  readonly steps: readonly {
    route: string;
    params: Record<string, unknown>;
    body: unknown;
    summary: string;
  }[];
}

/** PFM11: ask in words; Kithena proposes, and nothing runs until I confirm. */
export function PerformanceAsk({ navigation }: PeopleScreen<'PerformanceAsk'>): React.JSX.Element {
  const signed = useSigned();
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Page
      title={tr('performance.screens.ask_kithena', 'Ask Kithena')}
      back={{
        label: tr('performance.screens.performance', 'Performance'),
        onPress: navigation.goBack,
      }}
    >
      <Textarea
        accessibilityLabel={tr(
          'performance.screens.what_should_kithena_do',
          'What should Kithena do?',
        )}
        placeholder={tr(
          'performance.screens.remind_my_team_about_their_self',
          'Remind my team about their self reviews',
        )}
        value={text}
        onChange={setText}
      />
      <Button
        variant="primary"
        disabled={text.trim().length < 2 || busy}
        onPress={() => {
          setBusy(true);
          setDone(null);
          void ask<Plan>(
            signed,
            'PerformanceAsk',
            { input: { text, path: null } },
            'performance',
          ).then((r) => {
            setBusy(false);
            if (r.ok) setPlan(r.data);
            else setProblem(r.message);
          });
        }}
      >
        {tr('performance.screens.ask', 'Ask')}
      </Button>
      <Problem text={problem} />
      {plan === null ? null : (
        <>
          <Text>{plan.reply}</Text>
          {plan.steps.map((s, i) => (
            <Text key={`${s.route}-${String(i)}`}>{`${String(i + 1)}. ${s.summary}`}</Text>
          ))}
          {plan.steps.length === 0 ? null : (
            <Button
              variant="primary"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void ask(
                  signed,
                  'RunPerformanceAsk',
                  {
                    input: {
                      steps: plan.steps.map(({ route, params, body }) => ({ route, params, body })),
                    },
                  },
                  'performance',
                ).then((r) => {
                  setBusy(false);
                  if (r.ok) {
                    setDone(
                      tr(
                        'performance.screens.done_step_as_you',
                        {
                          one: 'Done: {{count}} step, as you.',
                          other: 'Done: {{count}} steps, as you.',
                        },
                        { count: plan.steps.length },
                      ),
                    );
                    setPlan(null);
                  } else setProblem(r.message);
                });
              }}
            >
              {tr('performance.screens.do_it', 'Do it')}
            </Button>
          )}
        </>
      )}
      {done === null ? null : <Alert tone="success">{done}</Alert>}
    </Page>
  );
}

interface Tools {
  readonly sources: readonly {
    source: string;
    on: boolean;
    available?: boolean;
    account?: string | null;
  }[];
}

const SOURCE = (): Readonly<Record<string, string>> => ({
  slack: tr('performance.screens.slack', 'Slack'),
  teams: tr('performance.screens.microsoft_teams', 'Microsoft Teams'),
  gchat: tr('performance.screens.google_chat', 'Google Chat'),
  meet: tr('performance.screens.google_meet', 'Google Meet'),
  github: tr('performance.screens.github', 'GitHub'),
  gitlab: tr('performance.screens.gitlab', 'GitLab'),
  linear: tr('performance.screens.linear', 'Linear'),
  jira: tr('performance.screens.jira', 'Jira'),
  confluence: tr('performance.screens.confluence', 'Confluence'),
});

/** PFS3: the tools I let Kithena read of my own work, each on or off. */
export function PerformanceTools({
  navigation,
}: PeopleScreen<'PerformanceTools'>): React.JSX.Element {
  const { load, reload } = useRead<Tools>('PerformanceConnectedTools', {}, 'performance');
  const write = useWrite(reload);
  return (
    <Screen
      title={tr('performance.screens.my_connected_tools', 'My connected tools')}
      back={{ label: tr('performance.screens.settings', 'Settings'), onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="your tools"
    >
      {(data) => (
        <>
          <Text tone="muted">
            {tr(
              'performance.screens.what_kithena_may_read_of_your',
              'What Kithena may read of your own work, for reviews about you and by you. Off stops it at once.',
            )}
          </Text>
          <Problem text={write.problem} />
          {data.sources.map((s) => (
            <Switch
              key={s.source}
              checked={s.on}
              // Linking approves it in the tool, in a browser: done on the web, then on and off here.
              disabled={
                write.busy || s.available === false || (!s.on && (s.account ?? null) === null)
              }
              description={
                s.available === false
                  ? tr('performance.screens.not_available_yet', 'Not available yet')
                  : (s.account ?? null) === null
                    ? tr(
                        'performance.screens.link_it_on_the_web_settings',
                        'Link it on the web: Settings › Performance › My connected tools',
                      )
                    : tr('performance.screens.linked_as', 'Linked as {{value}}', {
                        value: s.account ?? '',
                      })
              }
              onCheckedChange={(on) => {
                write.run('SetPerformanceGrant', { source: s.source, input: { on } });
              }}
            >
              {SOURCE()[s.source] ?? s.source}
            </Switch>
          ))}
        </>
      )}
    </Screen>
  );
}
