import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyField,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, newId, range, useAct, words } from './shared';
import type { FormField, JobData, ScreenProps } from './types';

/**
 * R4–R7 and R14, a job's setup (design R4–R7): details, the hiring team,
 * criteria, the interview plan, the ad with its checks, the apply form and
 * where it is published. Each tab is in the address; each saves on its own.
 */

const TABS = ['details', 'team', 'criteria', 'plan', 'ad', 'form', 'publishing'] as const;
type Tab = (typeof TABS)[number];
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
    what: 'Needs Indeed’s partner agreement; Glassdoor lists jobs from Indeed',
    available: false,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    what: 'Partner-only; use the tracked share link',
    available: false,
  },
];

function NewJob(props: ScreenProps<JobData>): JSX.Element {
  const act = useAct(props);
  const [title, setTitle] = useState('');
  const [workMode, setWorkMode] = useState<'onsite' | 'hybrid' | 'remote'>('hybrid');
  const [openings, setOpenings] = useState<number | null>(1);
  const requisition = props.search?.['requisition'] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New job"
        description={
          requisition === null ? 'Open a job directly.' : 'From the approved requisition.'
        }
      />
      <Refusal error={act.error} />
      <Card padded>
        <div className="grid gap-4 md:grid-cols-3">
          <Field required className="md:col-span-3">
            <FieldLabel>Advertised title</FieldLabel>
            <FieldControl>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Senior Backend Engineer (m/w/d)"
              />
            </FieldControl>
            <FieldDescription>
              Germany: the title carries a gender-neutral marker such as (m/w/d).
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Work mode</FieldLabel>
            <SegmentedControl
              value={workMode}
              onValueChange={(v) => setWorkMode(v as typeof workMode)}
            >
              <SegmentedControlItem value="onsite">On site</SegmentedControlItem>
              <SegmentedControlItem value="hybrid">Hybrid</SegmentedControlItem>
              <SegmentedControlItem value="remote">Remote</SegmentedControlItem>
            </SegmentedControl>
          </Field>
          <NumberField label="Openings" value={openings} min={1} onChange={setOpenings} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            disabled={title.trim() === ''}
            loading={act.pending}
            onClick={() => {
              const id = newId();
              act.run(
                'CreateJob',
                {
                  input: {
                    id,
                    title,
                    internalTitle: title,
                    requisitionIds: requisition === null ? [] : [requisition],
                    entityId: null,
                    locationIds: [],
                    department: null,
                    workMode,
                    openings: openings ?? 1,
                    languages: ['en'],
                    hiringManagerId: null,
                  },
                },
                () => props.onNavigate?.(`/recruiting/jobs/${id}/setup`),
              );
            }}
          >
            Create job
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Details({
  data,
  props,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
}): JSX.Element {
  const act = useAct(props);
  const [job, setJob] = useState(data.job);
  const [min, setMin] = useState<number | null>(
    data.job.salary === null ? null : data.job.salary.minMinor / 100,
  );
  const [max, setMax] = useState<number | null>(
    data.job.salary === null ? null : data.job.salary.maxMinor / 100,
  );
  const entity = data.entities.find((e) => e.id === job.entityId);
  const save = (): void => {
    const currency = entity?.currency ?? job.salary?.currency ?? 'EUR';
    act.run('SaveJobDetails', {
      jobId: job.id,
      input: {
        title: job.title,
        internalTitle: job.internalTitle,
        department: job.department,
        locationIds: job.locationIds,
        workMode: job.workMode,
        salaryShown: job.salaryShown,
        languages: job.languages,
        internalOnly: job.internalOnly,
        confidential: job.confidential,
        openings: job.openings,
        targetHireDate: job.targetHireDate,
        outline: job.outline,
        salary:
          min === null || max === null
            ? null
            : {
                minMinor: Math.round(min * 100),
                maxMinor: Math.round(max * 100),
                currency,
                period: 'year',
              },
        searchable: job.searchable,
        benefitIds: job.benefitIds,
        scorecardTemplateId: job.scorecardTemplateId,
        entityId: job.entityId,
      },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <Refusal error={act.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle level={2}>The job</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Internal title</FieldLabel>
              <FieldControl>
                <Input
                  value={job.internalTitle}
                  onChange={(e) => setJob({ ...job, internalTitle: e.target.value })}
                />
              </FieldControl>
            </Field>
            <Field required>
              <FieldLabel>Advertised title</FieldLabel>
              <FieldControl>
                <Input
                  value={job.title}
                  onChange={(e) => setJob({ ...job, title: e.target.value })}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>Department</FieldLabel>
              <FieldControl>
                <Input
                  value={job.department ?? ''}
                  onChange={(e) =>
                    setJob({ ...job, department: e.target.value === '' ? null : e.target.value })
                  }
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>Legal entity</FieldLabel>
              <Select
                value={job.entityId ?? 'none'}
                onValueChange={(v) => setJob({ ...job, entityId: v === 'none' ? null : v })}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value="none">Not chosen</SelectItem>
                  {data.entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{`${e.name} (${e.country})`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Location</FieldLabel>
              <Select
                value={job.locationIds[0] ?? 'none'}
                onValueChange={(v) => setJob({ ...job, locationIds: v === 'none' ? [] : [v] })}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value="none">Not chosen</SelectItem>
                  {data.locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{`${l.name} (${l.country})`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <NumberField
              label="Openings"
              value={job.openings}
              min={1}
              onChange={(n) => setJob({ ...job, openings: n ?? 1 })}
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle level={2}>Pay</CardTitle>
              <CardDescription>
                Shown in the ad where the law asks for it, and checked against every offer.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <NumberField
                label={`From (yearly${entity === undefined ? '' : `, ${entity.currency}`})`}
                value={min}
                min={0}
                onChange={setMin}
              />
              <NumberField label="To (yearly)" value={max} min={0} onChange={setMax} />
              <div className="flex items-center gap-3 md:col-span-2">
                <Switch
                  id="salary-shown"
                  checked={job.salaryShown}
                  onCheckedChange={(on) => setJob({ ...job, salaryShown: on })}
                />
                <label htmlFor="salary-shown">Show the range in the ad</label>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Visibility</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch
                  id="internal-only"
                  checked={job.internalOnly}
                  onCheckedChange={(on) => setJob({ ...job, internalOnly: on })}
                />
                <label htmlFor="internal-only">
                  Internal only: the internal board, nowhere public
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="confidential"
                  checked={job.confidential}
                  onCheckedChange={(on) => setJob({ ...job, confidential: on })}
                />
                <label htmlFor="confidential">
                  Confidential: the company is not named in the ad
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="searchable"
                  checked={job.searchable}
                  onCheckedChange={(on) => setJob({ ...job, searchable: on })}
                />
                <label htmlFor="searchable">On Kithena Jobs’ search, beside the careers page</label>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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
                    onValueChange={(v) =>
                      setTeam(team.map((x, j) => (j === i ? { ...x, role: v } : x)))
                    }
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
                    onClick={() => setTeam(team.filter((_, j) => j !== i))}
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
            onClick={() => act.run('SetJobTeam', { jobId: data.job.id, input: { team } })}
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
                onValueChange={(v) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, weight: Number(v) } : x)))
                }
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
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
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
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={text.trim() === ''}>
              Add
            </Button>
          </form>
          <div className="flex justify-end">
            <Button
              loading={act.pending}
              onClick={() =>
                act.run('SetJobCriteria', { jobId: data.job.id, input: { criteria: rows } })
              }
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
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Interview plan</CardTitle>
        <CardDescription>
          The interviews in order, each with its length, interviewers and scorecard
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        {plan.length === 0 ? (
          <EmptyState icon={<icons.meeting aria-hidden />} title="No interviews planned" />
        ) : null}
        {plan.map((p, i) => (
          <div
            key={p.key}
            className="grid gap-3 border-b border-[var(--reach-line)] pb-3 md:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <span className="font-semibold">{`${String(i + 1)}. ${p.title}`}</span>
            <NumberField
              label="Minutes"
              size="sm"
              value={p.minutes}
              min={5}
              max={480}
              step={15}
              onChange={(n) =>
                setPlan(plan.map((x, j) => (j === i ? { ...x, minutes: n ?? 60 } : x)))
              }
            />
            <Select
              value={p.interviewerIds[0] ?? 'none'}
              onValueChange={(v) =>
                setPlan(
                  plan.map((x, j) =>
                    j === i ? { ...x, interviewerIds: v === 'none' ? [] : [v] } : x,
                  ),
                )
              }
            >
              <SelectTrigger aria-label={`${p.title}’s interviewer`}>
                <SelectValue placeholder="Interviewer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody yet</SelectItem>
                {data.members.map((m) => (
                  <SelectItem key={m.personId} value={m.personId}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={p.scorecardTemplateId ?? 'none'}
              onValueChange={(v) =>
                setPlan(
                  plan.map((x, j) =>
                    j === i ? { ...x, scorecardTemplateId: v === 'none' ? null : v } : x,
                  ),
                )
              }
            >
              <SelectTrigger aria-label={`${p.title}’s scorecard`}>
                <SelectValue placeholder="Scorecard" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">The job’s scorecard</SelectItem>
                {data.scorecards.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${p.title}`}
              startIcon={<icons.delete aria-hidden />}
              onClick={() => setPlan(plan.filter((_, j) => j !== i))}
            />
          </div>
        ))}
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
            aria-label="An interview"
            placeholder="Technical interview"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={title.trim() === ''}>
            Add
          </Button>
        </form>
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            onClick={() => act.run('SetJobPlan', { jobId: data.job.id, input: { plan } })}
          >
            Save plan
          </Button>
        </div>
      </CardContent>
    </Card>
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
  const errors = (ad?.checks ?? []).filter((c) => c.severity === 'error');
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
                onClick={() => setLanguage(l)}
              >
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
          <Field required>
            <FieldLabel>Title</FieldLabel>
            <FieldControl>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </FieldControl>
          </Field>
          <RichTextEditor
            key={language}
            label="Ad text"
            value={ad?.html ?? ''}
            onChangeJson={setDoc}
            minHeight="20rem"
          />
          <div className="flex justify-end">
            <Button
              loading={act.pending}
              disabled={title.trim() === '' || (doc === null && ad === undefined)}
              onClick={() =>
                act.run('SaveJobAd', {
                  jobId: data.job.id,
                  language,
                  input: { title, doc: doc ?? { type: 'doc', content: [] } },
                })
              }
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
                      onCheckedChange={(on) =>
                        setFields(
                          fields.map((x, j) =>
                            j === i ? { ...x, required: on, shown: on ? true : x.shown } : x,
                          ),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${f.label} shown`}
                      disabled={locked(f.key)}
                      checked={f.shown}
                      onCheckedChange={(on) =>
                        setFields(
                          fields.map((x, j) =>
                            j === i ? { ...x, shown: on, required: on ? x.required : false } : x,
                          ),
                        )
                      }
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
          </Field>
          <div className="flex justify-end">
            <Button
              loading={act.pending}
              onClick={() =>
                act.run('SaveJobForm', {
                  jobId: data.job.id,
                  input: {
                    fields,
                    questionnaireId: questionnaire === 'none' ? null : questionnaire,
                  },
                })
              }
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
                        <Badge size="sm">{t.available ? 'Not published' : 'Not available'}</Badge>
                      ) : (
                        <StateBadge state={held.state} />
                      )}
                    </TableCell>
                    <TableCell>
                      {t.available &&
                      (held === undefined ||
                        held.state === 'expired' ||
                        held.state === 'failed') ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={data.job.state !== 'open'}
                          loading={act.pending}
                          onClick={() =>
                            act.run('PublishJob', { jobId: data.job.id, target: t.key })
                          }
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
      {share?.url == null ? null : <CopyField label="Share link" value={share.url} />}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          startIcon={<icons.stop aria-hidden />}
          loading={act.pending}
          onClick={() => act.run('UnpublishJob', { jobId: data.job.id })}
        >
          Unpublish everywhere
        </Button>
      </div>
    </div>
  );
}

export function JobSetup(props: ScreenProps<JobData>): JSX.Element {
  const act = useAct(props);
  if (props.params?.['id'] === 'new') return <NewJob {...props} />;
  const tab: Tab = TABS.find((t) => t === props.search?.['tab']) ?? 'details';
  return (
    <Loaded load={props.load} what="the job">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={data.job.title}
            meta={<StateBadge state={data.job.state} />}
            description={[
              data.job.department,
              data.job.salary === null
                ? null
                : range(
                    data.job.salary.minMinor,
                    data.job.salary.maxMinor,
                    data.job.salary.currency,
                  ),
            ]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() => props.onNavigate?.(`/recruiting/jobs/${data.job.id}`)}
                >
                  Pipeline
                </Button>
                {data.job.state === 'draft' ||
                data.job.state === 'on_hold' ||
                data.job.state === 'closed' ? (
                  <Button
                    loading={act.pending}
                    onClick={() =>
                      act.run('MoveJob', { jobId: data.job.id, input: { to: 'open' } })
                    }
                  >
                    Open job
                  </Button>
                ) : data.job.state === 'open' ? (
                  <Button
                    variant="secondary"
                    loading={act.pending}
                    onClick={() =>
                      act.run('MoveJob', { jobId: data.job.id, input: { to: 'on_hold' } })
                    }
                  >
                    Put on hold
                  </Button>
                ) : null}
              </>
            }
          />
          <Refusal error={act.error} />
          <Tabs
            value={tab}
            onValueChange={(v) => props.onFilter?.({ tab: v === 'details' ? null : v })}
          >
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {t === 'plan' ? 'Interview plan' : t === 'form' ? 'Apply form' : words(t)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="details">
              <Details data={data} props={props} />
            </TabsContent>
            <TabsContent value="team">
              <Team data={data} props={props} />
            </TabsContent>
            <TabsContent value="criteria">
              <Criteria data={data} props={props} />
            </TabsContent>
            <TabsContent value="plan">
              <Plan data={data} props={props} />
            </TabsContent>
            <TabsContent value="ad">
              <Ad data={data} props={props} />
            </TabsContent>
            <TabsContent value="form">
              <Form data={data} props={props} />
            </TabsContent>
            <TabsContent value="publishing">
              <Publishing data={data} props={props} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Loaded>
  );
}
