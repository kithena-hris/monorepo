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
  Banner,
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
  cn,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, newId, range, useAct, words } from './shared';
import { BenefitList } from './benefits';
import { BenefitsChoice, TermsCards, hoursOf } from './job-terms';
import { JobWizard, NewJobWizard } from './job-wizard';
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

function Team({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [team, setTeam] = useState(data.team.map((t) => ({ personId: t.personId, role: t.role })));
  const [adding, setAdding] = useState('');
  const name = (id: string) => data.members.find((m) => m.personId === id)?.name ?? id;
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Hiring team</CardTitle>
        <CardDescription>Who may see what is set by the role on this job</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.map((t, i) => (
              <TableRow key={`${t.personId}:${String(i)}`}>
                <TableCell>{name(t.personId)}</TableCell>
                <TableCell>
                  <Select
                    value={t.role}
                    onValueChange={(v) => {
                      setTeam(team.map((x, j) => (j === i ? { ...x, role: v } : x)));
                    }}
                  >
                    <SelectTrigger aria-label={`${name(t.personId)}’s role`} className="w-44">
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
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${name(t.personId)}`}
                    startIcon={<icons.delete aria-hidden />}
                    onClick={() => {
                      setTeam(team.filter((_, j) => j !== i));
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={adding} onValueChange={setAdding}>
            <SelectTrigger aria-label="Add a person" className="w-64">
              <SelectValue placeholder="Add a person…" />
            </SelectTrigger>
            <SelectContent>
              {data.members
                .filter((m) => !team.some((t) => t.personId === m.personId))
                .map((m) => (
                  <SelectItem key={m.personId} value={m.personId}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            disabled={adding === ''}
            onClick={() => {
              setTeam([...team, { personId: adding, role: 'interviewer' }]);
              setAdding('');
            }}
          >
            Add
          </Button>
          <span className="flex-1" />
          <Button
            loading={act.pending}
            onClick={() => {
              act.run('SetJobTeam', { jobId: data.job.id, input: { team } });
            }}
          >
            Save team
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Criteria({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [rows, setRows] = useState(data.criteria);
  const [text, setText] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle level={2}>Criteria</CardTitle>
          <CardDescription>
            Each a sentence a CV can show. The weight sets how much it counts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Refusal error={act.error} />
          {rows.map((c, i) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 border-b border-[var(--reach-line)] pb-2"
            >
              <span className="min-w-0 flex-1">{c.text}</span>
              <Badge size="sm" tone={c.must ? 'accent' : 'neutral'}>
                {c.must ? 'Must have' : 'Nice to have'}
              </Badge>
              <SegmentedControl
                size="sm"
                value={String(c.weight)}
                onValueChange={(v) => {
                  setRows(rows.map((x, j) => (j === i ? { ...x, weight: Number(v) } : x)));
                }}
                aria-label="Weight"
              >
                <SegmentedControlItem value="1">×1</SegmentedControlItem>
                <SegmentedControlItem value="2">×2</SegmentedControlItem>
                <SegmentedControlItem value="3">×3</SegmentedControlItem>
              </SegmentedControl>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${c.text}`}
                startIcon={<icons.delete aria-hidden />}
                onClick={() => {
                  setRows(rows.filter((_, j) => j !== i));
                }}
              />
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setRows([...rows, { id: newId(), text: text.trim(), must: true, weight: 1 }]);
              setText('');
            }}
          >
            <Input
              aria-label="A criterion"
              placeholder="Five years building backend services in production"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
            <Button type="submit" variant="secondary" disabled={text.trim() === ''}>
              Add
            </Button>
          </form>
          <div className="flex justify-end">
            <Button
              loading={act.pending}
              onClick={() => {
                act.run('SetJobCriteria', { jobId: data.job.id, input: { criteria: rows } });
              }}
            >
              Save criteria
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card padded>
        <p className="text-sm text-fg-muted">
          With the matrix switched on, a model returns Met, Partly met, Not met or Not evidenced for
          each, with the passages that support it. Kithena checks every quote and computes the
          score: met 1, partly 0.5, weighted. A weak band is a label, never a stage.
        </p>
      </Card>
    </div>
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
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [plan, setPlan] = useState(data.plan);
  const [title, setTitle] = useState('');
  const change = (i: number, patch: Partial<(typeof plan)[number]>): void => {
    setPlan(plan.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const changed = JSON.stringify(plan) !== JSON.stringify(data.plan);
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
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
      <div className="flex justify-end">
        <Button
          loading={act.pending}
          disabled={!changed || plan.some((p) => p.title.trim() === '')}
          onClick={() => {
            act.run('SetJobPlan', { jobId: data.job.id, input: { plan } });
          }}
        >
          Save plan
        </Button>
      </div>
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
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [fields, setFields] = useState<readonly FormField[]>(data.form?.fields ?? []);
  const [questionnaire, setQuestionnaire] = useState(data.form?.questionnaireId ?? 'none');
  const locked = (k: string) => k === 'name' || k === 'email';
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle level={2}>Apply form</CardTitle>
          <CardDescription>
            The same definition renders the form on Kithena Jobs, checks the public API and types
            the stored answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Refusal error={act.error} />
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
              approvals. A knockout answer flags the application on the board, or rejects it where
              the questionnaire says so.
            </FieldDescription>
          </Field>
          <div className="flex justify-end">
            <Button
              loading={act.pending}
              onClick={() => {
                act.run('SaveJobForm', {
                  jobId: data.job.id,
                  input: {
                    fields,
                    questionnaireId: questionnaire === 'none' ? null : questionnaire,
                  },
                });
              }}
            >
              Save form
            </Button>
          </div>
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

/** The parts of a job a person edits, each in its own sheet off the ad. */
const PARTS = [
  'details',
  'terms',
  'benefits',
  'team',
  'criteria',
  'plan',
  'ad',
  'form',
  'publishing',
] as const;
type Part = (typeof PARTS)[number];

const PART_TITLE: Readonly<Record<Part, string>> = {
  details: 'Job details',
  terms: 'Workplace, terms and pay',
  benefits: 'Benefits',
  team: 'Hiring team',
  criteria: 'Criteria',
  plan: 'Interview plan',
  ad: 'The ad',
  form: 'Apply form',
  publishing: 'Publishing',
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
}: {
  readonly part: Part;
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  switch (part) {
    case 'details':
      return <Details data={data} props={props} />;
    case 'terms':
      return <TermsCards data={data} props={props} />;
    case 'benefits':
      return <BenefitsChoice data={data} props={props} />;
    case 'team':
      return <Team data={data} props={props} />;
    case 'criteria':
      return <Criteria data={data} props={props} />;
    case 'plan':
      return <Plan data={data} props={props} />;
    case 'ad':
      return <Ad data={data} props={props} />;
    case 'form':
      return <Form data={data} props={props} />;
    case 'publishing':
      return <Publishing data={data} props={props} />;
  }
}

/** One region of the ad as the team sees it: press anywhere on it to edit that part. */
function Region({
  title,
  part,
  onEdit,
  children,
  className,
}: {
  readonly title: string;
  readonly part: Part;
  readonly onEdit: (part: Part) => void;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <Card padded interactive className={cn('group/region relative', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg-muted">{title}</h2>
        <Button
          size="xs"
          variant="ghost"
          startIcon={<icons.edit aria-hidden />}
          className="after:absolute after:inset-0"
          onClick={() => {
            onEdit(part);
          }}
        >
          Edit
        </Button>
      </div>
      {children}
    </Card>
  );
}

/**
 * R4–R7 and R14, a job's setup. A new job is a stepper in a dialog: job and
 * team, criteria, interviews, the apply form, then the ad, drafted with AI
 * from everything before it. After that the page is the ad as a candidate
 * will read it, every region pressed to edit that part in a sheet, and one
 * primary press to publish.
 */
export function JobSetup(props: ScreenProps<JobData>): JSX.Element {
  const act = useAct(props);
  if (props.params?.['id'] === 'new') return <NewJobWizard {...props} />;
  const wizard = props.search?.['setup'] === '1';
  const part = PARTS.find((p) => p === props.search?.['edit']);
  const edit = (next: Part | null) => props.onFilter?.({ edit: next });
  return (
    <Loaded load={props.load} what="the job">
      {(data) => {
        const ad = data.ads[0];
        const live = data.targets.some((t) => t.target === 'kithena_jobs' && t.state === 'live');
        const places = data.locations.filter((l) => data.job.locationIds.includes(l.id));
        const pay =
          data.job.salary === null
            ? 'Not set'
            : `${range(data.job.salary.minMinor, data.job.salary.maxMinor, data.job.salary.currency)} a ${data.job.salary.period}${data.job.salaryShown ? '' : ', not shown'}`;
        const terms = [
          {
            label: 'Workplace',
            value: places.length === 0 ? 'Not set' : places.map((l) => l.name).join(', '),
          },
          {
            label: 'Work mode',
            value: `${MODE[data.job.workMode] ?? data.job.workMode}${data.terms.workMode === 'hybrid' && data.terms.hybridDaysOnsite !== null ? `, ${String(data.terms.hybridDaysOnsite)} days on site` : ''}`,
          },
          { label: 'Contract', value: data.job.outline.contractType ?? 'Not set' },
          {
            label: 'Hours',
            value:
              data.options.weeklyMinutes === null
                ? words(data.job.outline.hours)
                : `${hoursOf(data.options.weeklyMinutes)} a week, ${words(data.job.outline.hours).toLowerCase()}`,
          },
          {
            label: 'Holiday',
            value:
              data.terms.vacationDays === null
                ? 'Not set'
                : `${String(data.terms.vacationDays)} days a year`,
          },
          { label: 'Pay', value: pay },
        ];
        const facts = [
          {
            label: 'Level',
            value: data.job.outline.seniority ? words(data.job.outline.seniority) : 'Not set',
          },
          { label: 'Team', value: data.job.department ?? 'Not set' },
          { label: 'Openings', value: String(data.job.openings) },
        ];
        const blocking = (ad?.checks ?? []).filter((c) => c.severity === 'error').length;
        // What the ad offers: the chosen benefits and every statutory one.
        const offered = data.options.benefits.filter(
          (b) => b.statutory || data.job.benefitIds.includes(b.id),
        );
        const publish = (): void => {
          const go = (): void => {
            act.run('PublishJob', { jobId: data.job.id, target: 'kithena_jobs' });
          };
          if (data.job.state === 'open') go();
          else act.run('MoveJob', { jobId: data.job.id, input: { to: 'open' } }, go);
        };
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={data.job.title}
              meta={<StateBadge state={data.job.state} />}
              description={
                ad === undefined
                  ? 'No ad yet. Set the job up and draft one.'
                  : 'The ad as a candidate reads it. Press a part to change it.'
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
                  ) : null}
                </>
              }
            />
            <Refusal error={act.error} />
            {/* Before it is live: the one thing left to do, said once, with the press that does it. */}
            {live ? null : (
              <Banner
                tone={ad === undefined || blocking > 0 ? 'warning' : 'accent'}
                rounded
                icon={<icons.send aria-hidden />}
                title={
                  ad === undefined
                    ? 'Not published. The ad has no description yet.'
                    : blocking > 0
                      ? `Not published. ${String(blocking)} ${blocking === 1 ? 'check blocks' : 'checks block'} publishing.`
                      : 'Ready to publish.'
                }
                actions={
                  ad === undefined || blocking > 0 ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        edit('ad');
                      }}
                    >
                      {ad === undefined ? 'Write the description' : 'See the checks'}
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      startIcon={<icons.send aria-hidden />}
                      loading={act.pending}
                      onClick={publish}
                    >
                      {data.job.state === 'open' ? 'Publish on Kithena Jobs' : 'Open and publish'}
                    </Button>
                  )
                }
              >
                This is the ad as candidates will read it. Press any part to change it.
              </Banner>
            )}
            {/* The ad as Kithena Jobs lays it out: the facts, the words, the rail. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex min-w-0 flex-col gap-4">
                <Region title="The role" part="details" onEdit={edit}>
                  <h3 className="text-2xl font-bold tracking-[-0.01em]">{data.job.title}</h3>
                  <KeyValues
                    items={facts}
                    layout="aligned"
                    labelWidth="7rem"
                    className="mt-3 text-sm"
                  />
                </Region>
                <Region title="Workplace, terms and pay" part="terms" onEdit={edit}>
                  <KeyValues items={terms} layout="aligned" labelWidth="7rem" className="text-sm" />
                </Region>
                <Region title="The ad" part="ad" onEdit={edit}>
                  {ad === undefined ? (
                    <EmptyState
                      icon={<icons.document aria-hidden />}
                      title="No ad yet"
                      description="Draft one with AI from the job, its criteria and the interview plan, or write it."
                      action={
                        <Button
                          size="sm"
                          startIcon={<icons.assistant aria-hidden />}
                          onClick={() => {
                            edit('ad');
                          }}
                        >
                          Draft the ad
                        </Button>
                      }
                    />
                  ) : (
                    <RichTextContent sanitisedHtml={ad.html} />
                  )}
                </Region>
                <Region title="What we offer" part="benefits" onEdit={edit}>
                  {offered.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      No benefits chosen yet. Press to choose them by category.
                    </p>
                  ) : (
                    <BenefitList benefits={offered} categories={data.options.categories} />
                  )}
                </Region>
                <Region title="How to apply" part="form" onEdit={edit}>
                  {data.form === null || data.form.fields.length === 0 ? (
                    <p className="text-sm text-fg-muted">The standard form: name, email, CV.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {data.form.fields
                        .filter((f) => f.shown)
                        .map((f) => (
                          <li key={f.key}>
                            <Badge size="sm" variant={f.required ? 'solid' : 'outline'}>
                              {f.label}
                            </Badge>
                          </li>
                        ))}
                    </ul>
                  )}
                </Region>
              </div>
              <aside className="flex min-w-0 flex-col gap-4">
                <Region title="Hiring team" part="team" onEdit={edit}>
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
                <Region title="What we look for" part="criteria" onEdit={edit}>
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
                <Region title="The process" part="plan" onEdit={edit}>
                  {data.plan.length === 0 ? (
                    <p className="text-sm text-fg-muted">No interviews planned yet.</p>
                  ) : (
                    <ol className="flex flex-col gap-1 text-sm">
                      {data.plan.map((p, i) => (
                        <li key={p.key} className="flex items-center gap-2">
                          <span className="text-xs text-fg-muted tabular-nums">
                            {String(i + 1)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{p.title}</span>
                          <span className="text-xs text-fg-muted">{`${String(p.minutes)} min`}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Region>
                <Region title="Where it is published" part="publishing" onEdit={edit}>
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
              </aside>
            </div>

            {/* A part, edited in a sheet off the ad. */}
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

            {/* A new job, set up on a page of its own over the ad, a small step at a time. */}
            <JobWizard
              open={wizard}
              data={data}
              props={props}
              stepKey={props.search?.['step'] ?? null}
              entered={props.search?.['entered'] === '1'}
              onStep={(key) =>
                props.onFilter?.({ setup: '1', step: key === 'title' ? null : key, entered: null })
              }
              onClose={() => props.onFilter?.({ setup: null, step: null, entered: null })}
              onFinish={() => props.onFilter?.({ setup: null, step: null, entered: null })}
              part={(p) => <PartBody part={p} data={data} props={props} />}
            />
          </div>
        );
      }}
    </Loaded>
  );
}
