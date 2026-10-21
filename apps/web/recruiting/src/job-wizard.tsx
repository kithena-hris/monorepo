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
  Textarea,
  icons,
} from '@reach/ui';
import {
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

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
  SaveQueue,
  WorkTypeChoice,
  countryName,
  useCommit,
  type Commit,
  type TermsProps,
} from './job-terms';
import { Refusal, newId, useAct } from './shared';
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
  key: 'title',
  group: 'The role',
  label: 'Title',
  title: 'What is the job called?',
  hint: () =>
    'As candidates will read it. In Germany, add a gender-neutral marker such as (m/w/d).',
  done: (d) => d.job.title.trim() !== '',
};

export const WIZARD_STEPS: readonly Step[] = [
  FIRST,
  {
    key: 'role',
    group: 'The role',
    label: 'Team and level',
    title: 'Which team is it in, and how senior?',
    hint: () => 'The level shapes the description and the pay estimate.',
    done: (d) => d.job.department !== null && d.job.outline.seniority !== null,
  },
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

/** A value shown the moment it is picked; the server's replaces it when it arrives. */
function useShown<T>(server: T): [T, (value: T) => void] {
  const [held, setHeld] = useState({ server, value: server });
  if (!Object.is(held.server, server)) setHeld({ server, value: server });
  return [
    Object.is(held.server, server) ? held.value : server,
    (value) => {
      setHeld({ server, value });
    },
  ];
}

function RoleStep({ data, props }: TermsProps): JSX.Element {
  const act = useAct(props);
  const track = use(SaveQueue);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useShown(data.job.department);
  const [level, setLevel] = useShown(data.job.outline.seniority);
  const save = (change: Partial<JobRecord>, undo: () => void): void => {
    setError(null);
    const saving = act
      .call('SaveJobDetails', { jobId: data.job.id, input: detailsOf(data.job, change) })
      .then((done) => {
        if (!done.ok) {
          setError(done.message);
          undo();
          return;
        }
        props.onRefresh?.();
      });
    track?.(saving);
  };
  return (
    <>
      <Refusal error={error} />
      <Field required>
        <FieldLabel>Team</FieldLabel>
        <FieldControl>
          <Combobox
            label="Team"
            placeholder="Choose a team"
            searchPlaceholder="Search teams"
            options={data.orgUnits.map((u) => ({ value: u.name, label: u.name }))}
            value={team}
            emptyMessage="No team by that name. Add teams under Settings."
            onChange={(v) => {
              const next = typeof v === 'string' ? v : null;
              setTeam(next);
              save({ department: next }, () => {
                setTeam(data.job.department);
              });
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>Level</FieldLabel>
        <RadioGroup
          aria-label="Level"
          className="grid gap-2 sm:grid-cols-2"
          value={level ?? ''}
          onValueChange={(v) => {
            setLevel(v);
            save({ outline: { ...data.job.outline, seniority: v } }, () => {
              setLevel(data.job.outline.seniority);
            });
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

/** The title, the first thing a job is given: kept when the setup moves on. */
function TitleStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const [title, setTitle] = useState(data.job.title);
  const [error, setError] = useState<string | null>(null);
  useCommit(commit, async () => {
    const next = title.trim();
    if (next === '') {
      setError('A job needs a title');
      return false;
    }
    if (next === data.job.title) return true;
    const done = await act.call('SaveJobDetails', {
      jobId: data.job.id,
      input: detailsOf(data.job, { title: next }),
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
      <TitleInput value={title} onChange={setTitle} />
    </>
  );
}

function TitleInput({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Field required>
      <FieldLabel>Job title</FieldLabel>
      <FieldControl>
        <Input
          size="lg"
          value={value}
          placeholder="Senior Backend Engineer (m/w/d)"
          // The page opens on this question: the frame puts focus here, not on the close.
          data-autofocus
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </FieldControl>
    </Field>
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
    case 'title':
      return <TitleStep {...p} />;
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

/**
 * The page the setup is drawn on: the close at the start of the bar, the
 * title in the middle with how much is done, one step at the centre, and
 * Back, "Step n of N" and Continue at the foot.
 */
function WizardFrame({
  open,
  label,
  title,
  percent,
  index,
  step,
  hint,
  moving,
  last,
  entered,
  onClose,
  onBack,
  onNext,
  children,
}: {
  readonly open: boolean;
  readonly label: string;
  readonly title: ReactNode;
  readonly percent: number;
  readonly index: number;
  readonly step: Step;
  readonly hint: string;
  readonly moving: boolean;
  readonly last: boolean;
  /** Arriving from the page before, already open: no second entrance. */
  readonly entered: boolean;
  readonly onClose: () => void;
  readonly onBack: (() => void) | null;
  readonly onNext: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <ModalPage
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <ModalPageContent
        size="full"
        className={entered ? 'data-[state=open]:animate-none' : undefined}
        onOpenAutoFocus={(e) => {
          // A step that asks for words is ready to type into; otherwise the page itself.
          const first = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
            '[data-autofocus]',
          );
          if (first !== null && first !== undefined) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <ModalPageHeader
          align="center"
          label={label}
          dismissLabel="Close. Everything so far is kept."
          title={title}
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
          <section
            key={step.key}
            aria-labelledby="setup-step-title"
            className="mx-auto flex w-full max-w-2xl animate-enter flex-col gap-6 px-4 py-10 motion-reduce:animate-none sm:px-6 lg:py-16"
          >
            <header className="flex flex-col gap-2">
              <h2
                id="setup-step-title"
                className="text-2xl font-bold tracking-[-0.02em] text-balance text-fg"
              >
                {step.title}
              </h2>
              <p className="text-fg-muted text-pretty">{hint}</p>
            </header>
            {children}
          </section>
        </ModalPageBody>
        <ModalPageFooter className="@2xl:justify-between">
          <Button
            variant="secondary"
            disabled={onBack === null || moving}
            startIcon={<icons.back aria-hidden />}
            onClick={() => {
              onBack?.();
            }}
          >
            Back
          </Button>
          <span className="text-center text-sm text-fg-muted tabular-nums">{`Step ${String(index + 1)} of ${String(WIZARD_STEPS.length)}`}</span>
          <Button
            loading={moving}
            endIcon={last ? <icons.visible aria-hidden /> : <icons.forward aria-hidden />}
            onClick={onNext}
          >
            {last ? 'Review the ad' : 'Continue'}
          </Button>
        </ModalPageFooter>
      </ModalPageContent>
    </ModalPage>
  );
}

export function JobWizard({
  open,
  data,
  props,
  stepKey,
  entered,
  onStep,
  onClose,
  onFinish,
  part,
}: {
  readonly open: boolean;
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly stepKey: string | null;
  readonly entered: boolean;
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
  // Picks still on their way to Recruiting: a step waits for them before moving on.
  const saving = useRef(new Set<Promise<unknown>>());
  const track = useCallback((p: Promise<unknown>) => {
    saving.current.add(p);
    void p.finally(() => saving.current.delete(p));
  }, []);
  const [moving, setMoving] = useState(false);
  const status = WIZARD_STEPS.map((s, i) => s.done(data) ?? i < index);
  const percent = Math.round((status.filter(Boolean).length / WIZARD_STEPS.length) * 100);
  const last = index === WIZARD_STEPS.length - 1;
  const go = async (to: number | 'finish'): Promise<void> => {
    setMoving(true);
    await Promise.all(saving.current);
    // A typed answer is kept before the step changes; a refusal stays on the step.
    const kept = commit.current === null ? true : await commit.current();
    setMoving(false);
    if (!kept) return;
    if (to === 'finish') onFinish();
    else onStep(WIZARD_STEPS[to]?.key ?? FIRST.key);
  };
  return (
    <WizardFrame
      open={open}
      label={`Set up ${data.job.title}`}
      title={
        // On the title's own step the bar only shows it: one place to type it at a time.
        step.key === FIRST.key ? (
          <span className="text-md font-semibold text-fg">{data.job.title}</span>
        ) : (
          <TitleField key={data.job.title} data={data} props={props} />
        )
      }
      percent={percent}
      index={index}
      step={step}
      hint={step.hint(data)}
      moving={moving}
      last={last}
      entered={entered}
      onClose={onClose}
      onBack={
        index === 0
          ? null
          : () => {
              void go(index - 1);
            }
      }
      onNext={() => {
        void go(last ? 'finish' : index + 1);
      }}
    >
      <SaveQueue value={track}>{body(step.key, { data, props, commit }, part)}</SaveQueue>
    </WizardFrame>
  );
}

/**
 * A new job, on the same page as its setup: the first step asks for the
 * title, and Continue creates the job and carries on to the next step.
 */
export function NewJobWizard(props: ScreenProps<JobData>): JSX.Element {
  const act = useAct(props);
  const [title, setTitle] = useState('');
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requisition = props.search?.['requisition'] ?? null;
  const create = async (): Promise<void> => {
    const name = title.trim();
    if (name === '') {
      setError('A job needs a title');
      return;
    }
    setMoving(true);
    setError(null);
    const id = newId();
    const made = await act.call('CreateJob', {
      input: {
        id,
        title: name,
        internalTitle: name,
        requisitionIds: requisition === null ? [] : [requisition],
        entityId: null,
        locationIds: [],
        department: null,
        // A placeholder the workplace steps ask about; it is cleared at once below.
        workMode: 'onsite',
        openings: 1,
        languages: ['en'],
        hiringManagerId: null,
      },
    });
    if (!made.ok) {
      setMoving(false);
      setError(made.message);
      return;
    }
    // How the work is done is a question for its own step, not a default.
    await act.call('SaveJobTerms', { jobId: id, input: { workMode: null } });
    props.onNavigate?.(`/recruiting/jobs/${id}/setup?setup=1&step=role&entered=1`);
  };
  return (
    <WizardFrame
      open
      label="New job"
      title={<span className="text-md font-semibold text-fg">New job</span>}
      percent={0}
      index={0}
      step={FIRST}
      hint={FIRST.hint({} as JobData)}
      moving={moving}
      last={false}
      entered={false}
      onClose={() => props.onNavigate?.('/recruiting/jobs')}
      onBack={null}
      onNext={() => {
        void create();
      }}
    >
      <Refusal error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <TitleInput value={title} onChange={setTitle} />
      </form>
    </WizardFrame>
  );
}
