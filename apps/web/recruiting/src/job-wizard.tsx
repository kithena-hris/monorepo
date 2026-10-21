import {
  Alert,
  Button,
  Combobox,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  NumberField,
  Progress,
  RadioCard,
  RadioGroup,
  RichTextEditor,
  Stepper,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, useTransition, type JSX, type ReactNode } from 'react';

import {
  BenefitsChoice,
  ContractChoice,
  DaysChoice,
  EntityChoice,
  HoursChoice,
  LeaveChoice,
  ModeChoice,
  PayChoice,
  PlaceChoice,
  WorkTypeChoice,
  countryName,
  useCommit,
  type Commit,
  type TermsProps,
} from './job-terms';
import { Refusal, useAct } from './shared';
import type { JobData, JobRecord, ScreenProps } from './types';

/**
 * R4–R7: a new job, set up on a page of its own over the jobs list. One small
 * question at a time, in the order the law needs them answered: the role, then
 * where the work is, then the kind of work and the contracts that country
 * allows for it, hours, leave, pay and benefits, then who hires and how, and
 * last the role's description, drafted by AI from all of it. Every answer is
 * kept as it is given, so closing loses nothing; the bar at the top says how
 * much is done. Finishing shows the ad as candidates will see it, to publish.
 */

/** The parts of the job this setup borrows from the ad's edit panels. */
export type BorrowedPart = 'team' | 'criteria' | 'plan' | 'form';

interface Step {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly title: string;
  readonly hint: (data: JobData) => string;
  /** Answered; null for a step with nothing it must have, done once passed. */
  readonly done: (data: JobData) => boolean | null;
}

const FIRST: Step = {
  key: 'role',
  group: 'The role',
  label: 'Team and level',
  title: 'Which team is it in, and how senior?',
  hint: () => 'The level shapes the description and the pay estimate.',
  done: (d) => d.job.department !== null && d.job.outline.seniority !== null,
};

export const WIZARD_STEPS: readonly Step[] = [
  FIRST,
  {
    key: 'openings',
    group: 'The role',
    label: 'Openings',
    title: 'How many people, and from when?',
    hint: () => 'The start date is a target for the team, not a promise in the ad.',
    done: () => null,
  },
  {
    key: 'entity',
    group: 'Where',
    label: 'Employer',
    title: 'Who employs them?',
    hint: () => 'The entity’s country sets the law for every step after this one.',
    done: (d) => d.terms.entityId !== null,
  },
  {
    key: 'place',
    group: 'Where',
    label: 'Workplace',
    title: 'Where is the work?',
    hint: (d) => `Workplaces of the entity in ${countryName(d.options.country)}.`,
    done: (d) => d.terms.locationId !== null,
  },
  {
    key: 'mode',
    group: 'Where',
    label: 'Work mode',
    title: 'How is the work done?',
    hint: () => 'Shown in the ad, and it changes which contracts and checks apply.',
    done: (d) =>
      d.terms.workMode !== null &&
      (d.terms.workMode !== 'hybrid' || d.terms.hybridDaysOnsite !== null),
  },
  {
    key: 'worktype',
    group: 'Terms',
    label: 'Work type',
    title: 'What kind of work is it?',
    hint: (d) => `As the law in ${countryName(d.options.country)} sees it.`,
    done: (d) => d.terms.relationship !== null,
  },
  {
    key: 'contract',
    group: 'Terms',
    label: 'Contract',
    title: 'Which contract?',
    hint: (d) =>
      `Only the contracts ${countryName(d.options.country)} allows for this kind of work. One that does not fit says why.`,
    done: (d) =>
      d.terms.contractType !== null &&
      (d.options.fixedTermReasons.length === 0 || d.terms.fixedTermReason !== null),
  },
  {
    key: 'days',
    group: 'Terms',
    label: 'Work days',
    title: 'Which days are worked?',
    hint: () => 'The days decide the legal minimum of leave.',
    done: (d) => d.terms.workDays.length > 0,
  },
  {
    key: 'hours',
    group: 'Terms',
    label: 'Hours',
    title: 'What does a working day look like?',
    hint: () => 'In the workplace’s own time. The week is checked against the legal limit.',
    done: (d) => d.terms.dayStart !== null && d.terms.dayEnd !== null,
  },
  {
    key: 'leave',
    group: 'Terms',
    label: 'Time off',
    title: 'How much paid holiday?',
    hint: () => 'Set to the legal minimum to start. More is a reason to apply.',
    done: (d) => d.terms.vacationDays !== null,
  },
  {
    key: 'pay',
    group: 'Pay and benefits',
    label: 'Pay',
    title: 'What does it pay?',
    hint: () =>
      'Filled in with what the market pays for this role there, as AI estimates it. Change anything.',
    done: (d) => d.job.salary !== null,
  },
  {
    key: 'benefits',
    group: 'Pay and benefits',
    label: 'Benefits',
    title: 'Which benefits come with it?',
    hint: () => 'From the entity’s catalogue.',
    done: () => null,
  },
  {
    key: 'team',
    group: 'Hiring',
    label: 'Hiring team',
    title: 'Who is hiring?',
    hint: () => 'A hiring manager at least. They see every candidate and decide with you.',
    done: (d) => d.team.some((t) => t.role === 'hiring_manager'),
  },
  {
    key: 'criteria',
    group: 'Hiring',
    label: 'What you look for',
    title: 'What must they bring?',
    hint: () => 'Must-haves and nice-to-haves. The match on each candidate is read against them.',
    done: (d) => d.criteria.length > 0,
  },
  {
    key: 'interviews',
    group: 'Hiring',
    label: 'Interviews',
    title: 'How will you interview?',
    hint: () => 'Each interview with its length, who runs it, and what they rate.',
    done: (d) => d.plan.length > 0,
  },
  {
    key: 'apply',
    group: 'Hiring',
    label: 'Apply form',
    title: 'What do candidates send?',
    hint: () => 'Name, email and CV are always asked. Add only what you will read.',
    done: () => null,
  },
  {
    key: 'description',
    group: 'The ad',
    label: 'Role description',
    title: 'Describe the role',
    hint: () =>
      'Written by AI from everything so far: the title, the team, the place and the terms. Pay, contract and benefits show beside it from the job.',
    done: (d) => d.ads.length > 0,
  },
];

