import {
  Alert,
  Badge,
  Button,
  Checkbox,
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
import { useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { ask, useRead, useSigned, type Load } from '../people/api';
import type { PeopleScreen } from '../people/routes';

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
    : new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', {
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

const KIND: Readonly<Record<string, string>> = {
  self: 'Self review',
  manager: 'Manager review',
  peer: 'Peer review',
  upward: 'Upward review',
  skip: 'Skip-level review',
  goals: 'Goals review',
};
const kindLabel = (k: string): string => KIND[k] ?? k;

const STATE: Readonly<Record<string, readonly [string, Tone]>> = {
  not_started: ['Not started', 'neutral'],
  draft: ['In progress', 'warning'],
  submitted: ['Submitted', 'success'],
  unlock: ['Unlock requested', 'warning'],
  unlocked: ['Unlocked', 'info'],
  released: ['Released', 'accent'],
  ack: ['Acknowledged', 'success'],
  detached: ['Detached', 'neutral'],
  overdue: ['Overdue', 'danger'],
  declined: ['Declined', 'neutral'],
};

function StateBadge({ state }: { readonly state: string }): React.JSX.Element {
  const [label, tone] = STATE[state] ?? [state, 'neutral'];
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
          <Loading label={`Loading ${what}`} />
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

/** PFM1: I owe, owed to me and nominations, with feedback, goals and learning a tap away. */
export function PerformanceReviews({ navigation }: PeopleScreen<'Performance'>): React.JSX.Element {
  const [tab, setTab] = useState<'write' | 'about' | 'nominations'>('write');
  const { load, reload } = useRead<MyReviews>('PerformanceMyReviews', { tab }, 'performance');
  const viewer = useRead<Viewer>('PerformanceViewer', {}, 'performance').load;
  const roles =
    viewer.status === 'ready' ? viewer.data : { hr: false, manager: false, calibrator: false };
  return (
    <Screen
      title="Performance"
      back={{ label: 'More', onPress: navigation.goBack }}
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
              Feedback
            </ListItem>
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceGoals');
              }}
            >
              Goals
            </ListItem>
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceLearning');
              }}
            >
              Learning
            </ListItem>
            {roles.manager || roles.hr ? (
              <ListItem
                chevron
                onPress={() => {
                  navigation.navigate('PerformanceTeam');
                }}
              >
                My team’s cycles
              </ListItem>
            ) : null}
            {roles.hr ? (
              <ListItem
                chevron
                onPress={() => {
                  navigation.navigate('PerformanceUnlocks');
                }}
              >
                Unlock requests
              </ListItem>
            ) : null}
            <ListItem
              chevron
              onPress={() => {
                navigation.navigate('PerformanceAsk');
              }}
            >
              Ask Kithena
            </ListItem>
          </List>
          <SegmentedControl
            fullWidth
            accessibilityLabel="Reviews"
            value={tab}
            onValueChange={(v) => {
              setTab(v === 'about' ? 'about' : v === 'nominations' ? 'nominations' : 'write');
            }}
          >
            <SegmentedControlItem value="write">I owe</SegmentedControlItem>
            <SegmentedControlItem value="about">Owed to me</SegmentedControlItem>
            <SegmentedControlItem value="nominations">Nominations</SegmentedControlItem>
          </SegmentedControl>
          {tab === 'write' ? (
            data.rows.length === 0 ? (
              <Text tone="muted">No reviews to write.</Text>
            ) : (
              <List>
                {data.rows.map((r) => (
                  <ListItem
                    key={r.id}
                    chevron
                    description={`${r.about} · due ${day(r.due)}`}
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
                        description={`Due ${day(c.self.due)}`}
                        trailing={<StateBadge state={c.self.state} />}
                        onPress={() => {
                          if (c.self !== null)
                            navigation.navigate('PerformanceWrite', {
                              id: c.self.id,
                              title: 'Self review',
                            });
                        }}
                      >
                        Your self review
                      </ListItem>
                    )}
                    {c.manager === null ? null : (
                      <ListItem
                        chevron={c.manager.released !== null}
                        description={
                          c.manager.released === null
                            ? c.manager.writing
                              ? `${c.manager.by} is writing it`
                              : 'Submitted, not released yet'
                            : `Released ${day(c.manager.released)}`
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
                        {`Manager review · ${c.manager.by}`}
                      </ListItem>
                    )}
                    {c.peers === null ? null : (
                      <ListItem
                        chevron={c.peers.count > 0}
                        description={
                          c.peers.count === 0
                            ? 'Not enough peers answered to show them'
                            : 'Without names'
                        }
                        onPress={() => {
                          const first = c.peers?.ids[0];
                          if (first !== undefined)
                            navigation.navigate('PerformanceReleased', { id: first });
                        }}
                      >
                        {`Peer reviews · ${String(c.peers.count)}`}
                      </ListItem>
                    )}
                  </List>
                </View>
              ))
            : null}
          {tab === 'nominations' ? (
            data.nominations.length === 0 ? (
              <Text tone="muted">No nominations waiting on you.</Text>
            ) : (
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
                      ? `Pick ${String(n.min)} to ${String(n.max)} peers for ${n.subject}`
                      : `Approve ${n.subject}’s peers`}
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
  const back = { label: 'Reviews', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title={route.params.title} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the review" />
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
  const [asking, setAsking] = useState<'unlock' | 'decline' | null>(null);
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
            ? 'Saved elsewhere since you opened it: reopen the review to see both.'
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
        <Text tone="muted">This form has no questions.</Text>
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
            Back
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              setEvidence(true);
            }}
          >
            Evidence
          </Button>
          {at < questions.length - 1 ? (
            <Button
              variant="primary"
              onPress={() => {
                setAt(at + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!data.may.write}
              onPress={() => {
                setSubmitting(true);
              }}
            >
              Submit
            </Button>
          )}
        </View>
      }
    >
      <Text tone="muted">{`${data.review.subject.name} · ${current.section} · ${String(at + 1)} of ${String(questions.length)}`}</Text>
      <Progress label="Questions" value={((at + 1) / questions.length) * 100} />
      {data.review.handover === null ? null : (
        <Alert tone="info">{`Handed over from ${data.review.handover.from}${data.review.handover.note === null ? '' : `: ${data.review.handover.note}`}`}</Alert>
      )}
      <Problem text={problem ?? write.problem} />
      <Heading title={q.prompt} />
      {q.help === null ? null : <Text tone="muted">{q.help}</Text>}
      {q.private ? (
        <Badge tone="warning">{`Private: hidden from ${data.review.subject.name.split(' ')[0] ?? 'them'}`}</Badge>
      ) : null}
      {data.suggestions[q.id] !== undefined && data.suggestions[q.id]?.confirmed === false ? (
        <>
          <Alert tone="info">{`Suggested by AI: ${String(data.suggestions[q.id]?.value ?? '')}. ${data.suggestions[q.id]?.reason ?? ''}`}</Alert>
          {data.may.write ? (
            <Button
              size="sm"
              onPress={() => {
                write.run('ConfirmPerformanceSuggestion', { id: data.review.id, questionId: q.id });
              }}
            >
              Confirm the suggestion
            </Button>
          ) : null}
        </>
      ) : null}
      {!data.may.write ? (
        <Text>{typeof a?.value === 'string' ? plain(a.value) : String(a?.value ?? '—')}</Text>
      ) : q.type === 'text' ? (
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
              {`${String(o.value)} · ${o.label}`}
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
            ? 'Computed once the ratings are in'
            : `${data.score.display} · ${data.score.label}`}
        </Text>
      )}
      {data.may.unlock ? (
        <Button
          onPress={() => {
            setAsking('unlock');
          }}
        >
          Ask to change it
        </Button>
      ) : null}
      {data.may.withdraw ? (
        <Button
          onPress={() => {
            write.run('WithdrawPerformanceUnlock', { id: data.review.id });
          }}
        >
          Withdraw the unlock request
        </Button>
      ) : null}
      {data.may.decline ? (
        <Button
          variant="danger"
          onPress={() => {
            setAsking('decline');
          }}
        >
          I can’t review them
        </Button>
      ) : null}
      {asking === null ? null : (
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
                  ? 'Ask HR to unlock it'
                  : `Decline reviewing ${data.review.subject.name}?`}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Textarea
                accessibilityLabel="Why"
                placeholder={
                  asking === 'unlock'
                    ? 'What you need to change, and why'
                    : 'Why, for whoever asked'
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
                Cancel
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
                Send
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
              <DialogTitle>Evidence</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <View className="gap-3">
                {data.panel.goals.length === 0 ? null : <Heading title="Goals" />}
                {data.panel.goals.map((g) => (
                  <Progress
                    key={g.id}
                    label={`${g.title}: ${String(g.progress)}%`}
                    value={g.progress}
                  />
                ))}
                {data.panel.feedback.length === 0 ? null : <Heading title="Feedback" />}
                {data.panel.feedback.slice(0, 5).map((f) => (
                  <Text key={f.id}>{`${f.from}, ${day(f.at)}: ${plain(f.text)}`}</Text>
                ))}
                {data.panel.reviews.length === 0 ? null : <Heading title="Other reviews" />}
                {data.panel.reviews.map((r) => (
                  <Text
                    key={r.id}
                  >{`${r.title} · ${r.by}${r.excerpt === null ? '' : `: ${plain(r.excerpt)}`}`}</Text>
                ))}
                {data.panel.goals.length +
                  data.panel.feedback.length +
                  data.panel.reviews.length ===
                0 ? (
                  <Text tone="muted">Nothing yet for this cycle.</Text>
                ) : null}
              </View>
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setEvidence(false);
                }}
              >
                Close
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
              <DialogTitle>{`Submit your ${kindLabel(data.review.kind).toLowerCase()}?`}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <View className="gap-3">
                {data.score === null ? null : (
                  <Text>{`Performance score ${data.score.display} · ${data.score.label}`}</Text>
                )}
                {data.missing.length === 0 ? null : (
                  <Alert tone="warning">{`${String(data.missing.length)} required question${data.missing.length === 1 ? '' : 's'} still need an answer.`}</Alert>
                )}
                {unconfirmed.length === 0 ? null : (
                  <Text>{`Submitting confirms the ${String(unconfirmed.length)} AI suggestion${unconfirmed.length === 1 ? '' : 's'} as your own answer.`}</Text>
                )}
                {data.review.cycle?.names === 'writer' ? (
                  <Switch
                    checked={!hideName}
                    onCheckedChange={(on) => {
                      setHideName(!on);
                    }}
                  >
                    {`Show my name to ${data.review.subject.name.split(' ')[0] ?? 'them'}`}
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
                Not yet
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
                Submit
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
      title="Your review"
      back={{ label: 'Reviews', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the review"
    >
      {(data) => (
        <>
          <Text tone="muted">{`${data.review.title}${data.review.by === null ? '' : ` · ${data.review.by}`} · ${data.review.cycle ?? ''}`}</Text>
          {data.score === null ? null : (
            <Text variant="title2">{`${data.score.display} · ${data.score.label}${data.score.final ? '' : ' (not final)'}`}</Text>
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
            <Alert tone="success">{`Acknowledged ${day(data.review.acknowledged.at)}`}</Alert>
          ) : data.may.acknowledge ? (
            <>
              {data.may.comment ? (
                <Field>
                  <FieldLabel>A response (optional)</FieldLabel>
                  <Textarea
                    value={comment}
                    onChange={setComment}
                    accessibilityLabel="Your response"
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
                I’ve read this
              </Button>
              <Text variant="footnote" tone="muted">
                Acknowledging is not agreeing.
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
      title="Nominations"
      back={{ label: 'Reviews', onPress: navigation.goBack }}
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
              <Text>{`${data.nomination.subject}’s peers for ${data.cycle}. Untick anyone who should not review them.`}</Text>
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
                Approve
              </Button>
            </>
          );
        const rows = [...data.team, ...data.worksWith, ...data.found].filter(
          (p, i, all) => all.findIndex((x) => x.personId === p.personId) === i,
        );
        return (
          <>
            <Text>{`Pick ${String(data.bounds.min)} to ${String(data.bounds.max)} peers to review ${data.nomination.subject}. ${data.approver} approves them.`}</Text>
            <SearchField
              value={q}
              onValueChange={setQ}
              onSearch={setSearch}
              label="Search people"
              placeholder="Search everyone"
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
              {`Send ${String(chosen.length)} for approval`}
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
      title="Feedback"
      back={{ label: 'Performance', onPress: navigation.goBack }}
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
                Give feedback
              </Button>
              <Button
                onPress={() => {
                  navigation.navigate('PerformanceRequest');
                }}
              >
                Request
              </Button>
            </View>
          ) : (
            <Alert tone="info">Feedback is off at this company.</Alert>
          )}
          <SegmentedControl
            fullWidth
            accessibilityLabel="Feedback"
            value={tab}
            onValueChange={(v) => {
              setTab(v === 'sent' ? 'sent' : v === 'requests' ? 'requests' : 'received');
            }}
          >
            <SegmentedControlItem value="received">Received</SegmentedControlItem>
            <SegmentedControlItem value="sent">Sent</SegmentedControlItem>
            <SegmentedControlItem value="requests">Requests</SegmentedControlItem>
          </SegmentedControl>
          <Problem text={write.problem} />
          {tab === 'received' ? (
            data.received.length === 0 ? (
              <Text tone="muted">Feedback you receive shows here.</Text>
            ) : (
              data.received.map((f) => (
                <View key={f.id} className="gap-1">
                  <Text variant="headline">{`${f.from ?? 'Someone at the company'} · ${day(f.at)}`}</Text>
                  <Text>{plain(f.body)}</Text>
                </View>
              ))
            )
          ) : null}
          {tab === 'sent'
            ? data.sent.map((f) => (
                <View key={f.id} className="gap-1">
                  <Text variant="headline">{`To ${f.to} · ${day(f.at)}`}</Text>
                  <Text tone={f.undone ? 'muted' : undefined}>{plain(f.body)}</Text>
                  {!f.undone && f.undoUntil !== null && Date.parse(f.undoUntil) > Date.now() ? (
                    <Button
                      size="sm"
                      onPress={() => {
                        write.run('UndoPerformanceFeedback', { id: f.id });
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </View>
              ))
            : null}
          {tab === 'requests' ? (
            data.open.length === 0 ? (
              <Text tone="muted">Nobody is waiting on you.</Text>
            ) : (
              <List>
                {data.open.map((r) => (
                  <ListItem
                    key={r.id}
                    chevron
                    description={r.question ?? `About ${r.about}`}
                    trailing={
                      <Button
                        size="sm"
                        onPress={() => {
                          write.run('DeclinePerformanceRequest', { id: r.id });
                        }}
                      >
                        Decline
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
                    {`${r.from} asks about ${r.about}`}
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
        placeholder="Type a name"
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
    <Page title="Give feedback" back={{ label: 'Feedback', onPress: navigation.goBack }}>
      {to === null ? (
        <PickPerson
          label="Who is it for?"
          onPick={(p) => {
            setTo({ id: p.personId, name: p.name });
          }}
        />
      ) : (
        <>
          <Text variant="headline">{`To ${to.name}`}</Text>
          <SegmentedControl
            fullWidth
            accessibilityLabel="Kind"
            value={praise ? 'praise' : 'feedback'}
            onValueChange={(v) => {
              setPraise(v === 'praise');
            }}
          >
            <SegmentedControlItem value="feedback">Feedback</SegmentedControlItem>
            <SegmentedControlItem value="praise">Praise</SegmentedControlItem>
          </SegmentedControl>
          <Textarea accessibilityLabel="Your feedback" value={body} onChange={setBody} />
          {praise ? (
            <Text tone="muted">Praise is shown with your name.</Text>
          ) : (
            <>
              {names === 'writer' ? (
                <Switch checked={showName} onCheckedChange={setShowName}>
                  Show my name
                </Switch>
              ) : null}
              <RadioGroup
                accessibilityLabel="Who sees it"
                value={audience}
                onValueChange={setAudience}
              >
                <RadioCard value="recipient_manager">{`${first} and their manager`}</RadioCard>
                <RadioCard value="manager_only">{`Only ${first}’s manager`}</RadioCard>
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
            Send
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
    <Page title="Request feedback" back={{ label: 'Feedback', onPress: navigation.goBack }}>
      <PickPerson
        label="Who to ask"
        onPick={(p) => {
          if (!people.some((x) => x.personId === p.personId))
            setPeople([...people, p].slice(0, 10));
        }}
      />
      {people.length === 0 ? null : <Text>{`Asking ${people.map((p) => p.name).join(', ')}`}</Text>}
      <Field>
        <FieldLabel>Your question</FieldLabel>
        <Textarea accessibilityLabel="Your question" value={question} onChange={setQuestion} />
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
        Send requests
      </Button>
    </Page>
  );
}

/* --------------------------------------------------------------- goals -- */

const CONFIDENCE: Readonly<Record<string, readonly [string, Tone]>> = {
  on_track: ['On track', 'success'],
  at_risk: ['At risk', 'warning'],
  off_track: ['Off track', 'danger'],
  done: ['Done', 'accent'],
};

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
      title="Goals"
      back={{ label: 'Performance', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="goals"
    >
      {(data) => (
        <>
          <SegmentedControl
            fullWidth
            accessibilityLabel="Whose"
            value={scope}
            onValueChange={(v) => {
              setScope(v === 'team' ? 'team' : 'mine');
            }}
          >
            <SegmentedControlItem value="mine">Mine</SegmentedControlItem>
            <SegmentedControlItem value="team">My team</SegmentedControlItem>
          </SegmentedControl>
          {data.due.length === 0 ? null : (
            <Alert tone="info">{`Check-in due: ${data.due.map((g) => g.title).join(', ')}`}</Alert>
          )}
          {data.rows.length === 0 ? (
            <Text tone="muted">No goals for this period.</Text>
          ) : (
            <List>
              {data.rows.map((g) => {
                const [label, tone] = CONFIDENCE[g.confidence] ?? ['On track', 'success'];
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
  readonly may: { checkIn: boolean };
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
      back={{ label: 'Goals', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the goal"
    >
      {(data) => (
        <>
          <Progress label={`${String(data.goal.progress)}% done`} value={data.goal.progress} />
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
                    Done
                  </Switch>
                ) : (
                  <NumberField
                    label={`Now, from ${String(k.start)} to ${String(k.target)}${k.unit === null ? '' : ` ${k.unit}`}`}
                    value={values[k.id] ?? k.current}
                    onChange={(v) => {
                      if (v !== null) setValues({ ...values, [k.id]: v });
                    }}
                  />
                )
              ) : (
                <Progress
                  label={`${String(k.current)} of ${String(k.target)}`}
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
                accessibilityLabel="Confidence"
                value={confidence}
                onValueChange={setConfidence}
              >
                <SegmentedControlItem value="on_track">On track</SegmentedControlItem>
                <SegmentedControlItem value="at_risk">At risk</SegmentedControlItem>
                <SegmentedControlItem value="off_track">Off track</SegmentedControlItem>
              </SegmentedControl>
              <Textarea
                accessibilityLabel="Note"
                placeholder="What changed (optional)"
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
                Check in
              </Button>
            </>
          ) : null}
          {data.checkIns.length === 0 ? null : <Heading title="Check-ins" />}
          {data.checkIns.slice(0, 6).map((c) => (
            <Text
              key={c.at}
            >{`${day(c.at)} · ${c.by} · ${(CONFIDENCE[c.confidence] ?? ['On track'])[0]}${c.note === null ? '' : `: ${c.note}`}`}</Text>
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

const LEARNING: Readonly<Record<string, readonly [string, Tone]>> = {
  not_started: ['Assigned', 'neutral'],
  in_progress: ['In progress', 'warning'],
  done: ['Completed', 'success'],
  going: ['Going', 'info'],
};

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
      title="Learning"
      back={{ label: 'Performance', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="your learning"
    >
      {(data) => (
        <>
          {data.assigned.length === 0 ? (
            <Text tone="muted">Nothing assigned to you.</Text>
          ) : (
            <List>
              {data.assigned.map((a) => {
                const [label, tone] = LEARNING[a.state] ?? [a.state, 'neutral'];
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
          <Heading title="At a session" />
          <Field>
            <FieldLabel>The code shown at the door</FieldLabel>
            <Input value={code} onChange={setCode} accessibilityLabel="Session code" />
          </Field>
          <Problem text={write.problem} />
          {scanned === null ? null : <Alert tone="success">{scanned}</Alert>}
          <Button
            disabled={code.trim().length < 4 || write.busy}
            onPress={() => {
              write.run('ScanPerformanceSession', { input: { code: code.trim() } }, () => {
                setScanned('You are marked as attending.');
                setCode('');
              });
            }}
          >
            I’m here
          </Button>
        </>
      )}
    </Screen>
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
      back={{ label: 'Learning', onPress: navigation.goBack }}
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
                    accessibilityLabel="Going"
                    value={mine}
                    onValueChange={(v) => {
                      write.run('RespondPerformanceSession', {
                        id: a.id,
                        sessionId: s.id,
                        input: { invitation: v },
                      });
                    }}
                  >
                    <SegmentedControlItem value="accepted">Going</SegmentedControlItem>
                    <SegmentedControlItem value="tentative">Maybe</SegmentedControlItem>
                    <SegmentedControlItem value="declined">No</SegmentedControlItem>
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
                I confirm
              </Button>
            </>
          ) : (
            <Alert tone="success">{`Confirmed ${day(a.acknowledgedAt)}`}</Alert>
          )}
          {item.quiz === null ? null : <Text tone="muted">The quiz is taken on the web.</Text>}
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
      title="My team’s cycles"
      back={{ label: 'Performance', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="cycles"
    >
      {(data) =>
        data.rows.length === 0 ? (
          <Text tone="muted">No cycle is running.</Text>
        ) : (
          <List>
            {data.rows.map((c) => (
              <ListItem
                key={c.id}
                chevron
                description={`${c.who} · ${String(c.progress)}% submitted`}
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
  const { load, reload } = useRead<Cycle>(
    'PerformanceCycle',
    { id: route.params.id },
    'performance',
  );
  return (
    <Screen
      title={route.params.name}
      back={{ label: 'Cycles', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="the cycle"
    >
      {(data) => (
        <>
          {data.overdue === 0 ? null : (
            <Alert tone="warning">{`${String(data.overdue)} overdue`}</Alert>
          )}
          <List>
            {data.rows.map((r) => (
              <ListItem
                key={r.personId}
                chevron={r.managerReviewId !== null}
                description={`Self: ${(STATE[r.self] ?? [r.self])[0]} · Manager: ${(STATE[r.managerReview] ?? [r.managerReview])[0]}`}
                onPress={() => {
                  if (r.managerReviewId !== null)
                    navigation.navigate('PerformanceWrite', {
                      id: r.managerReviewId,
                      title: `${r.name}’s review`,
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
      title="Unlock requests"
      back={{ label: 'Performance', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="unlock requests"
    >
      {(data) => (
        <>
          <Problem text={write.problem} />
          {data.rows.filter((r) => r.decided === null).length === 0 ? (
            <Text tone="muted">Nothing to decide.</Text>
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
                    Unlock
                  </Button>
                  <Button
                    onPress={() => {
                      setDeclining(r.reviewId);
                    }}
                  >
                    Decline
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
                  <DialogTitle>Decline the request?</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <Textarea
                    accessibilityLabel="Why"
                    placeholder="Why, for the writer"
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
                    Keep it
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
                    Decline
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
    <Page title="Ask Kithena" back={{ label: 'Performance', onPress: navigation.goBack }}>
      <Textarea
        accessibilityLabel="What should Kithena do?"
        placeholder="Remind my team about their self reviews"
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
        Ask
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
                      `Done: ${String(plan.steps.length)} step${plan.steps.length === 1 ? '' : 's'}, as you.`,
                    );
                    setPlan(null);
                  } else setProblem(r.message);
                });
              }}
            >
              Do it
            </Button>
          )}
        </>
      )}
      {done === null ? null : <Alert tone="success">{done}</Alert>}
    </Page>
  );
}

interface Tools {
  readonly sources: readonly { source: string; on: boolean }[];
}

const SOURCE: Readonly<Record<string, string>> = {
  slack: 'Slack',
  teams: 'Microsoft Teams',
  gchat: 'Google Chat',
  meet: 'Google Meet',
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira',
  confluence: 'Confluence',
};

/** PFS3: the tools I let Kithena read of my own work, each on or off. */
export function PerformanceTools({
  navigation,
}: PeopleScreen<'PerformanceTools'>): React.JSX.Element {
  const { load, reload } = useRead<Tools>('PerformanceConnectedTools', {}, 'performance');
  const write = useWrite(reload);
  return (
    <Screen
      title="My connected tools"
      back={{ label: 'Settings', onPress: navigation.goBack }}
      load={load}
      reload={reload}
      what="your tools"
    >
      {(data) => (
        <>
          <Text tone="muted">
            What Kithena may read of your own work, for reviews about you and by you. Off stops it
            at once.
          </Text>
          <Problem text={write.problem} />
          {data.sources.map((s) => (
            <Switch
              key={s.source}
              checked={s.on}
              disabled={write.busy}
              onCheckedChange={(on) => {
                write.run('SetPerformanceGrant', { source: s.source, input: { on } });
              }}
            >
              {SOURCE[s.source] ?? s.source}
            </Switch>
          ))}
        </>
      )}
    </Screen>
  );
}
