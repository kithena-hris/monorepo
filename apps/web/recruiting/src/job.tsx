import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  cn,
  Combobox,
  CopyField,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  formatList,
  IconList,
  IconListItem,
  icons,
  Input,
  KeyValues,
  NumberField,
  PageHeader,
  RadioCard,
  RadioGroup,
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
  TimePicker,
} from '@reach/ui';
import { use, useRef, useState, type JSX, type ReactNode } from 'react';

import { Loaded } from './load';
import { MoreMenu, Refusal, StateBadge, day, newId, range, useAct, when, words } from './shared';
import { BenefitList } from './benefits';
import { SaveQueue, hoursOf, useAnswered, useCommit, type Commit } from './job-terms';
import { JobWizard, NewJobWizard, isSetupPart } from './job-wizard';
import type { FormField, JobData, PlannedInterview, ScreenProps, Stage } from './types';
import { t as tr } from './i18n';

/**
 * R4–R7 and R14, a job's setup (design R4–R7): details, the hiring team,
 * criteria, the interview plan, the ad with its checks, the apply form and
 * where it is published. Each tab is in the address; each saves on its own.
 */

const TARGETS: readonly {
  readonly key: string;
  readonly label: string;
  readonly what: string;
  readonly available: boolean;
}[] = [
  {
    key: 'careers_page',
    get label(): string {
      return tr('job.careers_page', 'Careers page');
    },
    get what(): string {
      return tr(
        'job.the_companys_page_on_kithena_jobs',
        'The company’s page on Kithena Jobs, and its embed',
      );
    },
    available: true,
  },
  {
    key: 'kithena_jobs',
    get label(): string {
      return tr('job.kithena_jobs_search', 'Kithena Jobs search');
    },
    get what(): string {
      return tr(
        'job.the_cross_company_search_if_the',
        'The cross-company search, if the company opted in',
      );
    },
    available: true,
  },
  {
    key: 'google_for_jobs',
    get label(): string {
      return tr('job.google_for_jobs', 'Google for Jobs');
    },
    get what(): string {
      return tr(
        'job.structured_data_on_the_job_page_google',
        'Structured data on the job page; Google crawls it',
      );
    },
    available: true,
  },
  {
    key: 'xml_feed',
    get label(): string {
      return tr('job.open_xml_feed', 'Open XML feed');
    },
    get what(): string {
      return tr('job.for_aggregators_that_read_feeds', 'For aggregators that read feeds');
    },
    available: true,
  },
  {
    key: 'internal_board',
    get label(): string {
      return tr('job.internal_job_board', 'Internal job board');
    },
    get what(): string {
      return tr('job.members_only_with_refer_and_apply', 'Members only, with refer and apply');
    },
    available: true,
  },
  {
    key: 'share_link',
    get label(): string {
      return tr('job.share_links', 'Share links');
    },
    get what(): string {
      return tr('job.a_tracked_link_per_channel', 'A tracked link per channel');
    },
    available: true,
  },
  {
    key: 'indeed',
    get label(): string {
      return tr('job.indeed', 'Indeed');
    },
    get what(): string {
      return tr(
        'job.glassdoor_lists_jobs_from_indeed_needs_the',
        'Glassdoor lists jobs from Indeed; needs the careers page first',
      );
    },
    available: false,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    get what(): string {
      return tr(
        'job.partner_only_use_the_tracked_share_link',
        'Partner-only; use the tracked share link',
      );
    },
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
          <CardTitle level={2}>{tr('job.the_job', 'The job')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field required className="md:col-span-2">
            <FieldLabel>{tr('job.advertised_title', 'Advertised title')}</FieldLabel>
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
            <FieldLabel>{tr('job.internal_title', 'Internal title')}</FieldLabel>
            <FieldDescription>
              {tr(
                'job.for_the_team_only_when_it',
                'For the team only, when it differs from the ad.',
              )}
            </FieldDescription>
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
            <FieldLabel>{tr('job.team', 'Team')}</FieldLabel>
            <FieldControl>
              <Combobox
                label={tr('job.team', 'Team')}
                clearable
                placeholder={tr('job.choose_a_team', 'Choose a team')}
                options={data.orgUnits.map((u) => ({ value: u.name, label: u.name }))}
                value={job.department}
                onChange={(v) => {
                  setJob({ ...job, department: typeof v === 'string' ? v : null });
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{tr('job.level', 'Level')}</FieldLabel>
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
                <SelectItem value="none">{tr('job.not_set', 'Not set')}</SelectItem>
                {['entry', 'mid', 'senior', 'lead', 'executive'].map((l) => (
                  <SelectItem key={l} value={l}>
                    {words(l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <NumberField
            label={tr('job.openings', 'Openings')}
            value={job.openings}
            min={1}
            onChange={(n) => {
              setJob({ ...job, openings: n ?? 1 });
            }}
          />
          <Field>
            <FieldLabel>{tr('job.target_start', 'Target start')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('job.target_start', 'Target start')}
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
          <CardTitle level={2}>{tr('job.visibility', 'Visibility')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field orientation="horizontal">
            <span className="flex min-w-0 flex-col">
              <FieldLabel>{tr('job.internal_only', 'Internal only')}</FieldLabel>
              <FieldDescription>
                {tr(
                  'job.on_the_internal_board_nowhere_public',
                  'On the internal board, nowhere public.',
                )}
              </FieldDescription>
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
              <FieldLabel>{tr('job.confidential', 'Confidential')}</FieldLabel>
              <FieldDescription>
                {tr('job.the_company_is_not_named_in', 'The company is not named in the ad.')}
              </FieldDescription>
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
          {tr('job.save_details', 'Save details')}
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

/** The four roles on a job, each with what it does: every one shown, whoever holds it listed. */
const ROLE_ROWS = () =>
  [
    [
      'recruiter',
      tr('job.recruiters', 'Recruiters'),
      tr('job.run_the_hiring_the_ad_the', 'Run the hiring: the ad, the screening, the bookings.'),
    ],
    [
      'hiring_manager',
      tr('job.hiring_manager', 'Hiring manager'),
      tr(
        'job.decides_who_is_hired_needed_before',
        'Decides who is hired. Needed before the setup moves on.',
      ),
    ],
    [
      'interviewer',
      tr('job.interviewers', 'Interviewers'),
      tr('job.meet_candidates_and_fill_in_their', 'Meet candidates and fill in their scorecards.'),
    ],
    [
      'coordinator',
      tr('job.coordinators', 'Coordinators'),
      tr('job.book_interviews_and_keep_the_calendar', 'Book interviews and keep the calendar.'),
    ],
  ] as const;

const sameTeam = (
  a: readonly { personId: string; role: string }[],
  b: readonly { personId: string; role: string }[],
): boolean => {
  const key = (t: readonly { personId: string; role: string }[]): string =>
    t
      .map((x) => `${x.role}:${x.personId}`)
      .toSorted()
      .join();
  return key(a) === key(b);
};

/**
 * The hiring team, by role: the recruiters, the hiring manager, the
 * interviewers and the coordinators, each a row with whoever holds it. A
 * person holds one role on a job, so someone chosen for one is not offered
 * for another.
 */
function Team({
  data,
  props,
  commit,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}): JSX.Element {
  const served = data.team.map((t) => ({ personId: t.personId, role: t.role }));
  const [team, setTeam] = useState(served);
  const changed = !sameTeam(team, served);
  const { act, error, keep } = useKeep(props, commit, changed, 'SetJobTeam', () => ({
    jobId: data.job.id,
    input: { team },
  }));
  useAnswered(team.some((t) => t.role === 'hiring_manager'));
  const body = (
    <div className="flex flex-col gap-6">
      <Refusal error={error} />
      {ROLE_ROWS().map(([role, label, line]) => (
        <Field key={role} required={role === 'hiring_manager'}>
          <FieldLabel>{label}</FieldLabel>
          <FieldDescription>{line}</FieldDescription>
          <FieldControl>
            <Combobox
              label={label}
              multiple
              chips
              placeholder={tr('job.choose', 'Choose {{label}}', { label: label.toLowerCase() })}
              searchPlaceholder={tr('job.search_people', 'Search people')}
              emptyMessage={tr(
                'job.nobody_by_that_name_works_here',
                'Nobody by that name works here.',
              )}
              options={data.members
                .filter((m) => !team.some((t) => t.personId === m.personId && t.role !== role))
                .map((m) => ({ value: m.personId, label: m.name }))}
              value={team.filter((t) => t.role === role).map((t) => t.personId)}
              onChange={(v) => {
                const ids = typeof v === 'string' || v === null ? [] : [...v];
                setTeam([
                  ...team.filter((t) => t.role !== role),
                  ...ids.map((personId) => ({ personId, role })),
                ]);
              }}
            />
          </FieldControl>
        </Field>
      ))}
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={!changed}
            onClick={() => {
              void keep();
            }}
          >
            {tr('job.save_team', 'Save team')}
          </Button>
        </div>
      ) : null}
    </div>
  );
  return commit === undefined ? (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('job.hiring_team', 'Hiring team')}</CardTitle>
        <CardDescription>
          {tr(
            'job.what_each_person_may_see_follows',
            'What each person may see follows their role on this job.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  ) : (
    body
  );
}

/** One line typed and kept with Enter: the new criterion lands in its list at once. */
function CriterionInput({
  must,
  onAdd,
}: {
  readonly must: boolean;
  readonly onAdd: (text: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const add = (): void => {
    if (text.trim() === '') return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Input
        aria-label={
          must ? tr('job.a_must_have', 'A must-have') : tr('job.a_nice_to_have', 'A nice-to-have')
        }
        placeholder={
          must
            ? tr('job.five_years_building_backend_services', 'Five years building backend services')
            : tr('job.has_run_a_team_of_three', 'Has run a team of three or more')
        }
        value={text}
        containerClassName="min-w-0 flex-1"
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <Button
        type="submit"
        variant="secondary"
        startIcon={<icons.add aria-hidden />}
        disabled={text.trim() === ''}
      >
        {tr('job.add', 'Add')}
      </Button>
    </form>
  );
}

/**
 * What a candidate brings, in two lists side by side: what they must have
 * and what is a bonus. Type a line and press Enter: it lands in its list. A
 * line moves to the other list with one press. The match on each candidate
 * is read against them.
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
  const changed = JSON.stringify(rows) !== JSON.stringify(data.criteria);
  const { act, error, keep } = useKeep(props, commit, changed, 'SetJobCriteria', () => ({
    jobId: data.job.id,
    input: { criteria: rows },
  }));
  useAnswered(rows.some((r) => r.must));
  const column = (must: boolean): JSX.Element => {
    const list = rows.filter((r) => r.must === must);
    const name = must ? tr('job.must_have', 'Must have') : tr('job.nice_to_have', 'Nice to have');
    return (
      <section aria-label={name} className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{name}</h4>
          <Badge
            size="sm"
            variant="soft"
            tone={must ? 'accent' : 'neutral'}
            className="tabular-nums"
          >
            {String(list.length)}
          </Badge>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {must
              ? tr(
                  'job.at_least_one_so_the_match',
                  'At least one, so the match has something to read.',
                )
              : tr('job.optional', 'Optional.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((c) => (
              <li key={c.id}>
                <Card variant="fill" className="flex items-start gap-2 py-2 ps-3 pe-1.5">
                  <span className="min-w-0 flex-1 py-1 text-sm text-pretty">{c.text}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={
                      must
                        ? tr('job.move_to_nice_to_have', 'Move “{{text}}” to nice to have', {
                            text: c.text,
                          })
                        : tr('job.move_to_must_have', 'Move “{{text}}” to must have', {
                            text: c.text,
                          })
                    }
                    startIcon={must ? <icons.down aria-hidden /> : <icons.up aria-hidden />}
                    onClick={() => {
                      setRows(rows.map((x) => (x.id === c.id ? { ...x, must: !must } : x)));
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={tr('job.remove', 'Remove “{{text}}”', { text: c.text })}
                    startIcon={<icons.close aria-hidden />}
                    onClick={() => {
                      setRows(rows.filter((x) => x.id !== c.id));
                    }}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
        <CriterionInput
          must={must}
          onAdd={(text) => {
            setRows([...rows, { id: newId(), text, must, weight: 1 }]);
          }}
        />
      </section>
    );
  };
  const body = (
    <div className="flex flex-col gap-4">
      <Refusal error={error} />
      <div className="grid gap-8 md:grid-cols-2">
        {column(true)}
        {column(false)}
      </div>
      <p className="text-sm text-fg-muted">
        {tr(
          'job.one_sentence_a_cv_can_show',
          'One sentence a CV can show. With the match switched on, each candidate is read against every line.',
        )}
      </p>
      {commit === undefined ? (
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            disabled={!changed}
            onClick={() => {
              void keep();
            }}
          >
            {tr('job.save_criteria', 'Save criteria')}
          </Button>
        </div>
      ) : null}
    </div>
  );
  return commit === undefined ? (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('job.criteria', 'Criteria')}</CardTitle>
        <CardDescription>
          {tr(
            'job.what_a_candidate_must_bring_and',
            'What a candidate must bring, and what is a bonus.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  ) : (
    body
  );
}

const LENGTHS = [15, 30, 45, 60, 90, 120] as const;

/** The steps where a candidate is met: the only ones that take an interview. */
const MEETS: ReadonlySet<string> = new Set(['screening', 'interview', 'assessment']);

const lengthOf = (m: number): string =>
  m < 60 || m % 60 !== 0
    ? tr('job.min', '{{m}} min', { m: String(m) })
    : tr('job.h', '{{value}} h', { value: String(m / 60) });

/** The same steps, by name and kind, as a pipeline: how a job's copy is matched to its template. */
const sameSteps = (a: readonly Stage[], b: readonly Stage[]): boolean => {
  const key = (s: readonly Stage[]): string =>
    s
      .filter((x) => x.category !== 'works_council')
      .map((x) => `${x.category}:${x.name}`)
      .join('|');
  return key(a) === key(b);
};

const twoDigits = (n: number): string => String(n).padStart(2, '0');

/** A set time, as the date and the time the pickers show, in the reader's zone. */
const pickersOf = (
  iso: string | null | undefined,
): { date: string | null; time: string | null } => {
  if (iso == null) return { date: null, time: null };
  const at = new Date(iso);
  return {
    date: `${String(at.getFullYear())}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`,
    time: `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`,
  };
};

/**
 * One step's interview: what it is called, how long, who of the hiring team
 * runs it, how the time is set, where, and what it is about. Under it, in
 * plain words, what happens when a candidate reaches the step.
 */
function InterviewCard({
  step,
  interview,
  team,
  onChange,
  onRemove,
}: {
  readonly step: Stage;
  readonly interview: PlannedInterview;
  readonly team: JobData['team'];
  readonly onChange: (patch: Partial<PlannedInterview>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const mode = interview.mode ?? 'slots';
  const where = interview.place != null ? 'place' : interview.videoUrl != null ? 'link' : 'video';
  const [when, setWhen] = useState(() => pickersOf(interview.fixedAt));
  const fix = (next: { date: string | null; time: string | null }): void => {
    setWhen(next);
    onChange({
      fixedAt:
        next.date === null || next.time === null
          ? null
          : new Date(`${next.date}T${next.time}`).toISOString(),
    });
  };
  const panel = team.filter((t) => interview.interviewerIds.includes(t.personId));
  return (
    <Card variant="outline" padded className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <Field className="min-w-0 flex-1">
          <FieldLabel>{tr('job.interview', 'Interview')}</FieldLabel>
          <FieldControl>
            <Input
              value={interview.title}
              placeholder={step.name}
              onChange={(e) => {
                onChange({ title: e.target.value });
              }}
            />
          </FieldControl>
        </Field>
        <Button
          variant="ghost"
          size="sm"
          className="mt-6"
          aria-label={tr('job.remove_the_interview_from', 'Remove the interview from {{name}}', {
            name: step.name,
          })}
          startIcon={<icons.delete aria-hidden />}
          onClick={onRemove}
        />
      </div>
      <Field>
        <FieldLabel>{tr('job.length', 'Length')}</FieldLabel>
        <ChipRow aria-label={tr('job.length_2', '{{title}} length', { title: interview.title })}>
          {[...new Set([...LENGTHS, interview.minutes])]
            .toSorted((x, y) => x - y)
            .map((m) => (
              <Chip
                key={m}
                selected={interview.minutes === m}
                onClick={() => {
                  onChange({ minutes: m });
                }}
              >
                {lengthOf(m)}
              </Chip>
            ))}
        </ChipRow>
      </Field>
      <Field required>
        <FieldLabel>{tr('job.who_meets_them', 'Who meets them')}</FieldLabel>
        <FieldDescription>
          {tr(
            'job.from_the_hiring_team_each_gets',
            'From the hiring team; each gets the calendar invitation.',
          )}
        </FieldDescription>
        {team.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {tr('job.add_the_hiring_team_on_the', 'Add the hiring team on the page before first.')}
          </p>
        ) : (
          <ChipRow
            aria-label={tr('job.who_runs', 'Who runs {{title}}', { title: interview.title })}
          >
            {team.map((t) => {
              const on = interview.interviewerIds.includes(t.personId);
              return (
                <Chip
                  key={t.personId}
                  selected={on}
                  onClick={() => {
                    onChange({
                      interviewerIds: on
                        ? interview.interviewerIds.filter((x) => x !== t.personId)
                        : [...interview.interviewerIds, t.personId],
                    });
                  }}
                >
                  {tr('job.text', '{{value}} · {{role}}', {
                    value: t.name ?? t.personId,
                    role: words(t.role).toLowerCase(),
                  })}
                </Chip>
              );
            })}
          </ChipRow>
        )}
      </Field>
      <Field>
        <FieldLabel>{tr('job.how_the_time_is_set', 'How the time is set')}</FieldLabel>
        <RadioGroup
          aria-label={tr('job.how_the_time_is_set', 'How the time is set')}
          className="grid gap-2 md:grid-cols-2"
          value={mode}
          onValueChange={(v) => {
            onChange({ mode: v as 'slots' | 'fixed' });
          }}
        >
          <RadioCard
            value="slots"
            icon={<icons.calendar aria-hidden />}
            description={tr(
              'job.picks_from_times_that_fit_everyones',
              'Picks from times that fit everyone’s calendars; you confirm one.',
            )}
          >
            {tr('job.the_candidate_chooses', 'The candidate chooses')}
          </RadioCard>
          <RadioCard
            value="fixed"
            icon={<icons.scheduled aria-hidden />}
            description={tr(
              'job.everyone_who_reaches_this_step_is',
              'Everyone who reaches this step is invited to the same time.',
            )}
          >
            {tr('job.one_set_time', 'One set time')}
          </RadioCard>
        </RadioGroup>
      </Field>
      {mode === 'fixed' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field required>
            <FieldLabel>{tr('job.date', 'Date')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('job.date', 'Date')}
                value={when.date}
                onChange={(d) => {
                  fix({ ...when, date: d });
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('job.time', 'Time')}</FieldLabel>
            <FieldControl>
              <TimePicker
                label={tr('job.time', 'Time')}
                step={15}
                value={when.time}
                onChange={(t) => {
                  fix({ ...when, time: t });
                }}
              />
            </FieldControl>
          </Field>
        </div>
      ) : null}
      <Field>
        <FieldLabel>{tr('job.where', 'Where')}</FieldLabel>
        <SegmentedControl
          aria-label={tr('job.where', 'Where')}
          value={where}
          onValueChange={(v) => {
            onChange(
              v === 'place'
                ? { place: interview.place ?? '', videoUrl: null }
                : v === 'link'
                  ? { place: null, videoUrl: interview.videoUrl ?? '' }
                  : { place: null, videoUrl: null },
            );
          }}
        >
          <SegmentedControlItem value="video">
            {tr('job.video_call', 'Video call')}
          </SegmentedControlItem>
          <SegmentedControlItem value="place">
            {tr('job.in_person', 'In person')}
          </SegmentedControlItem>
          <SegmentedControlItem value="link">
            {tr('job.our_own_link', 'Our own link')}
          </SegmentedControlItem>
        </SegmentedControl>
        {where === 'video' ? (
          <FieldDescription>
            {tr(
              'job.a_meeting_link_is_made_on',
              'A meeting link is made on the organiser’s calendar.',
            )}
          </FieldDescription>
        ) : (
          <FieldControl>
            <Input
              aria-label={
                where === 'place'
                  ? tr('job.the_address', 'The address')
                  : tr('job.the_meeting_link', 'The meeting link')
              }
              placeholder={
                where === 'place'
                  ? tr('job.hauptstra_e_1_berlin_reception', 'Hauptstraße 1, Berlin, reception')
                  : 'https://'
              }
              value={(where === 'place' ? interview.place : interview.videoUrl) ?? ''}
              onChange={(e) => {
                onChange(
                  where === 'place' ? { place: e.target.value } : { videoUrl: e.target.value },
                );
              }}
            />
          </FieldControl>
        )}
      </Field>
      <Field>
        <FieldLabel>{tr('job.agenda', 'Agenda')}</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            rows={2}
            placeholder={tr(
              'job.walk_us_through_two_projects_then',
              'Walk us through two projects; then your questions for us.',
            )}
            value={interview.agenda ?? ''}
            onChange={(e) => {
              onChange({ agenda: e.target.value });
            }}
          />
        </FieldControl>
        <FieldDescription>
          {tr(
            'job.in_the_invitation_and_on_everyones',
            'In the invitation and on everyone’s calendar.',
          )}
        </FieldDescription>
      </Field>
      {/* What happens, said once, so nobody has to guess what moving a candidate sets off. */}
      <IconList
        aria-label={tr(
          'job.when_a_candidate_reaches_this_step',
          'When a candidate reaches this step',
        )}
      >
        {mode === 'fixed' ? (
          <>
            <IconListItem icon={<icons.email aria-hidden />} tone="accent">
              {when.date === null || when.time === null
                ? tr(
                    'job.the_candidate_is_invited_for_the_set_time',
                    'The candidate is invited for the set time, with the agenda.',
                  )
                : tr(
                    'job.the_candidate_is_invited_for_with',
                    'The candidate is invited for {{day}}, {{time}}, with the agenda.',
                    { day: day(when.date), time: when.time },
                  )}
            </IconListItem>
            <IconListItem icon={<icons.calendar aria-hidden />} tone="accent">
              {panel.length === 0
                ? tr(
                    'job.whoever_meets_them_gets_the_calendar',
                    'Whoever meets them gets the calendar invitation.',
                  )
                : tr('job.get_the_calendar_invitation', '{{join}} get the calendar invitation.', {
                    join: panel.map((p) => p.name ?? p.personId).join(', '),
                  })}
            </IconListItem>
          </>
        ) : (
          <>
            <IconListItem icon={<icons.email aria-hidden />} tone="accent">
              {tr(
                'job.the_candidate_is_emailed_to_choose',
                'The candidate is emailed to choose times that fit everyone, with the agenda.',
              )}
            </IconListItem>
            <IconListItem icon={<icons.inbox aria-hidden />} tone="accent">
              {tr(
                'job.their_times_reach_the_recruiters_inbox',
                'Their times reach the recruiter’s Inbox and email; the recruiter confirms one.',
              )}
            </IconListItem>
            <IconListItem icon={<icons.calendar aria-hidden />} tone="accent">
              {tr(
                'job.the_team_gets_the_calendar_invitation',
                'The team gets the calendar invitation; the candidate a confirmation.',
              )}
            </IconListItem>
          </>
        )}
      </IconList>
    </Card>
  );
}

/**
 * How candidates move through the job: its pipeline, chosen from the
 * company's, and each step where a candidate is met with its interview, one
 * at most. An interview step needs one. Reaching a step asks the candidate
 * for its interview by itself: a time to choose, or an invitation.
 */
function Steps({
  data,
  props,
  commit,
}: {
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly commit?: Commit | undefined;
}): JSX.Element {
  const act = useAct(props);
  const track = use(SaveQueue);
  const [plan, setPlan] = useState(data.plan);
  const [error, setError] = useState<string | null>(null);
  // A pipeline just chosen shows at once; Recruiting's copy replaces it when it arrives.
  const [chosen, setChosen] = useState<{ base: readonly Stage[]; stages: readonly Stage[] } | null>(
    null,
  );
  const stages = chosen !== null && chosen.base === data.stages ? chosen.stages : data.stages;
  const stagesSaved = useRef<Promise<unknown>>(Promise.resolve());
  const kept = plan.filter((p) => p.stageId == null || stages.some((s) => s.id === p.stageId));
  const changed = JSON.stringify(kept) !== JSON.stringify(data.plan);
  // Kept as the page moves on, once the steps it names are Recruiting's.
  useCommit(commit, async () => {
    await stagesSaved.current;
    if (!changed) return true;
    setError(null);
    const done = await act.call('SetJobPlan', { jobId: data.job.id, input: { plan: kept } });
    if (!done.ok) {
      setError(done.message);
      return false;
    }
    props.onRefresh?.();
    return true;
  });
  const needing = stages.filter((s) => s.category === 'interview');
  useAnswered(needing.every((s) => kept.some((p) => p.stageId === s.id)));
  const pipelines = data.pipelines ?? [];
  const current = pipelines.find((p) => sameSteps(p.stages, stages))?.id ?? 'own';
  const change = (key: string, patch: Partial<PlannedInterview>): void => {
    setPlan(plan.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };
  const choose = (id: string): void => {
    const template = pipelines.find((p) => p.id === id);
    if (template === undefined) return;
    const copy = template.stages.map((s) => ({ ...s, id: newId() }));
    // A works council's step stays, before the first offer.
    const council = stages.find((s) => s.category === 'works_council');
    const at = copy.findIndex((s) => s.category === 'offer');
    const next =
      council === undefined || copy.some((s) => s.category === 'works_council') || at < 0
        ? copy
        : [...copy.slice(0, at), council, ...copy.slice(at)];
    // An interview follows its step to the step of the same name in the new pipeline.
    setPlan(
      plan.flatMap((p) => {
        const was = stages.find((s) => s.id === p.stageId);
        const to = was === undefined ? undefined : next.find((s) => s.name === was.name);
        return to === undefined ? [] : [{ ...p, stageId: to.id }];
      }),
    );
    setChosen({ base: data.stages, stages: next });
    const saving = act
      .call('SetJobStages', { jobId: data.job.id, input: { stages: next } })
      .then((done) => {
        if (!done.ok) {
          setError(done.message);
          setChosen(null);
          return;
        }
        props.onRefresh?.();
      });
    stagesSaved.current = saving;
    track?.(saving);
  };
  return (
    <div className="flex flex-col gap-6">
      <Refusal error={error ?? act.error} />
      <Field>
        <FieldLabel>{tr('job.pipeline', 'Pipeline')}</FieldLabel>
        <Select value={current} onValueChange={choose}>
          <FieldControl>
            <SelectTrigger className="max-w-md">
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {current === 'own' ? (
              <SelectItem value="own">
                {tr('job.this_jobs_own_steps', 'This job’s own steps')}
              </SelectItem>
            ) : null}
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.isDefault
                  ? tr('job.the_default', '{{name}} (the default)', { name: p.name })
                  : p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {tr(
            'job.the_companys_pipelines_from_settings_choosing',
            'The company’s pipelines, from Settings. Choosing one gives this job its steps.',
          )}
        </FieldDescription>
      </Field>
      <ol className="flex flex-col gap-4" aria-label={tr('job.the_steps', 'The steps')}>
        {stages.map((s, i) => {
          const interview = kept.find((p) => p.stageId === s.id);
          const meets = MEETS.has(s.category);
          return (
            <li key={s.id} className="flex gap-4">
              <Badge
                size="sm"
                variant={interview === undefined ? 'outline' : 'soft'}
                tone={interview === undefined ? 'neutral' : 'accent'}
                className="mt-0.5 shrink-0 tabular-nums"
              >
                {String(i + 1)}
              </Badge>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-sm text-fg-muted">{words(s.category)}</span>
                  {s.category === 'interview' && interview === undefined ? (
                    <Badge size="xs" tone="attention">
                      {tr('job.needs_an_interview', 'Needs an interview')}
                    </Badge>
                  ) : null}
                </div>
                {interview !== undefined ? (
                  <InterviewCard
                    step={s}
                    interview={interview}
                    team={data.team}
                    onChange={(patch) => {
                      change(interview.key, patch);
                    }}
                    onRemove={() => {
                      setPlan(plan.filter((p) => p.key !== interview.key));
                    }}
                  />
                ) : meets ? (
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      startIcon={<icons.add aria-hidden />}
                      onClick={() => {
                        setPlan([
                          ...plan.filter((p) => p.stageId !== s.id),
                          {
                            key: `i_${s.id
                              .toLowerCase()
                              .replace(/[^a-z0-9]/gu, '')
                              .slice(0, 30)}`,
                            title: s.name,
                            minutes: 45,
                            interviewerIds: data.team
                              .filter(
                                (t) => t.role === 'hiring_manager' || t.role === 'interviewer',
                              )
                              .map((t) => t.personId),
                            competencies: [],
                            scorecardTemplateId: null,
                            stageId: s.id,
                            mode: 'slots',
                            fixedAt: null,
                            place: null,
                            videoUrl: null,
                            agenda: null,
                          },
                        ]);
                      }}
                    >
                      {tr('job.add_an_interview', 'Add an interview')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
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
          <CardTitle level={2}>{tr('job.the_ad', 'The ad')}</CardTitle>
          <CardDescription>
            {tr(
              'job.each_language_is_its_own_version',
              'Each language is its own version. Salary and terms come from the job, not the text.',
            )}
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
            <FieldLabel>{tr('job.title', 'Title')}</FieldLabel>
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
            label={tr('job.ad_text', 'Ad text')}
            value={drafted?.html ?? ad?.html ?? ''}
            onChangeJson={setDoc}
            minHeight="20rem"
          />
          <Field>
            <FieldLabel>
              {tr('job.draft_with_the_assistant', 'Draft with the assistant')}
            </FieldLabel>
            <FieldDescription>
              {tr(
                'job.what_the_role_is_about_in',
                'What the role is about, in a few lines. The draft replaces the text above; nothing is saved until you save it.',
              )}
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
              {tr('job.draft', 'Draft')}
            </Button>
            {ad === undefined ? null : (
              <>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger
                    aria-label={tr('job.translate_into', 'Translate into')}
                    className="w-44"
                  >
                    <SelectValue placeholder={tr('job.translate_into', 'Translate into')} />
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
                  {tr('job.translate', 'Translate')}
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
              {tr('job.save_and_check', 'Save and check')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>
            {tr('job.checks_before_publishing', 'Checks before publishing')}
          </CardTitle>
          <CardDescription>
            {errors.length === 0
              ? tr('job.nothing_blocks_publishing', 'Nothing blocks publishing')
              : tr('job.block_publishing', '{{length}} block publishing', {
                  length: String(errors.length),
                })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(ad?.checks ?? []).length === 0 ? (
            <p className="text-sm text-fg-muted">
              {ad === undefined
                ? tr('job.save_the_ad_to_check_it', 'Save the ad to check it.')
                : tr('job.every_check_passed', 'Every check passed.')}
            </p>
          ) : null}
          {(ad?.checks ?? []).map((c, i) => (
            <Alert
              key={`${c.code}:${String(i)}`}
              tone={c.severity === 'error' ? 'danger' : 'warning'}
              title={c.match === null ? words(c.code) : `“${c.match.text}”`}
            >
              {tr('job.text_2', '{{message}} ({{source}})', {
                message: c.message,
                source: c.source,
              })}
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
                  {tr('job.why_and_what_instead', 'Why, and what instead?')}
                </Button>
              ) : (
                <span className="mt-2 block">
                  {tr('job.try', '{{explanation}} Try: “{{suggestion}}”', {
                    explanation: hints[i].explanation,
                    suggestion: hints[i].suggestion,
                  })}
                </span>
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
          <CardTitle level={2}>{tr('job.apply_form', 'Apply form')}</CardTitle>
          <CardDescription>
            {tr(
              'job.the_same_definition_renders_the_form',
              'The same definition renders the form on Kithena Jobs, checks the public API and types the stored answer.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Refusal error={error} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('job.field', 'Field')}</TableHead>
                <TableHead>{tr('job.required', 'Required')}</TableHead>
                <TableHead>{tr('job.shown', 'Shown')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f, i) => (
                <TableRow key={f.key}>
                  <TableCell>{f.label}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={tr('job.required_2', '{{label}} required', { label: f.label })}
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
                      aria-label={tr('job.shown_2', '{{label}} shown', { label: f.label })}
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
            <FieldLabel>{tr('job.questionnaire', 'Questionnaire')}</FieldLabel>
            <Select value={questionnaire} onValueChange={setQuestionnaire}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">{tr('job.none', 'None')}</SelectItem>
                {data.questionnaires.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {tr('job.v', '{{name}} · v{{version}}', {
                      name: q.name,
                      version: String(q.version),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {tr(
                'job.screening_questions_asked_on_the_apply',
                'Screening questions asked on the apply form, written under Settings, Pipelines and approvals.',
              )}
            </FieldDescription>
          </Field>
          <Alert tone="info" title={tr('job.knockout_answers', 'Knockout answers')}>
            {tr(
              'job.a_knockout_answer_flags_the_application',
              'A knockout answer flags the application for the team. Where the questionnaire lets it reject on its own, the application is rejected and the rejection email sent the next working day at 09:00 in the candidate’s time zone, never the moment they apply. Until then the team sees it flagged and can move it on instead.',
            )}
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
                {tr('job.save_form', 'Save form')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('job.never_asked', 'Never asked')}</CardTitle>
          <CardDescription>
            {tr('job.a_kithena_rule_not_a_setting', 'A Kithena rule, not a setting')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {[
            tr('job.date_of_birth', 'Date of birth'),
            tr('job.photo', 'Photo'),
            tr('job.marital_status', 'Marital status'),
            tr('job.religion', 'Religion'),
            tr('job.health', 'Health'),
            tr('job.pregnancy', 'Pregnancy'),
            tr('job.nationality', 'Nationality'),
            tr('job.trade_union', 'Trade union'),
            tr('job.gender', 'Gender'),
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
        <Alert
          tone="info"
          title={tr('job.open_the_job_to_publish_it', 'Open the job to publish it')}
        >
          {tr('job.a_draft_or_a_job_on', 'A draft or a job on hold is on no target.')}
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('job.where_its_published', 'Where it’s published')}</CardTitle>
          <CardDescription>
            {tr(
              'job.each_target_has_its_own_state',
              'Each target has its own state, address and source tag, so every application is attributed.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('job.target', 'Target')}</TableHead>
                <TableHead>{tr('job.state', 'State')}</TableHead>
                <TableHead>
                  <span className="sr-only">{tr('job.action', 'Action')}</span>
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
                        <Badge size="sm">
                          {available
                            ? tr('job.not_published', 'Not published')
                            : tr('job.not_available', 'Not available')}
                        </Badge>
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
                          {tr('job.publish', 'Publish')}
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
          <CardTitle level={2}>
            {tr('job.how_it_looks_on_kithena_jobs', 'How it looks on Kithena Jobs')}
          </CardTitle>
          <CardDescription>
            {tr(
              'job.the_ad_as_a_candidate_will',
              'The ad as a candidate will see it, before and after publishing. The preview is the team’s for a day; search engines never see it and nobody can apply from it.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Dialog open={previewing} onOpenChange={setPreviewing}>
            <div className="flex flex-wrap gap-2">
              <DialogTrigger asChild>
                <Button variant="secondary" startIcon={<icons.visible aria-hidden />}>
                  {tr('job.preview_the_ad', 'Preview the ad')}
                </Button>
              </DialogTrigger>
              <Button asChild variant="ghost" startIcon={<icons.externalLink aria-hidden />}>
                <a href={data.preview} target="_blank" rel="noreferrer">
                  {tr('job.open_in_a_new_tab', 'Open in a new tab')}
                </a>
              </Button>
            </div>
            <DialogContent className="h-[90vh] w-[min(96vw,80rem)] max-w-none p-0">
              <DialogHeader className="px-6 pt-5">
                <DialogTitle>
                  {tr('job.preview_on_kithena_jobs', 'Preview on Kithena Jobs')}
                </DialogTitle>
                <DialogDescription>
                  {tr('job.as_a_candidate_sees_it', '{{title}} · as a candidate sees it', {
                    title: data.job.title,
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="min-h-0 flex-1 p-0">
                <iframe
                  title={tr('job.preview_on_kithena_jobs', 'Preview on Kithena Jobs')}
                  src={data.preview}
                  className="size-full rounded-b-[inherit] border-0 bg-canvas"
                />
              </DialogBody>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
      {share?.url == null ? null : (
        <CopyField label={tr('job.share_link', 'Share link')} value={share.url} />
      )}
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
          {tr('job.unpublish_everywhere', 'Unpublish everywhere')}
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
        <CardTitle level={2}>
          {tr('job.new_applicants_in_slack', 'New applicants in Slack')}
        </CardTitle>
        <CardDescription>
          {tr(
            'job.each_morning_yesterdays_new_applicants_are',
            'Each morning, yesterday’s new applicants are posted to this channel. Invite Kithena to the channel first.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel>{tr('job.channel_id', 'Channel ID')}</FieldLabel>
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
            {tr(
              'job.in_slack_open_the_channels_details',
              'In Slack, open the channel’s details; the ID is at the bottom.',
            )}
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
            {tr('job.save', 'Save')}
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
              {tr('job.stop_posting', 'Stop posting')}
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
  get details(): string {
    return tr('job.internal_details', 'Internal details');
  },
  get team(): string {
    return tr('job.hiring_team', 'Hiring team');
  },
  get criteria(): string {
    return tr('job.criteria', 'Criteria');
  },
  get plan(): string {
    return tr('job.interview_plan', 'Interview plan');
  },
  get ad(): string {
    return tr('job.languages_and_checks', 'Languages and checks');
  },
  get form(): string {
    return tr('job.apply_form', 'Apply form');
  },
  get publishing(): string {
    return tr('job.publishing', 'Publishing');
  },
};

const WEEKDAY: Readonly<Record<number, string>> = {
  get 1(): string {
    return tr('job.mon', 'Mon');
  },
  get 2(): string {
    return tr('job.tue', 'Tue');
  },
  get 3(): string {
    return tr('job.wed', 'Wed');
  },
  get 4(): string {
    return tr('job.thu', 'Thu');
  },
  get 5(): string {
    return tr('job.fri', 'Fri');
  },
  get 6(): string {
    return tr('job.sat', 'Sat');
  },
  get 7(): string {
    return tr('job.sun', 'Sun');
  },
};

const MODE: Readonly<Record<string, string>> = {
  get onsite(): string {
    return tr('job.on_site', 'On site');
  },
  get hybrid(): string {
    return tr('job.hybrid', 'Hybrid');
  },
  get remote(): string {
    return tr('job.remote', 'Remote');
  },
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
      return <Steps data={data} props={props} commit={commit} />;
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
          {tr('job.edit', 'Edit')}
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
        aria-label={tr('job.edit_2', 'Edit {{label}}', { label })}
        className="opacity-0 transition-opacity group-hover/edit:opacity-100 focus-visible:opacity-100 after:absolute after:inset-0 touch:opacity-100"
        onClick={onEdit}
      />
    </Card>
  );
}

/** The panels that are not a page of the setup: the rest of the details, languages and checks, publishing. */
const SHEET_PARTS = ['details', 'ad', 'publishing', 'form'] as const;

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
    <Loaded load={props.load} what={tr('job.the_job_2', 'the job')}>
      {(data) => {
        const ad = data.ads[0];
        const live = data.targets.some((t) => t.target === 'kithena_jobs' && t.state === 'live');
        const places = data.locations.filter((l) => data.job.locationIds.includes(l.id));
        const company = data.company ?? {
          name: tr('job.your_company', 'Your company'),
          logoUrl: null,
        };
        const pay =
          data.job.salary === null
            ? null
            : tr('job.a', '{{range}} a {{period}}', {
                range: range(
                  data.job.salary.minMinor,
                  data.job.salary.maxMinor,
                  data.job.salary.currency,
                ),
                period: data.job.salary.period,
              });
        const modeName = MODE[data.job.workMode] ?? data.job.workMode;
        const onsite = data.terms.hybridDaysOnsite;
        const mode =
          data.terms.workMode === 'hybrid' && onsite !== null
            ? data.terms.hybridOnsiteDays === null
              ? tr(
                  'job.mode_days_on_site_any_days',
                  {
                    one: '{{mode}}, {{count}} day on site, any days',
                    other: '{{mode}}, {{count}} days on site, any days',
                  },
                  { mode: modeName, count: onsite },
                )
              : data.terms.hybridOnsiteDays.length === 0
                ? tr(
                    'job.mode_days_on_site',
                    {
                      one: '{{mode}}, {{count}} day on site',
                      other: '{{mode}}, {{count}} days on site',
                    },
                    { mode: modeName, count: onsite },
                  )
                : tr(
                    'job.mode_days_on_site_which',
                    {
                      one: '{{mode}}, {{count}} day on site ({{days}})',
                      other: '{{mode}}, {{count}} days on site ({{days}})',
                    },
                    {
                      mode: modeName,
                      count: onsite,
                      days: formatList(
                        data.terms.hybridOnsiteDays.map((d) => WEEKDAY[d] ?? ''),
                        'unit',
                        'short',
                      ),
                    },
                  )
            : modeName;
        const hours =
          data.options.weeklyMinutes === null
            ? words(data.job.outline.hours)
            : tr('job.a_week', '{{hoursOf}} a week', {
                hoursOf: hoursOf(data.options.weeklyMinutes),
              });
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
            label: tr('job.the_workplace', 'the workplace'),
            icon: <icons.location aria-hidden />,
            value: where,
            missing: tr('job.add_the_workplace', 'Add the workplace'),
          },
          {
            key: 'mode',
            label: tr('job.the_work_mode', 'the work mode'),
            icon: <icons.home aria-hidden />,
            value: mode,
            missing: tr('job.add_the_work_mode', 'Add the work mode'),
          },
          {
            key: 'contract',
            label: tr('job.the_contract', 'the contract'),
            icon: <icons.agreement aria-hidden />,
            value: data.job.outline.contractType,
            missing: tr('job.add_the_contract', 'Add the contract'),
          },
          {
            key: 'time',
            label: tr('job.the_hours', 'the hours'),
            icon: <icons.pending aria-hidden />,
            value: hours,
            missing: tr('job.add_the_hours', 'Add the hours'),
          },
          {
            key: 'salary',
            label: tr('job.the_pay', 'the pay'),
            icon: <icons.payment aria-hidden />,
            value: pay === null ? null : data.job.salaryShown ? pay : `${pay}, not shown`,
            missing: tr('job.add_the_pay', 'Add the pay'),
          },
          {
            key: 'level',
            label: tr('job.the_team_and_level', 'the team and level'),
            icon: <icons.goal aria-hidden />,
            value:
              [
                data.job.outline.seniority === null ? null : words(data.job.outline.seniority),
                data.job.department,
              ]
                .filter((v) => v !== null)
                .join(' · ') || null,
            missing: tr('job.add_the_team_and_level', 'Add the team and level'),
          },
        ];
        const rail = [
          { label: tr('job.location', 'Location'), value: where ?? tr('job.not_set', 'Not set') },
          { label: tr('job.work_mode', 'Work mode'), value: mode },
          {
            label: tr('job.contract', 'Contract'),
            value: data.job.outline.contractType ?? tr('job.not_set', 'Not set'),
          },
          { label: tr('job.hours', 'Hours'), value: hours },
          {
            label: tr('job.holiday', 'Holiday'),
            value:
              data.terms.vacationDays === null
                ? tr('job.not_set', 'Not set')
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
                  ? tr(
                      'job.live_press_any_part_of_the',
                      'Live. Press any part of the ad to change it.',
                    )
                  : tr(
                      'job.the_ad_as_candidates_will_read',
                      'The ad as candidates will read it. Press any part to change it, then publish.',
                    )
              }
              actions={
                <>
                  {live ? (
                    <Button
                      variant="secondary"
                      startIcon={<icons.externalLink aria-hidden />}
                      onClick={() => {
                        edit('publishing');
                      }}
                    >
                      {tr('job.live_on_kithena_jobs', 'Live on Kithena Jobs')}
                    </Button>
                  ) : ad === undefined ? (
                    <Button
                      startIcon={<icons.assistant aria-hidden />}
                      onClick={() => {
                        edit('description');
                      }}
                    >
                      {tr(
                        'job.write_the_description_to_publish',
                        'Write the description to publish',
                      )}
                    </Button>
                  ) : blocking > 0 ? (
                    <Button
                      startIcon={<icons.warning aria-hidden />}
                      onClick={() => {
                        edit('ad');
                      }}
                    >
                      {tr(
                        'job.fix_to_publish',
                        {
                          one: 'Fix {{count}} check to publish',
                          other: 'Fix {{count}} checks to publish',
                        },
                        { count: blocking },
                      )}
                    </Button>
                  ) : (
                    <Button
                      startIcon={<icons.send aria-hidden />}
                      loading={act.pending}
                      onClick={publish}
                    >
                      {tr('job.publish', 'Publish')}
                    </Button>
                  )}
                  <MoreMenu
                    label={tr('job.more_for_the_job', 'More for {{title}}', {
                      title: data.job.title,
                    })}
                    items={[
                      {
                        id: 'pipeline',
                        label: tr('job.open_the_board', 'Open the board'),
                        icon: <icons.people aria-hidden />,
                        group: 'go',
                        onSelect: () => props.onNavigate?.(`/recruiting/jobs/${data.job.id}`),
                      },
                      {
                        id: 'setup',
                        label: tr('job.guided_setup', 'Guided setup'),
                        icon: <icons.settings aria-hidden />,
                        group: 'go',
                        onSelect: () => props.onFilter?.({ setup: '1', step: null }),
                      },
                      {
                        id: 'hold',
                        label: tr('job.put_on_hold', 'Put on hold'),
                        icon: <icons.pause aria-hidden />,
                        hidden: data.job.state !== 'open',
                        group: 'state',
                        onSelect: () => {
                          act.run('MoveJob', { jobId: data.job.id, input: { to: 'on_hold' } });
                        },
                      },
                    ]}
                  />
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
                  label={tr('job.the_title', 'the title')}
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
                  aria-label={tr('job.at_a_glance', 'At a glance')}
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
                    label={tr('job.the_description', 'the description')}
                    onEdit={() => {
                      edit('description');
                    }}
                  >
                    {ad === undefined ? (
                      <EmptyState
                        icon={<icons.document aria-hidden />}
                        title={tr('job.no_description_yet', 'No description yet')}
                        description={tr(
                          'job.ai_writes_it_from_the_job',
                          'AI writes it from the job, its criteria and the interviews. Press to write it.',
                        )}
                      />
                    ) : (
                      <RichTextContent sanitisedHtml={ad.html} className="job-ad" />
                    )}
                  </Editable>
                  <Editable
                    label={tr('job.the_benefits', 'the benefits')}
                    onEdit={() => {
                      edit('benefits');
                    }}
                  >
                    <section className="flex flex-col gap-5">
                      <h3 className="text-2xl font-bold tracking-[-0.01em]">
                        {tr('job.what_we_offer', 'What we offer')}
                      </h3>
                      {offered.length === 0 ? (
                        <p className="text-fg-muted">
                          {tr(
                            'job.no_benefits_chosen_yet_press_to',
                            'No benefits chosen yet. Press to choose them by category.',
                          )}
                        </p>
                      ) : (
                        <BenefitList benefits={offered} categories={data.options.categories} />
                      )}
                    </section>
                  </Editable>
                  <Editable
                    label={tr('job.the_interviews', 'the interviews')}
                    onEdit={() => {
                      edit('interviews');
                    }}
                  >
                    <section className="flex flex-col gap-4">
                      <h3 className="text-2xl font-bold tracking-[-0.01em]">
                        {tr('job.how_we_hire', 'How we hire')}
                      </h3>
                      {/* The steps a candidate sees, each with its interview and how long it takes. */}
                      <Timeline>
                        {data.stages
                          .filter((st) => st.candidateName !== null)
                          .map((st, i, shown) => {
                            const meet = data.plan.find((p) => p.stageId === st.id);
                            return (
                              <TimelineItem
                                key={st.id}
                                title={st.candidateName ?? st.name}
                                timestamp={
                                  meet === undefined
                                    ? undefined
                                    : tr('job.min_2', '{{title}}, {{minutes}} min', {
                                        title: meet.title,
                                        minutes: String(meet.minutes),
                                      })
                                }
                                tone={meet === undefined ? 'neutral' : 'accent'}
                                icon={<Badge size="sm">{String(i + 1)}</Badge>}
                                last={i === shown.length - 1}
                              />
                            );
                          })}
                      </Timeline>
                    </section>
                  </Editable>
                </div>

                {/* The rail: what it pays and the way in, as a candidate sees them beside the words. */}
                <aside className="flex min-w-0 flex-col lg:sticky lg:top-6 lg:self-start">
                  <Card variant="elevated" className="flex flex-col gap-4 p-5">
                    <Editable
                      label={tr('job.the_pay', 'the pay')}
                      onEdit={() => {
                        edit('salary');
                      }}
                    >
                      {pay === null ? (
                        <p className="text-lg font-semibold text-fg-muted">
                          {tr('job.no_pay_yet', 'No pay yet')}
                        </p>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-sm text-fg-muted">
                            {data.job.salaryShown
                              ? tr('job.pays', 'Pays')
                              : tr(
                                  'job.pays_not_shown_to_candidates',
                                  'Pays, not shown to candidates',
                                )}
                          </span>
                          <span className="text-2xl font-bold tracking-[-0.01em]">{pay}</span>
                        </div>
                      )}
                    </Editable>
                    <Editable
                      label={tr('job.the_apply_form', 'the apply form')}
                      onEdit={() => {
                        edit('form');
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="primary"
                          size="lg"
                          disabled
                          tabIndex={-1}
                          className="w-full"
                        >
                          {tr('job.apply_now', 'Apply now')}
                        </Button>
                        <p className="text-sm text-fg-muted">
                          {asks.length === 0
                            ? tr(
                                'job.asks_for_the_name_email_and',
                                'Asks for the name, email and CV.',
                              )
                            : tr(
                                'job.asks_for_the_name_email_cv',
                                'Asks for the name, email, CV and {{join}}.',
                                { join: asks.map((f) => f.label.toLowerCase()).join(', ') },
                              )}
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
                {tr('job.only_your_team_sees_this', 'Only your team sees this')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Region
                  title={tr('job.hiring_team', 'Hiring team')}
                  onEdit={() => {
                    edit('team');
                  }}
                >
                  {/* Every role, whoever holds it: an empty one says so rather than vanishing. */}
                  <dl className="flex flex-col gap-3 text-sm">
                    {ROLE_ROWS().map(([role, label]) => {
                      const held = data.team.filter((m) => m.role === role);
                      return (
                        <div key={role} className="flex flex-col gap-1">
                          <dt className="text-xs font-medium text-fg-muted">{label}</dt>
                          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {held.length === 0 ? (
                              <span className="text-fg-muted">
                                {tr('job.nobody_yet', 'Nobody yet')}
                              </span>
                            ) : (
                              held.map((m) => (
                                <span key={m.personId} className="flex items-center gap-1.5">
                                  <Avatar name={m.name ?? m.personId} size="xs" aria-hidden />
                                  {m.name ?? m.personId}
                                </span>
                              ))
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </Region>
                <Region
                  title={tr('job.interviews_by_step', 'Interviews, by step')}
                  onEdit={() => {
                    edit('interviews');
                  }}
                >
                  {data.plan.every((p) => p.stageId == null) ? (
                    <p className="text-sm text-fg-muted">
                      {tr('job.no_step_has_its_interview_yet', 'No step has its interview yet.')}
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-3 text-sm">
                      {data.stages.flatMap((st) => {
                        const meet = data.plan.find((p) => p.stageId === st.id);
                        if (meet === undefined) return [];
                        const panel = data.team
                          .filter((m) => meet.interviewerIds.includes(m.personId))
                          .map((m) => m.name ?? m.personId);
                        return [
                          <li key={st.id} className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              {tr('job.text_3', '{{name}}: {{title}}', {
                                name: st.name,
                                title: meet.title,
                              })}
                            </span>
                            <span className="text-fg-muted">
                              {[
                                tr('job.min_3', '{{minutes}} min', {
                                  minutes: String(meet.minutes),
                                }),
                                meet.mode === 'fixed' && meet.fixedAt != null
                                  ? tr('job.at', 'at {{fixedAt}}', { fixedAt: when(meet.fixedAt) })
                                  : tr(
                                      'job.the_candidate_chooses_the_time',
                                      'the candidate chooses the time',
                                    ),
                                panel.length === 0
                                  ? tr('job.nobody_to_meet_them_yet', 'nobody to meet them yet')
                                  : panel.join(', '),
                              ].join(' · ')}
                            </span>
                          </li>,
                        ];
                      })}
                    </ol>
                  )}
                </Region>
                <Region
                  title={tr('job.what_we_look_for', 'What we look for')}
                  onEdit={() => {
                    edit('criteria');
                  }}
                >
                  {data.criteria.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {tr(
                        'job.no_criteria_yet_the_ai_matrix',
                        'No criteria yet; the AI matrix needs them.',
                      )}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {data.criteria.map((c) => (
                        <li key={c.id} className="flex items-start gap-2">
                          <Badge size="xs" tone={c.must ? 'accent' : 'neutral'}>
                            {c.must ? tr('job.must', 'Must') : tr('job.nice', 'Nice')}
                          </Badge>
                          <span>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Region>
                <Region
                  title={tr('job.openings_and_start', 'Openings and start')}
                  onEdit={() => {
                    edit('openings');
                  }}
                >
                  <KeyValues
                    items={[
                      { label: tr('job.openings', 'Openings'), value: String(data.job.openings) },
                      {
                        label: tr('job.target_start', 'Target start'),
                        value: day(data.job.targetHireDate),
                      },
                    ]}
                    layout="aligned"
                    labelWidth="7rem"
                    className="text-sm"
                  />
                </Region>
                <Region
                  title={tr('job.where_it_is_published', 'Where it is published')}
                  onEdit={() => {
                    edit('publishing');
                  }}
                >
                  {data.targets.filter((t) => t.state === 'live').length === 0 ? (
                    <p className="text-sm text-fg-muted">{tr('job.nowhere_yet', 'Nowhere yet.')}</p>
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
                  title={tr('job.languages_and_checks', 'Languages and checks')}
                  onEdit={() => {
                    edit('ad');
                  }}
                >
                  <p className="text-sm text-fg-muted">
                    {ad === undefined
                      ? tr('job.no_ad_yet', 'No ad yet.')
                      : blocking > 0
                        ? tr(
                            'job.publishing_2',
                            {
                              one: '{{count}} check blocks publishing.',
                              other: '{{count}} checks block publishing.',
                            },
                            { count: blocking },
                          )
                        : tr('job.in_every_check_passes', 'In {{join}}. Every check passes.', {
                            join: data.ads.map((a) => a.language.toUpperCase()).join(', '),
                          })}
                  </p>
                </Region>
                <Region
                  title={tr('job.internal_details', 'Internal details')}
                  onEdit={() => {
                    edit('details');
                  }}
                >
                  <KeyValues
                    items={[
                      {
                        label: tr('job.internal_title', 'Internal title'),
                        value:
                          data.job.internalTitle === ''
                            ? tr('job.same_as_the_ad', 'Same as the ad')
                            : data.job.internalTitle,
                      },
                      {
                        label: tr('job.internal_only', 'Internal only'),
                        value: data.job.internalOnly ? 'Yes' : 'No',
                      },
                      {
                        label: tr('job.confidential', 'Confidential'),
                        value: data.job.confidential ? 'Yes' : 'No',
                      },
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