const SENIORITY = [
  ['entry', 'Entry', 'New to the work'],
  ['mid', 'Mid', 'Works on their own'],
  ['senior', 'Senior', 'Leads the work'],
  ['lead', 'Lead', 'Leads people or a field'],
  ['executive', 'Executive', 'Leads a function'],
] as const;

/** Every detail of the job as it stands, with a change: the details save is whole, never partial. */
const detailsOf = (job: JobRecord, change: Partial<JobRecord>): Record<string, unknown> => {
  const next = { ...job, ...change };
  return {
    title: next.title,
    internalTitle: next.internalTitle,
    department: next.department,
    locationIds: next.locationIds,
    workMode: next.workMode,
    salaryShown: next.salaryShown,
    languages: next.languages,
    internalOnly: next.internalOnly,
    confidential: next.confidential,
    openings: next.openings,
    targetHireDate: next.targetHireDate,
    outline: next.outline,
    salary: next.salary,
    searchable: next.searchable,
    benefitIds: next.benefitIds,
    scorecardTemplateId: next.scorecardTemplateId,
    entityId: next.entityId,
  };
};

function RoleStep({ data, props }: TermsProps): JSX.Element {
  const act = useAct(props);
  const save = (change: Partial<JobRecord>): void => {
    act.run('SaveJobDetails', { jobId: data.job.id, input: detailsOf(data.job, change) });
  };
  return (
    <>
      <Refusal error={act.error} />
      <Field required>
        <FieldLabel>Team</FieldLabel>
        <FieldControl>
          <Combobox
            label="Team"
            placeholder="Choose a team"
            searchPlaceholder="Search teams"
            options={data.orgUnits.map((u) => ({ value: u.name, label: u.name }))}
            value={data.job.department}
            emptyMessage="No team by that name. Add teams under Settings."
            onChange={(v) => {
              save({ department: typeof v === 'string' ? v : null });
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>Level</FieldLabel>
        <RadioGroup
          aria-label="Level"
          className="grid gap-2 sm:grid-cols-2"
          value={data.job.outline.seniority ?? ''}
          onValueChange={(v) => {
            save({ outline: { ...data.job.outline, seniority: v } });
          }}
        >
          {SENIORITY.map(([key, label, description]) => (
            <RadioCard key={key} value={key} description={description}>
              {label}
            </RadioCard>
          ))}
        </RadioGroup>
      </Field>
    </>
  );
}

function OpeningsStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const [openings, setOpenings] = useState<number | null>(data.job.openings);
  const [start, setStart] = useState<string | null>(data.job.targetHireDate);
  const [error, setError] = useState<string | null>(null);
  useCommit(commit, async () => {
    if ((openings ?? 1) === data.job.openings && start === data.job.targetHireDate) return true;
    const done = await act.call('SaveJobDetails', {
      jobId: data.job.id,
      input: detailsOf(data.job, { openings: openings ?? 1, targetHireDate: start }),
    });
    if (!done.ok) {
      setError(done.message);
      return false;
    }
    props.onRefresh?.();
    return true;
  });
  return (
    <>
      <Refusal error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Openings" value={openings} min={1} max={500} onChange={setOpenings} />
        <Field>
          <FieldLabel>Target start</FieldLabel>
          <FieldControl>
            <DatePicker label="Target start" value={start} onChange={setStart} />
          </FieldControl>
          <FieldDescription>Optional.</FieldDescription>
        </Field>
      </div>
    </>
  );
}

interface Draft {
  readonly title: string;
  readonly doc: Record<string, unknown>;
  readonly html: string;
}

/**
 * The role's description: drafted by AI the first time the step opens, from
 * the job as set up so far, and kept when the setup moves on. Redrafting
 * takes a line of what the team wants said.
 */
function DescriptionStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const language = data.ads[0]?.language ?? data.job.languages[0] ?? 'en';
  const ad = data.ads.find((a) => a.language === language);
  const [title, setTitle] = useState(ad?.title ?? data.job.title);
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [drawn, setDrawn] = useState<{ html: string; n: number } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const draft = (): void => {
    startDrafting(async () => {
      setError(null);
      const done = await act.call('DraftAd', {
        jobId: data.job.id,
        input: { language, intake: note },
      });
      if (!done.ok) {
        setError(done.message);
        return;
      }
      const d = done.data as Draft;
      setTitle(d.title);
      setDoc(d.doc);
      setDrawn((was) => ({ html: d.html, n: (was?.n ?? 0) + 1 }));
    });
  };
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || ad !== undefined) return;
    asked.current = true;
    draft();
  });
  useCommit(commit, async () => {
    if (doc === null) return true;
    const done = await act.call('SaveJobAd', {
      jobId: data.job.id,
      language,
      input: { title, doc },
    });
    if (!done.ok) {
      setError(done.message);
      return false;
    }
    props.onRefresh?.();
    return true;
  });
  return (
    <>
      <Refusal error={error} />
      {drafting ? (
        <Alert tone="info" icon={<icons.assistant aria-hidden />} title="Writing the description">
          {`From ${data.job.title}, the team, the place and the terms. It takes a few seconds.`}
        </Alert>
      ) : null}
      <RichTextEditor
        key={String(drawn?.n ?? 0)}
        label="Role description"
        value={drawn?.html ?? ad?.html ?? ''}
        onChangeJson={(next) => {
          setDoc(next);
        }}
        minHeight="22rem"
      />
      <Field>
        <FieldLabel>Anything the AI should say</FieldLabel>
        <FieldDescription>
          A line or two, such as the project they join or the tools you use. Redrafting replaces the
          text above.
        </FieldDescription>
        <FieldControl>
          <Textarea
            autoResize
            value={note}
            placeholder="They join the payments team rebuilding checkout in TypeScript."
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          loading={drafting}
          startIcon={<icons.assistant aria-hidden />}
          onClick={draft}
        >
          {ad === undefined && drawn === null ? 'Draft with AI' : 'Redraft with AI'}
        </Button>
      </div>
    </>
  );
}

