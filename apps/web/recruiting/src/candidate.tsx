import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  KeyValues,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  TimelineItem,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, day, money, useAct, when, words } from './shared';
import type { CandidateData, CandidatesData, PoolsData, ScreenProps } from './types';

/**
 * R11, R12, a candidate (design R11–R12): one record across applications.
 * The applications on the left; on the right the chosen one's stage and
 * actions, then tabs for the profile, answers, interviews, messages,
 * activity and offers, each as the viewer's role allows. The tab is in the
 * address.
 */

const TABS = ['profile', 'answers', 'interviews', 'messages', 'activity', 'offers'] as const;
type Tab = (typeof TABS)[number];

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
                data.candidate.email === undefined ? null : (
                  <Button
                    variant="secondary"
                    startIcon={<icons.email aria-hidden />}
                    onClick={() => props.onFilter?.({ tab: 'messages' })}
                  >
                    Email
                  </Button>
                )
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
                      <TabsTrigger value="answers">Answers</TabsTrigger>
                      <TabsTrigger value="interviews">{`Interviews${chosen.interviews.length > 0 ? ` (${String(chosen.interviews.length)})` : ''}`}</TabsTrigger>
                      <TabsTrigger value="messages">{`Messages${data.messages.length > 0 ? ` (${String(data.messages.length)})` : ''}`}</TabsTrigger>
                      <TabsTrigger value="activity">Activity</TabsTrigger>
                      <TabsTrigger value="offers">Offers</TabsTrigger>
                    </TabsList>
                    <TabsContent value="profile">
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
                                { label: 'Adjustments', value: chosen.adjustments ?? 'None asked' },
                              ]}
                            />
                          </CardContent>
                        </Card>
                        <Notes data={data} application={chosen} props={props} />
                      </div>
                    </TabsContent>
                    <TabsContent value="answers">
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
                    </TabsContent>
                    <TabsContent value="interviews">
                      <Card>
                        <CardContent className="flex flex-col gap-3">
                          {chosen.interviews.length === 0 ? (
                            <EmptyState
                              icon={<icons.meeting aria-hidden />}
                              title="No interviews yet"
                            />
                          ) : null}
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
                                <span className="text-sm text-fg-muted">{when(i.startsAt)}</span>
                                <StateBadge state={i.state} />
                                <span className="text-sm text-fg-muted">{`${String(cards.length)} of ${String(i.interviewerIds.length)} scorecards`}</span>
                              </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    </TabsContent>
                    <TabsContent value="messages">
                      <Messages data={data} application={chosen} props={props} />
                    </TabsContent>
                    <TabsContent value="activity">
                      <Card>
                        <CardContent>
                          <Timeline>
                            {chosen.history.map((m) => (
                              <TimelineItem
                                key={m.id}
                                title={chosen.stages.find((s) => s.id === m.to)?.name ?? 'Moved'}
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
                    </TabsContent>
                    <TabsContent value="offers">
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
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
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
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </Loaded>
  );
}
