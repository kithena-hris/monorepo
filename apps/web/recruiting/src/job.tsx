import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Combobox,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyField,
  DatePicker,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  NumberField,
  KeyValues,
  PageHeader,
  RichTextContent,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Timeline,
  TimelineItem,
  cn,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, day, newId, range, useAct, words } from './shared';
import { BenefitList } from './benefits';
import { hoursOf, useCommit, type Commit } from './job-terms';
import { JobWizard, NewJobWizard, isSetupPart } from './job-wizard';
import type { FormField, JobData, ScreenProps } from './types';

/**
 * R4–R7 and R14, a job's setup (design R4–R7): details, the hiring team,
 * criteria, the interview plan, the ad with its checks, the apply form and
 * where it is published. Each tab is in the address; each saves on its own.
 */

const ROLES = ['recruiter', 'hiring_manager', 'interviewer', 'coordinator'] as const;

const TARGETS: readonly {
  readonly key: string;
  readonly label: string;
  readonly what: string;
  readonly available: boolean;
}[] = [
  {
    key: 'careers_page',
    label: 'Careers page',
    what: 'The company’s page on Kithena Jobs, and its embed',
    available: true,
  },
  {
    key: 'kithena_jobs',
    label: 'Kithena Jobs search',
    what: 'The cross-company search, if the company opted in',
    available: true,
  },
  {
    key: 'google_for_jobs',
    label: 'Google for Jobs',
    what: 'Structured data on the job page; Google crawls it',
    available: true,
  },
  {
    key: 'xml_feed',
    label: 'Open XML feed',
    what: 'For aggregators that read feeds',
    available: true,
  },
  {
    key: 'internal_board',
    label: 'Internal job board',
    what: 'Members only, with refer and apply',
    available: true,
  },
  { key: 'share_link', label: 'Share links', what: 'A tracked link per channel', available: true },
  {
    key: 'indeed',
    label: 'Indeed',
    what: 'Glassdoor lists jobs from Indeed; needs the careers page first',
    available: false,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    what: 'Partner-only; use the tracked share link',
    available: false,
  },
];