function body(key: string, p: TermsProps, part: (part: BorrowedPart) => ReactNode): ReactNode {
  switch (key) {
    case 'role':
      return <RoleStep {...p} />;
    case 'openings':
      return <OpeningsStep {...p} />;
    case 'entity':
      return <EntityChoice {...p} />;
    case 'place':
      return <PlaceChoice {...p} />;
    case 'mode':
      return <ModeChoice {...p} />;
    case 'worktype':
      return <WorkTypeChoice {...p} />;
    case 'contract':
      return <ContractChoice {...p} />;
    case 'days':
      return <DaysChoice {...p} />;
    case 'hours':
      return <HoursChoice {...p} />;
    case 'leave':
      return <LeaveChoice {...p} />;
    case 'pay':
      return <PayChoice {...p} />;
    case 'benefits':
      return <BenefitsChoice {...p} />;
    case 'team':
      return part('team');
    case 'criteria':
      return part('criteria');
    case 'interviews':
      return part('plan');
    case 'apply':
      return part('form');
    case 'description':
      return <DescriptionStep {...p} />;
    default:
      return null;
  }
}

/** The title, edited where it is read: in the middle of the bar, kept when it loses focus. */
function TitleField({ data, props }: TermsProps): JSX.Element {
  const act = useAct(props);
  const [title, setTitle] = useState(data.job.title);
  return (
    <Input
      appearance="plain"
      size="sm"
      aria-label="Job title"
      value={title}
      containerClassName="w-[min(28rem,60vw)] font-semibold"
      className="text-center"
      onChange={(e) => {
        setTitle(e.target.value);
      }}
      onBlur={() => {
        const next = title.trim();
        if (next === '' || next === data.job.title) {
          setTitle(data.job.title);
          return;
        }
        act.run('SaveJobDetails', {
          jobId: data.job.id,
          input: detailsOf(data.job, { title: next }),
        });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function JobWizard({
  open,
  data,
  props,
  stepKey,
  onStep,
  onClose,
  onFinish,
  part,
}: {
  readonly open: boolean;
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly stepKey: string | null;
  readonly onStep: (key: string) => void;
  readonly onClose: () => void;
  readonly onFinish: () => void;
  readonly part: (part: BorrowedPart) => ReactNode;
}): JSX.Element {
  const index = Math.max(
    0,
    WIZARD_STEPS.findIndex((s) => s.key === stepKey),
  );
  const step = WIZARD_STEPS[index] ?? FIRST;
  const commit = useRef<Commit['current']>(null);
  const [moving, setMoving] = useState(false);
  const status = WIZARD_STEPS.map((s, i) => s.done(data) ?? i < index);
  const percent = Math.round((status.filter(Boolean).length / WIZARD_STEPS.length) * 100);
  const last = index === WIZARD_STEPS.length - 1;
  const go = async (to: number | 'finish'): Promise<void> => {
    // A typed answer is kept before the step changes; a refusal stays on the step.
    if (commit.current !== null) {
      setMoving(true);
      const kept = await commit.current();
      setMoving(false);
      if (!kept) return;
    }
    if (to === 'finish') onFinish();
    else onStep(WIZARD_STEPS[to]?.key ?? 'role');
  };
  return (
    <ModalPage
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <ModalPageContent size="full">
        <ModalPageHeader
          align="center"
          label={`Set up ${data.job.title}`}
          dismissLabel="Close. Everything so far is kept."
          title={<TitleField key={data.job.title} data={data} props={props} />}
          meta={
            <div className="flex w-36 items-center gap-2 max-sm:hidden">
              <Progress value={percent} label="Set up" size="sm" />
              <span className="shrink-0 text-xs font-semibold text-fg-muted tabular-nums">{`${String(percent)}%`}</span>
            </div>
          }
          actions={
            <Button size="sm" variant="secondary" onClick={onClose}>
              Save and close
            </Button>
          }
        />
        <ModalPageBody>
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:py-12">
            <aside className="max-lg:hidden">
              <div className="sticky top-0">
                <Stepper
                  label="Set-up steps"
                  orientation="vertical"
                  size="sm"
                  free
                  current={index}
                  onStepChange={(i) => {
                    void go(i);
                  }}
                  steps={WIZARD_STEPS.map((s, i) => ({
                    id: s.key,
                    label: s.label,
                    ...(i === 0 || WIZARD_STEPS[i - 1]?.group !== s.group
                      ? { description: s.group }
                      : {}),
                    status: i === index ? 'current' : status[i] ? 'complete' : 'upcoming',
                  }))}
                />
              </div>
            </aside>
            <section
              key={step.key}
              aria-labelledby="setup-step-title"
              className="mx-auto flex w-full max-w-2xl animate-enter flex-col gap-6 motion-reduce:animate-none"
            >
              <header className="flex flex-col gap-2">
                <h2
                  id="setup-step-title"
                  className="text-2xl font-bold tracking-[-0.02em] text-balance text-fg"
                >
                  {step.title}
                </h2>
                <p className="text-fg-muted text-pretty">{step.hint(data)}</p>
              </header>
              {body(step.key, { data, props, commit }, part)}
            </section>
          </div>
        </ModalPageBody>
        <ModalPageFooter className="@2xl:justify-between">
          <Button
            variant="secondary"
            disabled={index === 0 || moving}
            startIcon={<icons.back aria-hidden />}
            onClick={() => {
              void go(index - 1);
            }}
          >
            Back
          </Button>
          <span className="text-center text-sm text-fg-muted tabular-nums">{`Step ${String(index + 1)} of ${String(WIZARD_STEPS.length)} · ${step.group} · ${String(percent)}% done`}</span>
          <Button
            loading={moving}
            endIcon={last ? <icons.visible aria-hidden /> : <icons.forward aria-hidden />}
            onClick={() => {
              void go(last ? 'finish' : index + 1);
            }}
          >
            {last ? 'Review the ad' : 'Continue'}
          </Button>
        </ModalPageFooter>
      </ModalPageContent>
    </ModalPage>
  );
}
