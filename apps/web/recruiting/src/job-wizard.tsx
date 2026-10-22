import {
  Alert,
  Button,
  Combobox,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  IconList,
  IconListItem,
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
  Reveal,
  RichTextEditor,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
  icons,
  staggerStyle,
} from '@reach/ui';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
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
 * R4–R7: a job, set up on a page of its own over the jobs list. Eight pages,
 * each one question in a few parts, in the order the law needs them answered:
 * the role, where the work is, the kind of contract, when they work, what it
 * pays and offers, who hires and against what, how they apply and are
 * interviewed, and last the description, drafted by AI from all of it.
 *
 * A part that depends on an earlier one unfolds when that one is answered.
 * Picks are kept the moment they are made; typed answers when the page moves
 * on, which happens in the browser, without waiting for the server. Finishing
 * shows the ad as candidates will read it, to publish.
 */

/** The parts of the job this setup borrows from the ad's edit panels. */
export type BorrowedPart = 'team' | 'criteria' | 'plan' | 'form';

type Render = (p: TermsProps, part: (part: BorrowedPart, commit: Commit) => ReactNode) => ReactNode;

interface Block {
  readonly key: string;
  readonly label: string;
  readonly hint?: (data: JobData) => string;
  /** Its earlier parts are answered, so it can be asked. */
  readonly ready: (data: JobData) => boolean;
  /** Answered; null for a part with nothing it must have. */
  readonly done: (data: JobData) => boolean | null;
  readonly render: Render;
}

interface Page {
  readonly key: string;
  readonly title: string;
  readonly hint: (data: JobData) => string;
  readonly blocks: readonly Block[];
}

const always = (): boolean => true;

const SENIORITY = [
  ['entry', 'Entry', 'New to the work', <icons.goal key="i" aria-hidden />],
  ['mid', 'Mid', 'Works on their own', <icons.person key="i" aria-hidden />],
  ['senior', 'Senior', 'Leads the work', <icons.starred key="i" aria-hidden />],
  ['lead', 'Lead', 'Leads people or a field', <icons.team key="i" aria-hidden />],
  ['executive', 'Executive', 'Leads a function', <icons.organisation key="i" aria-hidden />],
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
          {SENIORITY.map(([key, label, description, icon]) => (
            <RadioCard key={key} value={key} description={description} icon={icon}>
              {label}
            </RadioCard>
          ))}
        </RadioGroup>
      </Field>
    </>
  );
}

/** The title, the first thing a job is given: kept when the setup moves on. */
/** The title as it is being typed: the bar at the top shows it word by word. */
const DraftTitle = createContext<{
  readonly value: string;
  readonly set: (title: string) => void;
} | null>(null);

function TitleStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const draft = use(DraftTitle);
  const [own, setOwn] = useState(data.job.title);
  const title = draft?.value ?? own;
  const setTitle = draft?.set ?? setOwn;
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

const LENGTHS = [
  ['150', 'Short'],
  ['300', 'Medium'],
  ['500', 'Long'],
] as const;

const TONES = [
  ['professional', 'Professional'],
  ['warm', 'Warm'],
  ['direct', 'Direct'],
  ['energetic', 'Energetic'],
] as const;

/** Words in a document, for the length a change starts from. */
const wordsIn = (doc: unknown): number => {
  const walk = (n: unknown): string => {
    if (typeof n !== 'object' || n === null) return '';
    const node = n as { text?: unknown; content?: readonly unknown[] };
    return `${typeof node.text === 'string' ? node.text : ''} ${(node.content ?? []).map(walk).join(' ')}`;
  };
  return walk(doc).split(/\s+/u).filter(Boolean).length;
};

/**
 * The role's description: drafted by AI the first time the page opens, from
 * the job as set up so far, as rich text. How long and in what voice is the
 * team's to choose, and a draft can be made longer, shorter or said another
 * way. The title and every fact stay the job's own: Recruiting keeps the
 * title and drops any amount of money a model writes.
 */
function DescriptionStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const language = data.ads[0]?.language ?? data.job.languages[0] ?? 'en';
  const ad = data.ads.find((a) => a.language === language);
  const [title, setTitle] = useState(ad?.title ?? data.job.title);
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [drawn, setDrawn] = useState<{ html: string; n: number } | null>(null);
  const [note, setNote] = useState('');
  const [words, setWords] = useState('300');
  const [tone, setTone] = useState('professional');
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [doing, setDoing] = useState<string | null>(null);
  // What a change revises: the words in the editor, else the ad as saved.
  const base: unknown = doc ?? ad?.doc ?? null;
  const draft = (
    change: 'longer' | 'shorter' | 'rephrase' | null,
    length = Number(words),
  ): void => {
    setDoing(change ?? 'draft');
    startDrafting(async () => {
      setError(null);
      const done = await act.call('DraftAd', {
        jobId: data.job.id,
        input: {
          language,
          intake: note,
          words: length,
          tone,
          change,
          ...(change === null || base === null ? {} : { current: base }),
        },
      });
      setDoing(null);
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
    draft(null);
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
  const current = base === null ? Number(words) : Math.max(80, wordsIn(base));
  return (
    <>
      <Refusal error={error} />
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Length</FieldLabel>
            <SegmentedControl aria-label="Length" value={words} onValueChange={setWords}>
              {LENGTHS.map(([value, label]) => (
                <SegmentedControlItem key={value} value={value}>
                  {`${label}, ${value}`}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Field>
          <Field>
            <FieldLabel>Tone</FieldLabel>
            <SegmentedControl aria-label="Tone" value={tone} onValueChange={setTone}>
              {TONES.map(([value, label]) => (
                <SegmentedControlItem key={value} value={value}>
                  {label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Field>
        </div>
        <Field>
          <FieldLabel>Anything the AI should say</FieldLabel>
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
          <FieldDescription>
            Pay, hours, holiday and the contract are never written into the text: the ad shows them
            from the job, exactly as set.
          </FieldDescription>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            loading={drafting && doing === 'draft'}
            disabled={drafting}
            startIcon={<icons.assistant aria-hidden />}
            onClick={() => {
              draft(null);
            }}
          >
            {ad === undefined && drawn === null ? 'Write it' : 'Write it again'}
          </Button>
          <Button
            variant="secondary"
            loading={drafting && doing === 'longer'}
            disabled={drafting || base === null}
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              draft('longer', Math.min(900, Math.round(current * 1.4)));
            }}
          >
            Longer
          </Button>
          <Button
            variant="secondary"
            loading={drafting && doing === 'shorter'}
            disabled={drafting || base === null}
            startIcon={<icons.remove aria-hidden />}
            onClick={() => {
              draft('shorter', Math.max(80, Math.round(current * 0.7)));
            }}
          >
            Shorter
          </Button>
          <Button
            variant="secondary"
            loading={drafting && doing === 'rephrase'}
            disabled={drafting || base === null}
            startIcon={<icons.refresh aria-hidden />}
            onClick={() => {
              draft('rephrase', current);
            }}
          >
            Rephrase
          </Button>
        </div>
      </div>
      {drafting ? (
        <Alert tone="info" icon={<icons.assistant aria-hidden />} title="Writing">
          {`From ${data.job.title}, the team, the place and the terms. A few seconds.`}
        </Alert>
      ) : null}
      <RichTextEditor
        key={String(drawn?.n ?? 0)}
        label="Role description"
        value={drawn?.html ?? ad?.html ?? ''}
        onChangeJson={(next) => {
          setDoc(next);
        }}
        minHeight="24rem"
      />
    </>
  );
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

const ROLE: Page = {
  key: 'role',
  title: 'What is the job?',
  hint: () =>
    'Its title as candidates will read it, the team it sits in and how senior it is. The level shapes the description and the pay estimate.',
  blocks: [
    {
      key: 'title',
      label: 'Title',
      ready: always,
      done: (d) => d.job.title.trim() !== '',
      render: (p) => <TitleStep {...p} />,
    },
    {
      key: 'level',
      label: 'Team and level',
      ready: always,
      done: (d) => d.job.department !== null && d.job.outline.seniority !== null,
      render: (p) => <RoleStep {...p} />,
    },
    {
      key: 'openings',
      label: 'Openings and start',
      hint: () => 'The start date is a target for the team, not a promise in the ad.',
      ready: always,
      done: () => null,
      render: (p) => <OpeningsStep {...p} />,
    },
  ],
};

export const WIZARD_PAGES: readonly Page[] = [
  ROLE,
  {
    key: 'where',
    title: 'Where is the work?',
    hint: () =>
      'The employing entity’s country sets the law for everything after this: the contracts on offer, the hours, the leave and the pay floor.',
    blocks: [
      {
        key: 'entity',
        label: 'Employer',
        ready: always,
        done: (d) => d.terms.entityId !== null,
        render: (p) => <EntityChoice {...p} />,
      },
      {
        key: 'place',
        label: 'Workplace',
        ready: (d) => d.terms.entityId !== null,
        done: (d) => d.terms.locationId !== null,
        render: (p) => <PlaceChoice {...p} />,
      },
      {
        key: 'mode',
        label: 'How the work is done',
        ready: (d) => d.terms.locationId !== null,
        done: (d) =>
          d.terms.workMode !== null &&
          (d.terms.workMode !== 'hybrid' || d.terms.hybridDaysOnsite !== null),
        render: (p) => <ModeChoice {...p} />,
      },
    ],
  },
  {
    key: 'contract',
    title: 'What kind of contract?',
    hint: (d) =>
      `As the law in ${countryName(d.options.country)} sees it: first the kind of work, then only the contracts allowed for it. One that does not fit says why.`,
    blocks: [
      {
        key: 'worktype',
        label: 'Kind of work',
        ready: (d) => d.options.relationships.length > 0,
        done: (d) => d.terms.relationship !== null,
        render: (p) => <WorkTypeChoice {...p} />,
      },
      {
        key: 'contract',
        label: 'Contract',
        ready: (d) => d.terms.relationship !== null,
        done: (d) =>
          d.terms.contractType !== null &&
          (d.options.fixedTermReasons.length === 0 || d.terms.fixedTermReason !== null),
        render: (p) => <ContractChoice {...p} />,
      },
    ],
  },
  {
    key: 'time',
    title: 'When do they work?',
    hint: () =>
      'The days and the working day, in the workplace’s own time, then the paid holiday. The week is checked against the legal limit, and the leave never falls below the minimum.',
    blocks: [
      {
        key: 'days',
        label: 'Work days',
        ready: (d) => d.terms.contractType !== null,
        done: (d) => d.terms.workDays.length > 0,
        render: (p) => <DaysChoice {...p} />,
      },
      {
        key: 'hours',
        label: 'The working day',
        ready: (d) => d.terms.workDays.length > 0,
        done: (d) => d.terms.dayStart !== null && d.terms.dayEnd !== null,
        render: (p) => <HoursChoice {...p} />,
      },
      {
        key: 'leave',
        label: 'Paid holiday',
        ready: (d) => d.options.leave !== null,
        done: (d) => d.terms.vacationDays !== null,
        render: (p) => <LeaveChoice {...p} />,
      },
    ],
  },
  {
    key: 'pay',
    title: 'What does it pay and offer?',
    hint: () =>
      'The pay arrives filled in with what the market pays for this role there, as AI estimates it. Then choose the benefits, as many as suit.',
    blocks: [
      {
        key: 'salary',
        label: 'Pay',
        ready: (d) => d.terms.locationId !== null,
        done: (d) => d.job.salary !== null,
        render: (p) => <PayChoice {...p} />,
      },
      {
        key: 'benefits',
        label: 'Benefits',
        ready: (d) => d.terms.entityId !== null,
        done: () => null,
        render: (p) => <BenefitsChoice {...p} />,
      },
    ],
  },
  {
    key: 'hiring',
    title: 'Who hires, and for what?',
    hint: () =>
      'The people who decide, and what a candidate must bring. The match on each candidate is read against these criteria.',
    blocks: [
      {
        key: 'team',
        label: 'Hiring team',
        ready: always,
        done: (d) => d.team.some((t) => t.role === 'hiring_manager'),
        render: (p, part) => (p.commit === undefined ? null : part('team', p.commit)),
      },
      {
        key: 'criteria',
        label: 'What they must bring',
        ready: always,
        done: (d) => d.criteria.length > 0,
        render: (p, part) => (p.commit === undefined ? null : part('criteria', p.commit)),
      },
    ],
  },
  {
    key: 'process',
    title: 'How do they apply and interview?',
    hint: () =>
      'The interviews in order, each with its length and who runs it, and what the apply form asks. Name, email and CV are always asked.',
    blocks: [
      {
        key: 'interviews',
        label: 'Interviews',
        ready: always,
        done: (d) => d.plan.length > 0,
        render: (p, part) => (p.commit === undefined ? null : part('plan', p.commit)),
      },
      {
        key: 'apply',
        label: 'Apply form',
        ready: always,
        done: () => null,
        render: (p, part) => (p.commit === undefined ? null : part('form', p.commit)),
      },
    ],
  },
  {
    key: 'description',
    title: 'Describe the role',
    hint: () =>
      'Written by AI from everything so far. Edit anything; pay, contract and benefits show beside it from the job.',
    blocks: [
      {
        key: 'ad',
        label: 'Role description',
        ready: always,
        done: (d) => d.ads.length > 0,
        render: (p) => <DescriptionStep {...p} />,
      },
    ],
  },
];

/** The page an address names: by its own key, or by one of its parts' (an older link). */
const pageIndex = (key: string | null): number => {
  const i = WIZARD_PAGES.findIndex((p) => p.key === key || p.blocks.some((b) => b.key === key));
  return Math.max(0, i);
};

/** How much is answered, across every part that must be. */
const percentOf = (data: JobData, visited: number): number => {
  const parts = WIZARD_PAGES.flatMap((p, i) => p.blocks.map((b) => b.done(data) ?? i < visited));
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
};

/** One part of a page: its name, a line, and the answer, arriving in turn. Its name stays in view as its answer scrolls. */
function BlockView({
  label,
  hint,
  order,
  children,
}: {
  readonly label: string;
  readonly hint: string | undefined;
  readonly order: number;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-label={label}
      className="flex animate-arrive flex-col gap-4"
      style={staggerStyle(order, 'animation')}
    >
      <header className="z-10 -mx-2 flex flex-col gap-1 bg-canvas/90 px-2 py-2 backdrop-blur-md lg:sticky lg:top-0">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-fg">{label}</h3>
        {hint === undefined ? null : <p className="text-sm text-fg-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * The page the setup is drawn on: the close at the start of the bar, the
 * title in the middle with how much is done; the question and its parts in
 * a column of their own on the left, staying while the answers scroll on the
 * right; Back, "Step n of N" and Continue at the foot.
 */
function WizardFrame({
  open,
  label,
  title,
  percent,
  index,
  page,
  data,
  direction,
  moving,
  last,
  entered,
  notice,
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
  readonly page: Page;
  readonly data: JobData | null;
  /** Which way the person is going: the question arrives from that side. */
  readonly direction: 1 | -1;
  readonly moving: boolean;
  readonly last: boolean;
  /** Arriving from the page before, already open: no second entrance. */
  readonly entered: boolean;
  /** Something on a page already left did not save: said here, with the way back. */
  readonly notice?: ReactNode;
  readonly onClose: () => void;
  readonly onBack: (() => void) | null;
  readonly onNext: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const travel = { '--arrive-from': `${String(direction * 2)}rem` } as CSSProperties;
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
          // A page that asks for words is ready to type into; otherwise the page itself.
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
        {/* On a wide screen the question stays where it is and only the answers scroll;
            on a phone the page scrolls under a bar that keeps the question. */}
        <ModalPageBody className="lg:overflow-hidden">
          <div
            key={page.key}
            style={travel}
            className="mx-auto grid w-full max-w-6xl gap-x-20 gap-y-8 px-4 pb-16 sm:px-8 lg:h-full lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:pb-0"
          >
            <aside className="sticky top-0 z-20 -mx-4 bg-canvas/90 px-4 pt-6 pb-3 backdrop-blur-md sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:overflow-y-auto lg:bg-transparent lg:px-0 lg:py-16 lg:backdrop-blur-none">
              <div className="flex flex-col gap-3 lg:gap-4">
                <h2
                  id="setup-step-title"
                  className="animate-arrive text-2xl font-bold tracking-[-0.025em] text-balance text-fg lg:text-4xl"
                >
                  {page.title}
                </h2>
                <p
                  className="animate-arrive text-fg-muted text-pretty max-lg:hidden lg:text-lg"
                  style={staggerStyle(1, 'animation')}
                >
                  {data === null ? page.hint({} as JobData) : page.hint(data)}
                </p>
                {page.blocks.length < 2 || data === null ? null : (
                  <IconList
                    aria-label="On this page"
                    className="mt-2 animate-arrive max-lg:hidden"
                    style={staggerStyle(2, 'animation')}
                  >
                    {page.blocks.map((b) => {
                      const done = b.done(data) === true;
                      const ready = b.ready(data);
                      return (
                        <IconListItem
                          key={b.key}
                          tone={done ? 'success' : 'neutral'}
                          icon={
                            done ? (
                              <icons.success aria-hidden />
                            ) : ready ? (
                              <icons.pending aria-hidden />
                            ) : (
                              <icons.locked aria-hidden />
                            )
                          }
                          description={
                            done ? 'Answered' : ready ? 'To answer' : 'After the part above'
                          }
                        >
                          {b.label}
                        </IconListItem>
                      );
                    })}
                  </IconList>
                )}
              </div>
            </aside>
            <div className="flex min-w-0 flex-col gap-14 lg:-mr-8 lg:overflow-y-auto lg:overscroll-contain lg:py-16 lg:pr-8">
              <p
                className="animate-arrive text-fg-muted text-pretty lg:hidden"
                style={staggerStyle(1, 'animation')}
              >
                {data === null ? page.hint({} as JobData) : page.hint(data)}
              </p>
              {notice}
              {children}
            </div>
          </div>
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
          <span className="text-center text-sm text-fg-muted tabular-nums">{`Step ${String(index + 1)} of ${String(WIZARD_PAGES.length)}`}</span>
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

/** Where the setup is, kept in the address without asking the server for the page again. */
const writeStep = (key: string): void => {
  const url = new URL(window.location.href);
  if (key === ROLE.key) url.searchParams.delete('step');
  else url.searchParams.set('step', key);
  url.searchParams.delete('entered');
  window.history.replaceState(window.history.state, '', url);
};

export function JobWizard({
  open,
  data,
  props,
  stepKey,
  entered,
  onClose,
  onFinish,
  part,
}: {
  readonly open: boolean;
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly stepKey: string | null;
  readonly entered: boolean;
  readonly onClose: () => void;
  readonly onFinish: () => void;
  readonly part: (part: BorrowedPart, commit: Commit) => ReactNode;
}): JSX.Element {
  const act = useAct(props);
  // Opened without a page named: where it was left last time.
  const asked = stepKey ?? data.terms.setupStep;
  // The page is the browser's to change: the address follows, the server is not asked.
  // `seen` is the address's step as last read: only a change there (back, a link) moves the page.
  const [step, setStep] = useState({
    seen: asked,
    index: pageIndex(asked),
    direction: 1 as 1 | -1,
  });
  if (step.seen !== asked) {
    const to = pageIndex(asked);
    setStep({ seen: asked, index: to, direction: to >= step.index ? 1 : -1 });
  }
  const index = step.index;
  const page = WIZARD_PAGES[index] ?? ROLE;
  // The title as it is typed, shown in the bar word by word.
  const [title, setTitle] = useState({ base: data.job.title, value: data.job.title });
  if (title.base !== data.job.title) setTitle({ base: data.job.title, value: data.job.title });
  const draftTitle = useMemo(
    () => ({
      value: title.value,
      set: (value: string) => {
        setTitle((t) => ({ ...t, value }));
      },
    }),
    [title.value],
  );
  // Every part holding typed answers adds what keeps them.
  const keepers = useRef(new Set<() => Promise<boolean>>());
  const commit = useMemo<Commit>(
    () => ({
      add: (keep) => {
        keepers.current.add(keep);
        return () => {
          keepers.current.delete(keep);
        };
      },
    }),
    [],
  );
  // Saves still on their way to Recruiting.
  const saving = useRef(new Set<Promise<unknown>>());
  const track = useCallback((p: Promise<unknown>) => {
    saving.current.add(p);
    void p.finally(() => saving.current.delete(p));
  }, []);
  const [moving, setMoving] = useState(false);
  const [failed, setFailed] = useState<number | null>(null);
  const last = index === WIZARD_PAGES.length - 1;
  /** Start keeping what the page holds; the promise says whether all of it was kept. */
  const keepPage = (): Promise<boolean> => {
    const kept = [...keepers.current].map((keep) => keep());
    return Promise.all(kept).then((all) => all.every(Boolean));
  };
  const remember = (key: string): void => {
    track(act.call('SaveJobTerms', { jobId: data.job.id, input: { setupStep: key } }));
  };
  const go = (to: number): void => {
    // The next page is shown at once; what this one holds is kept on the way.
    const from = index;
    const kept = keepPage();
    track(kept);
    void kept.then((ok) => {
      if (!ok) setFailed(from);
    });
    const key = WIZARD_PAGES[to]?.key ?? ROLE.key;
    setFailed(null);
    setStep({ seen: step.seen, index: to, direction: to > index ? 1 : -1 });
    writeStep(key);
    remember(key);
  };
  const settle = async (): Promise<boolean> => {
    setMoving(true);
    const ok = await keepPage();
    await Promise.all(saving.current);
    setMoving(false);
    return ok;
  };
  return (
    <DraftTitle value={draftTitle}>
      <WizardFrame
        open={open}
        label={`Set up ${title.value.trim() === '' ? 'a job' : title.value}`}
        title={
          // On the page that asks for the title the bar shows it as it is typed: one place to type it.
          page.key === ROLE.key ? (
            <span className="truncate text-md font-semibold text-fg">
              {title.value.trim() === '' ? 'New job' : title.value}
            </span>
          ) : (
            <TitleField key={data.job.title} data={data} props={props} />
          )
        }
        percent={percentOf(data, index)}
        index={index}
        page={page}
        data={data}
        direction={step.direction}
        moving={moving}
        last={last}
        entered={entered}
        notice={
          failed === null ? null : (
            <Alert
              tone="danger"
              title={`Something on “${WIZARD_PAGES[failed]?.title ?? ''}” did not save`}
              className="animate-arrive"
            >
              <span className="flex flex-wrap items-center gap-3">
                Go back to it to see what Recruiting said.
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    go(failed);
                  }}
                >
                  Go back
                </Button>
              </span>
            </Alert>
          )
        }
        onClose={() => {
          // Closing midway keeps everything typed, and where it was left.
          remember(page.key);
          void settle().then(onClose);
        }}
        onBack={
          index === 0
            ? null
            : () => {
                go(index - 1);
              }
        }
        onNext={() => {
          if (!last) {
            go(index + 1);
            return;
          }
          // The ad is read straight after: the last page is kept first.
          void settle().then((ok) => {
            if (ok) onFinish();
          });
        }}
      >
        <SaveQueue value={track}>
          {page.blocks.some((b) => b.ready(data)) ? null : (
            <Alert
              tone="info"
              title="This page follows from the one before"
              className="animate-arrive"
              style={staggerStyle(2, 'animation')}
            >
              Answer the earlier pages first; the questions here depend on them.
            </Alert>
          )}
          {page.blocks.map((b, i) => {
            const ready = b.ready(data);
            return (
              <Reveal key={b.key} open={ready} unmountOnExit from="bottom">
                {ready ? (
                  <BlockView label={b.label} hint={b.hint?.(data)} order={i + 2}>
                    {b.render({ data, props, commit }, part)}
                  </BlockView>
                ) : null}
              </Reveal>
            );
          })}
        </SaveQueue>
      </WizardFrame>
    </DraftTitle>
  );
}

/**
 * A new job, on the same first page as any job's setup: the title, the team
 * and level, the openings. Nothing exists until Continue, which creates the
 * job with all of it and goes straight on to where the work is.
 */
export function NewJobWizard(props: ScreenProps<JobData>): JSX.Element {
  const act = useAct(props);
  const orgUnits =
    props.load.status === 'ready'
      ? ((props.load.data as unknown as { orgUnits?: JobData['orgUnits'] }).orgUnits ?? [])
      : [];
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [openings, setOpenings] = useState<number | null>(1);
  const [start, setStart] = useState<string | null>(null);
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
        department: team,
        // A placeholder: with `setup`, the work mode is left unanswered for its own page.
        workMode: 'onsite',
        openings: openings ?? 1,
        languages: ['en'],
        hiringManagerId: null,
        seniority: level,
        targetHireDate: start,
        setup: { step: 'where' },
      },
    });
    if (!made.ok) {
      setMoving(false);
      setError(made.message);
      return;
    }
    // One request made the job as described; the next page opens at once.
    props.onNavigate?.(`/recruiting/jobs/${id}/setup?setup=1&step=where&entered=1`);
  };
  return (
    <WizardFrame
      open
      label={title.trim() === '' ? 'New job' : `Set up ${title.trim()}`}
      title={
        <span className="truncate text-md font-semibold text-fg">
          {title.trim() === '' ? 'New job' : title}
        </span>
      }
      percent={0}
      index={0}
      page={ROLE}
      data={null}
      direction={1}
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
      <BlockView label="Title" hint={undefined} order={2}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <TitleInput value={title} onChange={setTitle} />
        </form>
      </BlockView>
      <BlockView label="Team and level" hint={undefined} order={3}>
        <Field required>
          <FieldLabel>Team</FieldLabel>
          <FieldControl>
            <Combobox
              label="Team"
              placeholder="Choose a team"
              searchPlaceholder="Search teams"
              options={orgUnits.map((u) => ({ value: u.name, label: u.name }))}
              value={team}
              emptyMessage="No team by that name. Add teams under Settings."
              onChange={(v) => {
                setTeam(typeof v === 'string' ? v : null);
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
            onValueChange={setLevel}
          >
            {SENIORITY.map(([key, label, description, icon]) => (
              <RadioCard key={key} value={key} description={description} icon={icon}>
                {label}
              </RadioCard>
            ))}
          </RadioGroup>
        </Field>
      </BlockView>
      <BlockView
        label="Openings and start"
        hint="The start date is a target for the team, not a promise in the ad."
        order={4}
      >
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
      </BlockView>
    </WizardFrame>
  );
}