function Details({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [job, setJob] = useState(data.job);
  // The place, the terms and the pay are the terms' own: sent as they stand now,
  // never as this form first saw them.
  const save = (): void => {
    act.run('SaveJobDetails', {
      jobId: job.id,
      input: {
        title: job.title,
        internalTitle: job.internalTitle,
        department: job.department,
        locationIds: data.job.locationIds,
        workMode: data.job.workMode,
        salaryShown: data.job.salaryShown,
        languages: job.languages,
        internalOnly: job.internalOnly,
        confidential: job.confidential,
        openings: job.openings,
        targetHireDate: job.targetHireDate,
        outline: {
          ...job.outline,
          contractType: data.job.outline.contractType,
          hours: data.job.outline.hours,
        },
        salary: data.job.salary,
        searchable: job.searchable,
        benefitIds: data.job.benefitIds,
        scorecardTemplateId: job.scorecardTemplateId,
        entityId: data.job.entityId,
      },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <Card>
        <CardHeader>
          <CardTitle level={2}>The job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field required className="md:col-span-2">
            <FieldLabel>Advertised title</FieldLabel>
            <FieldControl>
              <Input
                value={job.title}
                onChange={(e) => {
                  setJob({ ...job, title: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel>Internal title</FieldLabel>
            <FieldDescription>For the team only, when it differs from the ad.</FieldDescription>
            <FieldControl>
              <Input
                value={job.internalTitle}
                onChange={(e) => {
                  setJob({ ...job, internalTitle: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>Team</FieldLabel>
            <FieldControl>
              <Combobox
                label="Team"
                clearable
                placeholder="Choose a team"
                options={data.orgUnits.map((u) => ({ value: u.name, label: u.name }))}
                value={job.department}
                onChange={(v) => {
                  setJob({ ...job, department: typeof v === 'string' ? v : null });
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>Level</FieldLabel>
            <Select
              value={job.outline.seniority ?? 'none'}
              onValueChange={(v) => {
                setJob({ ...job, outline: { ...job.outline, seniority: v === 'none' ? null : v } });
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {['entry', 'mid', 'senior', 'lead', 'executive'].map((l) => (
                  <SelectItem key={l} value={l}>
                    {words(l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <NumberField
            label="Openings"
            value={job.openings}
            min={1}
            onChange={(n) => {
              setJob({ ...job, openings: n ?? 1 });
            }}
          />
          <Field>
            <FieldLabel>Target start</FieldLabel>
            <FieldControl>
              <DatePicker
                label="Target start"
                value={job.targetHireDate}
                onChange={(d) => {
                  setJob({ ...job, targetHireDate: d });
                }}
              />
            </FieldControl>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Visibility</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field orientation="horizontal">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>Internal only</FieldLabel>
              <FieldDescription>On the internal board, nowhere public.</FieldDescription>
            </span>
            <FieldControl>
              <Switch
                checked={job.internalOnly}
                onCheckedChange={(on) => {
                  setJob({ ...job, internalOnly: on });
                }}
              />
            </FieldControl>
          </Field>
          <Field orientation="horizontal">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>Confidential</FieldLabel>
              <FieldDescription>The company is not named in the ad.</FieldDescription>
            </span>
            <FieldControl>
              <Switch
                checked={job.confidential}
                onCheckedChange={(on) => {
                  setJob({ ...job, confidential: on });
                }}
              />
            </FieldControl>
          </Field>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button loading={act.pending} onClick={save}>
          Save details
        </Button>
      </div>
    </div>
  );
}

/** Keeps a borrowed part's edits: by its own Save in the ad's panel, or when the setup moves on. */
function useKeep(
  props: ScreenProps<JobData>,
  commit: Commit | undefined,
  changed: boolean,
  name: string,
  variables: () => Readonly<Record<string, unknown>>,
) {
  const act = useAct(props);
  const [error, setError] = useState<string | null>(null);
  const keep = async (): Promise<boolean> => {
    if (!changed) return true;
    setError(null);
    const done = await act.call(name, variables());
    if (!done.ok) {
      setError(done.message);
      return false;
    }
    props.onRefresh?.();
    return true;
  };
  useCommit(commit, keep);
  return { act, error: error ?? act.error, keep };
}

function Team({
  data,
  props,
  commit,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}): JSX.Element {
  const [team, setTeam] = useState(data.team.map((t) => ({ personId: t.personId, role: t.role })));
  const changed =
    JSON.stringify(team) !==
    JSON.stringify(data.team.map((t) => ({ personId: t.personId, role: t.role })));
  const { act, error, keep } = useKeep(props, commit, changed, 'SetJobTeam', () => ({
    jobId: data.job.id,
    input: { team },
  }));
  const name = (id: string) => data.members.find((m) => m.personId === id)?.name ?? id;
  const body = (
    <div className="flex flex-col gap-4">
      <Refusal error={error} />
      {team.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {team.map((t, i) => (
            <li key={t.personId} className="flex flex-wrap items-center gap-3">
              <Avatar name={name(t.personId)} size="sm" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{name(t.personId)}</span>
              <Select
                value={t.role}
                onValueChange={(v) => {
                  setTeam(team.map((x, j) => (j === i ? { ...x, role: v } : x)));
                }}
              >
                <SelectTrigger aria-label={`${name(t.personId)}’s role`} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {words(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${name(t.personId)}`}
                startIcon={<icons.delete aria-hidden />}
                onClick={() => {
                  setTeam(team.filter((_, j) => j !== i));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <Field>
        <FieldLabel>Add someone</FieldLabel>
        <FieldControl>
          <Combobox
            label="Add someone"
            placeholder="Search people"
            searchPlaceholder="Search people"
            options={data.members
              .filter((m) => !team.some((t) => t.personId === m.personId))
              .map((m) => ({ value: m.personId, label: m.name }))}
            value={null}
            onChange={(v) => {
              if (typeof v === 'string')
                setTeam([
                  ...team,
                  {
                    personId: v,
                    role: team.some((t) => t.role === 'hiring_manager')
                      ? 'interviewer'
                      : 'hiring_manager',
                  },
                ]);
            }}
          />
        </FieldControl>
        <FieldDescription>
          The first person added is the hiring manager; change any role beside the name.
        </FieldDescription>
      </Field>
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={!changed}
            onClick={() => {
              void keep();
            }}
          >
            Save team
          </Button>
        </div>
      ) : null}
    </div>
  );
  return commit === undefined ? (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Hiring team</CardTitle>
        <CardDescription>What each person may see follows their role on this job.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  ) : (
    body
  );
}

/**
 * What a candidate must bring, each a sentence a CV can show, must-have or
 * nice-to-have, weighted. The match on each candidate is read against them.
 */
function Criteria({
  data,
  props,
  commit,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}): JSX.Element {
  const [rows, setRows] = useState(data.criteria);
  const [text, setText] = useState('');
  const [must, setMust] = useState(true);
  const changed = JSON.stringify(rows) !== JSON.stringify(data.criteria);
  const { act, error, keep } = useKeep(props, commit, changed, 'SetJobCriteria', () => ({
    jobId: data.job.id,
    input: { criteria: rows },
  }));
  const add = (): void => {
    if (text.trim() === '') return;
    setRows([...rows, { id: newId(), text: text.trim(), must, weight: 1 }]);
    setText('');
  };
  const body = (
    <div className="flex flex-col gap-4">
      <Refusal error={error} />
      {rows.length === 0 ? null : (
        <ol className="flex flex-col divide-y divide-border">
          {rows.map((c, i) => (
            <li
              key={c.id}
              className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-center"
            >
              <span className="min-w-0 flex-1 text-sm text-pretty">{c.text}</span>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  size="sm"
                  aria-label={`How much “${c.text}” matters`}
                  value={c.must ? 'must' : 'nice'}
                  onValueChange={(v) => {
                    setRows(rows.map((x, j) => (j === i ? { ...x, must: v === 'must' } : x)));
                  }}
                >
                  <SegmentedControlItem value="must">Must have</SegmentedControlItem>
                  <SegmentedControlItem value="nice">Nice to have</SegmentedControlItem>
                </SegmentedControl>
                <SegmentedControl
                  size="sm"
                  aria-label={`Weight of “${c.text}”`}
                  value={String(c.weight)}
                  onValueChange={(v) => {
                    setRows(rows.map((x, j) => (j === i ? { ...x, weight: Number(v) } : x)));
                  }}
                >
                  <SegmentedControlItem value="1">×1</SegmentedControlItem>
                  <SegmentedControlItem value="2">×2</SegmentedControlItem>
                  <SegmentedControlItem value="3">×3</SegmentedControlItem>
                </SegmentedControl>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove “${c.text}”`}
                  startIcon={<icons.delete aria-hidden />}
                  onClick={() => {
                    setRows(rows.filter((_, j) => j !== i));
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      <Field>
        <FieldLabel>A criterion</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            rows={2}
            value={text}
            placeholder="Five years building backend services in production"
            onChange={(e) => {
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
          />
        </FieldControl>
        <FieldDescription>
          One sentence a CV can show. With the match switched on, each candidate is read against it:
          met counts 1, partly met a half, times its weight.
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="The new criterion is"
          value={must ? 'must' : 'nice'}
          onValueChange={(v) => {
            setMust(v === 'must');
          }}
        >
          <SegmentedControlItem value="must">Must have</SegmentedControlItem>
          <SegmentedControlItem value="nice">Nice to have</SegmentedControlItem>
        </SegmentedControl>
        <Button
          variant="secondary"
          startIcon={<icons.add aria-hidden />}
          disabled={text.trim() === ''}
          onClick={add}
        >
          Add criterion
        </Button>
      </div>
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={!changed}
            onClick={() => {
              void keep();
            }}
          >
            Save criteria
          </Button>
        </div>
      ) : null}
    </div>
  );
  return commit === undefined ? (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Criteria</CardTitle>
        <CardDescription>What a candidate must bring, and what is a bonus.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  ) : (
    body
  );
}

const LENGTHS = [15, 30, 45, 60, 90, 120, 180] as const;

/**
 * The interviews in order. Each is a card: its name, how long, who runs it
 * (several may), and the scorecard they fill in. Scheduling starts from these
 * and can change who runs one interview without touching the plan.
 */
function Plan({
  data,
  props,
  commit,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}): JSX.Element {
  const [plan, setPlan] = useState(data.plan);
  const [title, setTitle] = useState('');
  const change = (i: number, patch: Partial<(typeof plan)[number]>): void => {
    setPlan(plan.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const changed = JSON.stringify(plan) !== JSON.stringify(data.plan);
  const { act, error, keep } = useKeep(props, commit, changed, 'SetJobPlan', () => ({
    jobId: data.job.id,
    input: { plan },
  }));
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={error} />
      {plan.length === 0 ? (
        <EmptyState
          icon={<icons.meeting aria-hidden />}
          title="No interviews planned"
          description="Add the first below: a screen, a technical interview, a meeting with the team."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {plan.map((p, i) => (
            <li key={p.key}>
              <Card padded className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Badge size="sm" variant="soft" tone="accent" className="tabular-nums">
                    {String(i + 1)}
                  </Badge>
                  <Input
                    aria-label={`Interview ${String(i + 1)}’s name`}
                    value={p.title}
                    className="min-w-0 flex-1 font-semibold"
                    onChange={(e) => {
                      change(i, { title: e.target.value });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${p.title}`}
                    startIcon={<icons.delete aria-hidden />}
                    onClick={() => {
                      setPlan(plan.filter((_, j) => j !== i));
                    }}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Field className="md:col-span-2">
                    <FieldLabel>Length</FieldLabel>
                    <SegmentedControl
                      aria-label={`${p.title}’s length`}
                      value={String(p.minutes)}
                      onValueChange={(v) => {
                        change(i, { minutes: Number(v) });
                      }}
                    >
                      {[...new Set([...LENGTHS, p.minutes])]
                        .toSorted((x, y) => x - y)
                        .map((m) => (
                          <SegmentedControlItem key={m} value={String(m)}>
                            {m < 60 || m % 60 !== 0 ? `${String(m)} min` : `${String(m / 60)} h`}
                          </SegmentedControlItem>
                        ))}
                    </SegmentedControl>
                  </Field>
                  <Field>
                    <FieldLabel>Interviewers</FieldLabel>
                    <FieldDescription>Invited to every booking of it.</FieldDescription>
                    <FieldControl>
                      <Combobox
                        label={`${p.title}’s interviewers`}
                        multiple
                        chips
                        placeholder="Choose who runs it"
                        searchPlaceholder="Search people"
                        options={data.members.map((m) => ({ value: m.personId, label: m.name }))}
                        value={p.interviewerIds}
                        onChange={(v) => {
                          change(i, {
                            interviewerIds: typeof v === 'string' || v === null ? [] : [...v],
                          });
                        }}
                      />
                    </FieldControl>
                  </Field>
                  <Field>
                    <FieldLabel>Scorecard</FieldLabel>
                    <FieldDescription>What each interviewer rates.</FieldDescription>
                    <Select
                      value={p.scorecardTemplateId ?? 'none'}
                      onValueChange={(v) => {
                        change(i, { scorecardTemplateId: v === 'none' ? null : v });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        <SelectItem value="none">The job’s scorecard</SelectItem>
                        {data.scorecards.map((sc) => (
                          <SelectItem key={sc.id} value={sc.id}>
                            {sc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const key =
            title
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/gu, '_')
              .replace(/^_+|_+$/gu, '')
              .slice(0, 40) || `interview_${String(plan.length + 1)}`;
          setPlan([
            ...plan,
            {
              key: /^[a-z]/u.test(key) ? key : `i_${key}`,
              title: title.trim(),
              minutes: 60,
              interviewerIds: [],
              competencies: [],
              scorecardTemplateId: null,
            },
          ]);
          setTitle('');
        }}
      >
        <Input
          aria-label="A new interview"
          placeholder="Add an interview, e.g. Technical interview"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          startIcon={<icons.add aria-hidden />}
          disabled={title.trim() === ''}
        >
          Add
        </Button>
      </form>
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={!changed || plan.some((p) => p.title.trim() === '')}
            onClick={() => {
              void keep();
            }}
          >
            Save plan
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Ad({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [language, setLanguage] = useState(data.ads[0]?.language ?? data.job.languages[0] ?? 'en');
  const ad = data.ads.find((a) => a.language === language);
  const [title, setTitle] = useState(ad?.title ?? data.job.title);
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  // A draft or a translation replaces what the editor shows; a person edits and saves it.
  const [drafted, setDrafted] = useState<{ html: string; n: number } | null>(null);
  const [intake, setIntake] = useState('');
  const [to, setTo] = useState('');
  const [hints, setHints] = useState<
    Readonly<Partial<Record<number, { explanation: string; suggestion: string }>>>
  >({});
  const errors = (ad?.checks ?? []).filter((c) => c.severity === 'error');
  const take = (data: unknown) => {
    const d = data as { title: string; doc: Record<string, unknown>; html: string };
    setTitle(d.title);
    setDoc(d.doc);
    setDrafted({ html: d.html, n: (drafted?.n ?? 0) + 1 });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle level={2}>The ad</CardTitle>
          <CardDescription>
            Each language is its own version. Salary and terms come from the job, not the text.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Refusal error={act.error} />
          <div className="flex flex-wrap gap-2">
            {[...new Set([...data.job.languages, ...data.ads.map((a) => a.language)])].map((l) => (
              <Button
                key={l}
                size="sm"
                variant={l === language ? 'primary' : 'secondary'}
                onClick={() => {
                  setLanguage(l);
                }}
              >
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
          <Field required>
            <FieldLabel>Title</FieldLabel>
            <FieldControl>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <RichTextEditor
            key={`${language}:${String(drafted?.n ?? 0)}`}
            label="Ad text"
            value={drafted?.html ?? ad?.html ?? ''}
            onChangeJson={setDoc}
            minHeight="20rem"
          />
          <Field>
            <FieldLabel>Draft with the assistant</FieldLabel>
            <FieldDescription>
              What the role is about, in a few lines. The draft replaces the text above; nothing is
              saved until you save it.
            </FieldDescription>
            <FieldControl>
              <Textarea
                autoResize
                value={intake}
                onChange={(e) => {
                  setIntake(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              variant="secondary"
              loading={act.pending}
              disabled={intake.trim() === ''}
              onClick={() => {
                act.run('DraftAd', { jobId: data.job.id, input: { language, intake } }, take);
              }}
            >
              Draft
            </Button>
            {ad === undefined ? null : (
              <>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger aria-label="Translate into" className="w-44">
                    <SelectValue placeholder="Translate into" />
                  </SelectTrigger>
                  <SelectContent>
                    {['en', 'es', 'de', 'hi']
                      .filter((l) => l !== language)
                      .map((l) => (
                        <SelectItem key={l} value={l}>
                          {l.toUpperCase()}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  loading={act.pending}
                  disabled={to === ''}
                  onClick={() => {
                    act.run(
                      'TranslateAd',
                      { jobId: data.job.id, input: { from: language, to } },
                      (d) => {
                        setLanguage(to);
                        take(d);
                      },
                    );
                  }}
                >
                  Translate
                </Button>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              loading={act.pending}
              disabled={title.trim() === '' || (doc === null && ad === undefined)}
              onClick={() => {
                act.run('SaveJobAd', {
                  jobId: data.job.id,
                  language,
                  input: { title, doc: doc ?? { type: 'doc', content: [] } },
                });
              }}
            >
              Save and check
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Checks before publishing</CardTitle>
          <CardDescription>
            {errors.length === 0
              ? 'Nothing blocks publishing'
              : `${String(errors.length)} block publishing`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(ad?.checks ?? []).length === 0 ? (
            <p className="text-sm text-fg-muted">
              {ad === undefined ? 'Save the ad to check it.' : 'Every check passed.'}
            </p>
          ) : null}
          {(ad?.checks ?? []).map((c, i) => (
            <Alert
              key={`${c.code}:${String(i)}`}
              tone={c.severity === 'error' ? 'danger' : 'warning'}
              title={c.match === null ? words(c.code) : `“${c.match.text}”`}
            >
              {`${c.message} (${c.source})`}
              {c.match === null ? null : hints[i] === undefined ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'ExplainAdPhrase',
                      {
                        jobId: data.job.id,
                        input: { language, phrase: c.match?.text ?? '', check: c.message },
                      },
                      (h) => {
                        setHints({
                          ...hints,
                          [i]: h as { explanation: string; suggestion: string },
                        });
                      },
                    );
                  }}
                >
                  Why, and what instead?
                </Button>
              ) : (
                <span className="mt-2 block">{`${hints[i].explanation} Try: “${hints[i].suggestion}”`}</span>
              )}
            </Alert>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Form({
  data,
  props,
  commit,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}): JSX.Element {
  const [fields, setFields] = useState<readonly FormField[]>(data.form?.fields ?? []);
  const [questionnaire, setQuestionnaire] = useState(data.form?.questionnaireId ?? 'none');
  const changed =
    JSON.stringify(fields) !== JSON.stringify(data.form?.fields ?? []) ||
    questionnaire !== (data.form?.questionnaireId ?? 'none');
  const { act, error, keep } = useKeep(props, commit, changed, 'SaveJobForm', () => ({
    jobId: data.job.id,
    input: { fields, questionnaireId: questionnaire === 'none' ? null : questionnaire },
  }));
  const locked = (k: string) => k === 'name' || k === 'email';
  return (
    <div
      className={
        commit === undefined
          ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]'
          : 'flex flex-col gap-4'
      }
    >
      <Card>
        <CardHeader>
          <CardTitle level={2}>Apply form</CardTitle>
          <CardDescription>
            The same definition renders the form on Kithena Jobs, checks the public API and types
            the stored answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Refusal error={error} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Shown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f, i) => (
                <TableRow key={f.key}>
                  <TableCell>{f.label}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${f.label} required`}
                      disabled={locked(f.key)}
                      checked={f.required}
                      onCheckedChange={(on) => {
                        setFields(
                          fields.map((x, j) =>
                            j === i ? { ...x, required: on, shown: on ? true : x.shown } : x,
                          ),
                        );
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${f.label} shown`}
                      disabled={locked(f.key)}
                      checked={f.shown}
                      onCheckedChange={(on) => {
                        setFields(
                          fields.map((x, j) =>
                            j === i ? { ...x, shown: on, required: on ? x.required : false } : x,
                          ),
                        );
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Field>
            <FieldLabel>Questionnaire</FieldLabel>
            <Select value={questionnaire} onValueChange={setQuestionnaire}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {data.questionnaires.map((q) => (
                  <SelectItem
                    key={q.id}
                    value={q.id}
                  >{`${q.name} · v${String(q.version)}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Screening questions asked on the apply form, written under Settings, Pipelines and
              approvals.
            </FieldDescription>
          </Field>
          <Alert tone="info" title="Knockout answers">
            A knockout answer flags the application for the team. Where the questionnaire lets it
            reject on its own, the application is rejected and the rejection email sent the next
            working day at 09:00 in the candidate’s time zone, never the moment they apply. Until
            then the team sees it flagged and can move it on instead.
          </Alert>
          {commit === undefined ? (
            <div className="flex justify-end">
              <Button
                loading={act.pending}
                disabled={!changed}
                onClick={() => {
                  void keep();
                }}
              >
                Save form
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Never asked</CardTitle>
          <CardDescription>A Kithena rule, not a setting</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {[
            'Date of birth',
            'Photo',
            'Marital status',
            'Religion',
            'Health',
            'Pregnancy',
            'Nationality',
            'Trade union',
            'Gender',
          ].map((x) => (
            <Badge key={x} size="sm">
              {x}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Publishing({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [previewing, setPreviewing] = useState(false);
  const share = data.targets.find((t) => t.target === 'share_link' && t.state === 'live');
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      {data.job.state !== 'open' ? (
        <Alert tone="info" title="Open the job to publish it">
          A draft or a job on hold is on no target.
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle level={2}>Where it’s published</CardTitle>
          <CardDescription>
            Each target has its own state, address and source tag, so every application is
            attributed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>State</TableHead>
                <TableHead>
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TARGETS.map((t) => {
                const held = data.targets.find((x) => x.target === t.key);
                const available = t.available || data.boards.includes(t.key);
                return (
                  <TableRow key={t.key}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-medium">{t.label}</span>
                        <span className="text-sm text-fg-muted">
                          {held?.error ?? held?.url ?? t.what}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {held === undefined ? (
                        <Badge size="sm">{available ? 'Not published' : 'Not available'}</Badge>
                      ) : (
                        <StateBadge state={held.state} />
                      )}
                    </TableCell>
                    <TableCell>
                      {available &&
                      (held === undefined ||
                        held.state === 'expired' ||
                        held.state === 'failed') ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={data.job.state !== 'open'}
                          loading={act.pending}
                          onClick={() => {
                            act.run('PublishJob', { jobId: data.job.id, target: t.key });
                          }}
                        >
                          Publish
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>How it looks on Kithena Jobs</CardTitle>
          <CardDescription>
            The ad as a candidate will see it, before and after publishing. The preview is the
            team’s for a day; search engines never see it and nobody can apply from it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Dialog open={previewing} onOpenChange={setPreviewing}>
            <div className="flex flex-wrap gap-2">
              <DialogTrigger asChild>
                <Button variant="secondary" startIcon={<icons.visible aria-hidden />}>
                  Preview the ad
                </Button>
              </DialogTrigger>
              <Button asChild variant="ghost" startIcon={<icons.externalLink aria-hidden />}>
                <a href={data.preview} target="_blank" rel="noreferrer">
                  Open in a new tab
                </a>
              </Button>
            </div>
            <DialogContent className="h-[90vh] w-[min(96vw,80rem)] max-w-none p-0">
              <DialogHeader className="px-6 pt-5">
                <DialogTitle>Preview on Kithena Jobs</DialogTitle>
                <DialogDescription>{`${data.job.title} · as a candidate sees it`}</DialogDescription>
              </DialogHeader>
              <DialogBody className="min-h-0 flex-1 p-0">
                <iframe
                  title="Preview on Kithena Jobs"
                  src={data.preview}
                  className="size-full rounded-b-[inherit] border-0 bg-canvas"
                />
              </DialogBody>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
      {share?.url == null ? null : <CopyField label="Share link" value={share.url} />}
      {data.chat === null ? null : <ChatChannel data={data} props={props} />}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          startIcon={<icons.stop aria-hidden />}
          loading={act.pending}
          onClick={() => {
            act.run('UnpublishJob', { jobId: data.job.id });
          }}
        >
          Unpublish everywhere
        </Button>
      </div>
    </div>
  );
}

/** REC-137: each morning, yesterday's new applicants are posted to this channel. */
function ChatChannel({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [channel, setChannel] = useState(data.chat?.channel ?? '');
  const save = (value: string | null) => {
    act.run('SetJobChatChannel', { jobId: data.job.id, input: { channel: value } });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>New applicants in Slack</CardTitle>
        <CardDescription>
          Each morning, yesterday’s new applicants are posted to this channel. Invite Kithena to the
          channel first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel>Channel ID</FieldLabel>
          <FieldControl>
            <Input
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value.trim());
              }}
              placeholder="C0123456789"
            />
          </FieldControl>
          <FieldDescription>
            In Slack, open the channel’s details; the ID is at the bottom.
          </FieldDescription>
        </Field>
        <div className="flex gap-2">
          <Button
            size="sm"
            loading={act.pending}
            disabled={channel === '' || channel === data.chat?.channel}
            onClick={() => {
              save(channel);
            }}
          >
            Save
          </Button>
          {data.chat?.channel == null ? null : (
            <Button
              size="sm"
              variant="secondary"
              loading={act.pending}
              onClick={() => {
                setChannel('');
                save(null);
              }}
            >
              Stop posting
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The parts of a job edited in a panel of their own, off the ad or inside the setup. */
type Part = 'details' | 'team' | 'criteria' | 'plan' | 'ad' | 'form' | 'publishing';

const PART_TITLE: Readonly<Record<Part, string>> = {
  details: 'Internal details',
  team: 'Hiring team',
  criteria: 'Criteria',
  plan: 'Interview plan',
  ad: 'Languages and checks',
  form: 'Apply form',
  publishing: 'Publishing',
};

const WEEKDAY: Readonly<Record<number, string>> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

const MODE: Readonly<Record<string, string>> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

function PartBody({
  part,
  data,
  props,
  commit,
}: {
  readonly part: Part;
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  /** Inside the setup: the part's edits are kept when the setup moves on. */
  readonly commit?: Commit | undefined;
}): JSX.Element {
  switch (part) {
    case 'details':
      return <Details data={data} props={props} />;
    case 'team':
      return <Team data={data} props={props} commit={commit} />;
    case 'criteria':
      return <Criteria data={data} props={props} commit={commit} />;
    case 'plan':
      return <Plan data={data} props={props} commit={commit} />;
    case 'ad':
      return <Ad data={data} props={props} />;
    case 'form':
      return <Form data={data} props={props} commit={commit} />;
    case 'publishing':
      return <Publishing data={data} props={props} />;
  }
}

/** One region of the ad as the team sees it: press anywhere on it to edit that part. */
function Region({
  title,
  onEdit,
  children,
  className,
}: {
  readonly title: string;
  readonly onEdit: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <Card padded interactive className={cn('relative', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg-muted">{title}</h3>
        <Button
          size="xs"
          variant="ghost"
          startIcon={<icons.edit aria-hidden />}
          className="after:absolute after:inset-0"
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
      {children}
    </Card>
  );
}

/**
 * A part of the ad, shown as candidates will read it, that opens its own
 * editor when pressed. The pencil shows on pointing; under a finger, always.
 */
function Editable({
  label,
  onEdit,
  children,
  className,
}: {
  /** What pressing it edits, said to a screen reader: "the pay". */
  readonly label: string;
  readonly onEdit: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <Card
      variant="bare"
      interactive
      className={cn('group/edit relative -mx-3 flex items-start gap-2 px-3 py-2', className)}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        size="xs"
        variant="ghost"
        startIcon={<icons.edit aria-hidden />}
        aria-label={`Edit ${label}`}
        className="opacity-0 transition-opacity group-hover/edit:opacity-100 focus-visible:opacity-100 after:absolute after:inset-0 touch:opacity-100"
        onClick={onEdit}
      />
    </Card>
  );
}

/** The panels that are not a page of the setup: the rest of the details, languages and checks, publishing. */
const SHEET_PARTS = ['details', 'ad', 'publishing'] as const;

/**
 * R4–R7 and R14, a job's setup. A new job is set up on a page of its own, a
 * few questions at a time. After that, and straight after the setup, the page
 * is the ad as a candidate will read it, under the company's name and logo:
 * the title, each fact, the pay, the words, the benefits and the interviews
 * each open their own editor when pressed, and Publish is at the top. What
 * only the team sees sits under the ad.
 */
export function JobSetup(props: ScreenProps<JobData>): JSX.Element {
  const act = useAct(props);
  if (props.params?.['id'] === 'new')
    return (
      <NewJobWizard
        {...props}
        part={(p, commit, data, here) => (
          <PartBody part={p} data={data} props={here} commit={commit} />
        )}
      />
    );
  const wizard = props.search?.['setup'] === '1';
  const asked = props.search?.['edit'] ?? null;
  const part = SHEET_PARTS.find((p) => p === asked);
  // Any other part pressed is a page of the setup, or one question on it, in a panel.
  const focus = part === undefined && asked !== null && isSetupPart(asked) ? asked : null;
  const edit = (next: string | null) => props.onFilter?.({ edit: next });
  return (
    <Loaded load={props.load} what="the job">
      {(data) => {
        const ad = data.ads[0];
        const live = data.targets.some((t) => t.target === 'kithena_jobs' && t.state === 'live');
        const places = data.locations.filter((l) => data.job.locationIds.includes(l.id));
        const company = data.company ?? { name: 'Your company', logoUrl: null };
        const pay =
          data.job.salary === null
            ? null
            : `${range(data.job.salary.minMinor, data.job.salary.maxMinor, data.job.salary.currency)} a ${data.job.salary.period}`;
        const mode = `${MODE[data.job.workMode] ?? data.job.workMode}${
          data.terms.workMode === 'hybrid' && data.terms.hybridDaysOnsite !== null
            ? `, ${String(data.terms.hybridDaysOnsite)} days on site${
                data.terms.hybridOnsiteDays === null
                  ? ', any days'
                  : data.terms.hybridOnsiteDays.length === 0
                    ? ''
                    : ` (${data.terms.hybridOnsiteDays.map((d) => WEEKDAY[d] ?? '').join(', ')})`
              }`
            : ''
        }`;
        const hours =
          data.options.weeklyMinutes === null
            ? words(data.job.outline.hours)
            : `${hoursOf(data.options.weeklyMinutes)} a week`;
        const where = places.length === 0 ? null : places.map((l) => l.name).join(', ');
        // Each fact at the top of the ad, and the part of the setup that changes it.
        const facts: readonly {
          key: string;
          label: string;
          icon: ReactNode;
          value: string | null;
          missing: string;
        }[] = [
          {
            key: 'where',
            label: 'the workplace',
            icon: <icons.location aria-hidden />,
            value: where,
            missing: 'Add the workplace',
          },
          {
            key: 'mode',
            label: 'the work mode',
            icon: <icons.home aria-hidden />,
            value: mode,
            missing: 'Add the work mode',
          },
          {
            key: 'contract',
            label: 'the contract',
            icon: <icons.agreement aria-hidden />,
            value: data.job.outline.contractType,
            missing: 'Add the contract',
          },
          {
            key: 'time',
            label: 'the hours',
            icon: <icons.pending aria-hidden />,
            value: hours,
            missing: 'Add the hours',
          },
          {
            key: 'salary',
            label: 'the pay',
            icon: <icons.payment aria-hidden />,
            value: pay === null ? null : data.job.salaryShown ? pay : `${pay}, not shown`,
            missing: 'Add the pay',
          },
          {
            key: 'level',
            label: 'the team and level',
            icon: <icons.goal aria-hidden />,
            value:
              [
                data.job.outline.seniority === null ? null : words(data.job.outline.seniority),
                data.job.department,
              ]
                .filter((v) => v !== null)
                .join(' · ') || null,
            missing: 'Add the team and level',
          },
        ];
        const rail = [
          { label: 'Location', value: where ?? 'Not set' },
          { label: 'Work mode', value: mode },
          { label: 'Contract', value: data.job.outline.contractType ?? 'Not set' },
          { label: 'Hours', value: hours },
          {
            label: 'Holiday',
            value:
              data.terms.vacationDays === null
                ? 'Not set'
                : `${String(data.terms.vacationDays)} days a year`,
          },
        ];
        const blocking = (ad?.checks ?? []).filter((c) => c.severity === 'error').length;
        // What the ad offers: the chosen benefits and every statutory one.
        const offered = data.options.benefits.filter(
          (b) => b.statutory || data.job.benefitIds.includes(b.id),
        );
        const asks = (data.form?.fields ?? []).filter((f) => f.shown);
        const publish = (): void => {
          const go = (): void => {
            act.run('PublishJob', { jobId: data.job.id, target: 'kithena_jobs' });
          };
          if (data.job.state === 'open') go();
          else act.run('MoveJob', { jobId: data.job.id, input: { to: 'open' } }, go);
        };
        return (
          <div className="flex flex-col gap-6">
            <PageHeader
              title={data.job.title}
              meta={<StateBadge state={data.job.state} />}
              description={
                live
                  ? 'Live. Press any part of the ad to change it.'
                  : 'The ad as candidates will read it. Press any part to change it, then publish.'
              }
              actions={
                <>
                  <Button
                    variant="secondary"
                    startIcon={<icons.people aria-hidden />}
                    onClick={() => props.onNavigate?.(`/recruiting/jobs/${data.job.id}`)}
                  >
                    Pipeline
                  </Button>
                  <Button
                    variant="secondary"
                    startIcon={<icons.settings aria-hidden />}
                    onClick={() => props.onFilter?.({ setup: '1', step: null })}
                  >
                    Guided setup
                  </Button>
                  {data.job.state === 'open' ? (
                    <Button
                      variant="secondary"
                      loading={act.pending}
                      onClick={() => {
                        act.run('MoveJob', { jobId: data.job.id, input: { to: 'on_hold' } });
                      }}
                    >
                      Put on hold
                    </Button>
                  ) : null}
                  {live ? (
                    <Button
                      variant="secondary"
                      startIcon={<icons.externalLink aria-hidden />}
                      onClick={() => {
                        edit('publishing');
                      }}
                    >
                      Live on Kithena Jobs
                    </Button>
                  ) : ad === undefined ? (
                    <Button
                      startIcon={<icons.assistant aria-hidden />}
                      onClick={() => {
                        edit('description');
                      }}
                    >
                      Write the description to publish
                    </Button>
                  ) : blocking > 0 ? (
                    <Button
                      startIcon={<icons.warning aria-hidden />}
                      onClick={() => {
                        edit('ad');
                      }}
                    >
                      {`Fix ${String(blocking)} ${blocking === 1 ? 'check' : 'checks'} to publish`}
                    </Button>
                  ) : (
                    <Button
                      startIcon={<icons.send aria-hidden />}
                      loading={act.pending}
                      onClick={publish}
                    >
                      Publish
                    </Button>
                  )}
                </>
              }
            />
            <Refusal error={act.error} />

            {/* The ad as Kithena Jobs lays it out: the company, the title, the facts, the words, the rail. */}
            <article className="overflow-hidden rounded-2xl bg-canvas shadow-md">
              <header className="flex flex-col gap-5 bg-accent-subtle/60 px-5 pt-8 pb-10 sm:px-10 sm:pt-12 sm:pb-14">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={company.name}
                    src={company.logoUrl ?? undefined}
                    shape="rounded"
                    fit={company.logoUrl === null ? 'cover' : 'contain'}
                    size="lg"
                  />
                  <span className="font-semibold">{company.name}</span>
                </div>
                <Editable
                  label="the title"
                  onEdit={() => {
                    edit('title');
                  }}
                  className="-my-2"
                >
                  <h2 className="text-4xl font-bold tracking-[-0.02em] text-balance sm:text-5xl">
                    {data.job.title}
                  </h2>
                </Editable>
                <ul
                  className="-mx-3 flex flex-wrap gap-x-1 gap-y-1 text-base"
                  aria-label="At a glance"
                >
                  {facts.map((f) => (
                    <li key={f.key} className="mx-3">
                      <Editable
                        label={f.label}
                        onEdit={() => {
                          edit(f.key);
                        }}
                        className="py-1"
                      >
                        <span className="flex items-center gap-2 [&_svg]:size-[18px] [&_svg]:text-accent-fg">
                          {f.icon}
                          {f.value === null ? (
                            <span className="text-fg-muted">{f.missing}</span>
                          ) : (
                            <span className={f.key === 'salary' ? 'font-semibold' : undefined}>
                              {f.value}
                            </span>
                          )}
                        </span>
                      </Editable>
                    </li>
                  ))}
                </ul>
              </header>

              <div className="grid gap-10 px-5 py-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
                <div className="flex min-w-0 flex-col gap-8">
                  <Editable
                    label="the description"
                    onEdit={() => {
                      edit('description');
                    }}
                  >
                    {ad === undefined ? (
                      <EmptyState
                        icon={<icons.document aria-hidden />}
                        title="No description yet"
                        description="AI writes it from the job, its criteria and the interviews. Press to write it."
                      />
                    ) : (
                      <RichTextContent sanitisedHtml={ad.html} className="job-ad" />
                    )}
                  </Editable>
                  <Editable
                    label="the benefits"
                    onEdit={() => {
                      edit('benefits');
                    }}
                  >
                    <section className="flex flex-col gap-5">
                      <h3 className="text-2xl font-bold tracking-[-0.01em]">What we offer</h3>
                      {offered.length === 0 ? (
                        <p className="text-fg-muted">
                          No benefits chosen yet. Press to choose them by category.
                        </p>
                      ) : (
                        <BenefitList benefits={offered} categories={data.options.categories} />
                      )}
                    </section>
                  </Editable>
                  <Editable
                    label="the interviews"
                    onEdit={() => {
                      edit('interviews');
                    }}
                  >
                    <section className="flex flex-col gap-4">
                      <h3 className="text-2xl font-bold tracking-[-0.01em]">How we hire</h3>
                      {data.plan.length === 0 ? (
                        <p className="text-fg-muted">No interviews planned yet.</p>
                      ) : (
                        <Timeline>
                          {data.plan.map((p, i) => (
                            <TimelineItem
                              key={p.key}
                              title={p.title}
                              tone={i === 0 ? 'accent' : 'neutral'}
                              icon={<Badge size="sm">{String(i + 1)}</Badge>}
                            />
                          ))}
                        </Timeline>
                      )}
                    </section>
                  </Editable>
                </div>

                {/* The rail: what it pays and the way in, as a candidate sees them beside the words. */}
                <aside className="flex min-w-0 flex-col lg:sticky lg:top-6 lg:self-start">
                  <Card variant="elevated" className="flex flex-col gap-4 p-5">
                    <Editable
                      label="the pay"
                      onEdit={() => {
                        edit('salary');
                      }}
                    >
                      {pay === null ? (
                        <p className="text-lg font-semibold text-fg-muted">No pay yet</p>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-sm text-fg-muted">
                            {data.job.salaryShown ? 'Pays' : 'Pays, not shown to candidates'}
                          </span>
                          <span className="text-2xl font-bold tracking-[-0.01em]">{pay}</span>
                        </div>
                      )}
                    </Editable>
                    <Editable
                      label="the apply form"
                      onEdit={() => {
                        edit('apply');
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <Button size="lg" disabled tabIndex={-1} className="w-full">
                          Apply now
                        </Button>
                        <p className="text-sm text-fg-muted">
                          {asks.length === 0
                            ? 'Asks for the name, email and CV.'
                            : `Asks for the name, email, CV and ${asks.map((f) => f.label.toLowerCase()).join(', ')}.`}
                        </p>
                      </div>
                    </Editable>
                    <KeyValues
                      items={rail}
                      layout="aligned"
                      labelWidth="6rem"
                      className="text-sm"
                    />
                  </Card>
                </aside>
              </div>
            </article>

            {/* What candidates never see: who hires, on what, how many, and where the ad goes. */}
            <section className="flex flex-col gap-3" aria-labelledby="team-only">
              <h2 id="team-only" className="text-lg font-semibold">
                Only your team sees this
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Region
                  title="Hiring team"
                  onEdit={() => {
                    edit('team');
                  }}
                >
                  {data.team.length === 0 ? (
                    <p className="text-sm text-fg-muted">Nobody yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {data.team.map((m) => (
                        <li key={m.personId} className="flex items-center gap-2 text-sm">
                          <Avatar name={m.name ?? m.personId} size="xs" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{m.name ?? m.personId}</span>
                          <span className="text-xs text-fg-muted">{words(m.role)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Region>
                <Region
                  title="What we look for"
                  onEdit={() => {
                    edit('criteria');
                  }}
                >
                  {data.criteria.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      No criteria yet; the AI matrix needs them.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {data.criteria.map((c) => (
                        <li key={c.id} className="flex items-start gap-2">
                          <Badge size="xs" tone={c.must ? 'accent' : 'neutral'}>
                            {c.must ? 'Must' : 'Nice'}
                          </Badge>
                          <span>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Region>
                <Region
                  title="Openings and start"
                  onEdit={() => {
                    edit('openings');
                  }}
                >
                  <KeyValues
                    items={[
                      { label: 'Openings', value: String(data.job.openings) },
                      { label: 'Target start', value: day(data.job.targetHireDate) },
                    ]}
                    layout="aligned"
                    labelWidth="7rem"
                    className="text-sm"
                  />
                </Region>
                <Region
                  title="Where it is published"
                  onEdit={() => {
                    edit('publishing');
                  }}
                >
                  {data.targets.filter((t) => t.state === 'live').length === 0 ? (
                    <p className="text-sm text-fg-muted">Nowhere yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {data.targets
                        .filter((t) => t.state === 'live')
                        .map((t) => (
                          <li key={t.target}>
                            {TARGETS.find((x) => x.key === t.target)?.label ?? words(t.target)}
                          </li>
                        ))}
                    </ul>
                  )}
                </Region>
                <Region
                  title="Languages and checks"
                  onEdit={() => {
                    edit('ad');
                  }}
                >
                  <p className="text-sm text-fg-muted">
                    {ad === undefined
                      ? 'No ad yet.'
                      : blocking > 0
                        ? `${String(blocking)} ${blocking === 1 ? 'check blocks' : 'checks block'} publishing.`
                        : `In ${data.ads.map((a) => a.language.toUpperCase()).join(', ')}. Every check passes.`}
                  </p>
                </Region>
                <Region
                  title="Internal details"
                  onEdit={() => {
                    edit('details');
                  }}
                >
                  <KeyValues
                    items={[
                      {
                        label: 'Internal title',
                        value:
                          data.job.internalTitle === '' ? 'Same as the ad' : data.job.internalTitle,
                      },
                      { label: 'Internal only', value: data.job.internalOnly ? 'Yes' : 'No' },
                      { label: 'Confidential', value: data.job.confidential ? 'Yes' : 'No' },
                    ]}
                    layout="aligned"
                    labelWidth="7rem"
                    className="text-sm"
                  />
                </Region>
              </div>
            </section>

            {/* The rest of the details, the languages and checks, publishing: a panel off the ad. */}
            <Sheet
              open={part !== undefined}
              onOpenChange={(open) => {
                if (!open) edit(null);
              }}
            >
              <SheetContent size="xl">
                <SheetHeader>
                  <SheetTitle>{part === undefined ? '' : PART_TITLE[part]}</SheetTitle>
                </SheetHeader>
                <SheetBody>
                  {part === undefined ? null : <PartBody part={part} data={data} props={props} />}
                </SheetBody>
              </SheetContent>
            </Sheet>

            {/* The setup: a page of its own over the ad, or one part of it in a panel when pressed. */}
            <JobWizard
              open={wizard || focus !== null}
              focus={wizard ? null : focus}
              data={data}
              props={props}
              stepKey={props.search?.['step'] ?? null}
              entered={props.search?.['entered'] === '1'}
              onClose={() =>
                props.onFilter?.({ setup: null, step: null, entered: null, edit: null })
              }
              onFinish={() => props.onFilter?.({ setup: null, step: null, entered: null })}
              part={(p, commit) => <PartBody part={p} data={data} props={props} commit={commit} />}
            />
          </div>
        );
      }}
    </Loaded>
  );
}
