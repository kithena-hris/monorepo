import {
  Alert,
  Button,
  Chip,
  ChipRow,
  Combobox,
  DatePicker,
  Field,
  FieldControl,
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
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
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
  Answers,
  PartKey,
  SaveQueue,
  useAnswered,
  WorkTypeChoice,
  countryName,
  useCommit,
  type Commit,
  type TermsProps,
} from './job-terms';
import { Refusal, newId, useAct } from './shared';
import {
  TermsPicks,
  prefetchCatalogue,
  prefetchCatalogues,
  stillPending,
  useCatalogue,
  viewOf,
  type Picks,
} from './terms-view';
import type { Done, JobData, JobRecord, JobTerms, ScreenProps } from './types';
import { t as tr } from './i18n';

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

/**
 * A neutral marker in a German title (AGG § 11), as Recruiting checks it
 * before publishing (`domain/ad/checks.ts`): asked for here, on the first
 * page, so the ad never stops at the last.
 */
const NEUTRAL =
  /\((?:[mwfdx]\s*\/\s*){2}[mwfdx]\)|\(all genders\)|\(alle geschlechter\)|\(gn\)|\w[*:_]in(?:nen)?\b|\bfachkraft\b|\bperson\b/iu;
export const neutralTitle = (title: string): boolean => NEUTRAL.test(title);

/** Every entity is German: a title without a neutral marker cannot be published anywhere. */
const onlyGerman = (entities: readonly { readonly country: string }[]): boolean =>
  entities.length > 0 && entities.every((e) => e.country === 'DE');

/** The chosen entity is German. */
const germanJob = (d: JobData): boolean =>
  d.entities.find((e) => e.id === d.terms.entityId)?.country === 'DE';

const SENIORITY = () =>
  [
    [
      'entry',
      tr('job-wizard.entry', 'Entry'),
      tr('job-wizard.new_to_the_work', 'New to the work'),
      <icons.goal key="i" aria-hidden />,
    ],
    [
      'mid',
      tr('job-wizard.mid', 'Mid'),
      tr('job-wizard.works_on_their_own', 'Works on their own'),
      <icons.person key="i" aria-hidden />,
    ],
    [
      'senior',
      tr('job-wizard.senior', 'Senior'),
      tr('job-wizard.leads_the_work', 'Leads the work'),
      <icons.starred key="i" aria-hidden />,
    ],
    [
      'lead',
      tr('job-wizard.lead', 'Lead'),
      tr('job-wizard.leads_people_or_a_field', 'Leads people or a field'),
      <icons.team key="i" aria-hidden />,
    ],
    [
      'executive',
      tr('job-wizard.executive', 'Executive'),
      tr('job-wizard.leads_a_function', 'Leads a function'),
      <icons.organisation key="i" aria-hidden />,
    ],
  ] as const;

/** Every detail of the job as it stands, with a change: the details save is whole, never partial. */
export const detailsOf = (job: JobRecord, change: Partial<JobRecord>): Record<string, unknown> => {
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

/** The first page's answers as they are typed and picked, ahead of Recruiting: one draft the
 * bar, the checklist and the parts all read, so each part unfolds and ticks as it is filled. */
interface JobDraft {
  readonly title?: string;
  readonly department?: string | null;
  readonly seniority?: string | null;
  readonly openings?: number;
  readonly targetHireDate?: string | null;
}

const JobDraftContext = createContext<{
  readonly job: JobRecord;
  readonly set: (patch: JobDraft) => void;
} | null>(null);

/** The job with the draft on top. */
const withDraft = (job: JobRecord, draft: JobDraft): JobRecord => ({
  ...job,
  ...(draft.title === undefined ? {} : { title: draft.title }),
  ...(draft.department === undefined ? {} : { department: draft.department }),
  ...(draft.openings === undefined ? {} : { openings: draft.openings }),
  ...(draft.targetHireDate === undefined ? {} : { targetHireDate: draft.targetHireDate }),
  outline:
    draft.seniority === undefined ? job.outline : { ...job.outline, seniority: draft.seniority },
});

/** The draft's edits Recruiting has not caught up with yet. */
const stillDrafted = (draft: JobDraft, job: JobRecord): JobDraft =>
  Object.fromEntries(
    Object.entries(draft).filter(([k, v]) =>
      k === 'seniority' ? job.outline.seniority !== v : job[k as keyof JobRecord] !== v,
    ),
  );

function useJobDraft(data: JobData): {
  readonly job: JobRecord;
  readonly set: (patch: JobDraft) => void;
} {
  const shared = use(JobDraftContext);
  const [own, setOwn] = useState<JobDraft>({});
  return (
    shared ?? {
      job: withDraft(data.job, own),
      set: (patch) => {
        setOwn((d) => ({ ...d, ...patch }));
      },
    }
  );
}

function RoleStep({ data, props }: TermsProps): JSX.Element {
  const act = useAct(props);
  const track = use(SaveQueue);
  const draft = useJobDraft(data);
  const [error, setError] = useState<string | null>(null);
  const save = (change: Partial<JobRecord>, undo: JobDraft): void => {
    setError(null);
    const saving = act
      .call('SaveJobDetails', { jobId: data.job.id, input: detailsOf(data.job, change) })
      .then((done) => {
        if (!done.ok) {
          setError(done.message);
          draft.set(undo);
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
        <FieldLabel>{tr('job-wizard.team', 'Team')}</FieldLabel>
        <FieldControl>
          <Combobox
            label={tr('job-wizard.team', 'Team')}
            placeholder={tr('job-wizard.choose_a_team', 'Choose a team')}
            searchPlaceholder={tr('job-wizard.search_teams', 'Search teams')}
            options={data.orgUnits.map((u) => ({ value: u.name, label: u.name }))}
            value={draft.job.department}
            emptyMessage={tr(
              'job-wizard.no_team_by_that_name_add',
              'No team by that name. Add teams under Settings.',
            )}
            onChange={(v) => {
              const next = typeof v === 'string' ? v : null;
              draft.set({ department: next });
              save({ department: next }, { department: data.job.department });
            }}
          />
        </FieldControl>
      </Field>
      <Field required>
        <FieldLabel>{tr('job-wizard.level', 'Level')}</FieldLabel>
        <RadioGroup
          aria-label={tr('job-wizard.level', 'Level')}
          className="grid gap-2 sm:grid-cols-2"
          value={draft.job.outline.seniority ?? ''}
          onValueChange={(v) => {
            draft.set({ seniority: v });
            save(
              { outline: { ...data.job.outline, seniority: v } },
              { seniority: data.job.outline.seniority },
            );
          }}
        >
          {SENIORITY().map(([key, label, description, icon]) => (
            <RadioCard key={key} value={key} description={description} icon={icon}>
              {label}
            </RadioCard>
          ))}
        </RadioGroup>
      </Field>
    </>
  );
}

/** The title, the first thing a job is given: the bar shows it as it is typed; kept when the setup moves on. */
function TitleStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const draft = useJobDraft(data);
  const title = draft.job.title;
  const [error, setError] = useState<string | null>(null);
  useCommit(commit, async () => {
    const next = title.trim();
    if (next === '') {
      setError(tr('job-wizard.a_job_needs_a_title', 'A job needs a title'));
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
      <TitleInput
        value={title}
        german={data.entities.some((e) => e.country === 'DE')}
        onChange={(t) => {
          draft.set({ title: t });
        }}
      />
    </>
  );
}

function TitleInput({
  value,
  german,
  onChange,
}: {
  readonly value: string;
  /** The company employs in Germany: the title is checked for a neutral marker as it is typed. */
  readonly german: boolean;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const flagged = german && value.trim() !== '' && !neutralTitle(value);
  return (
    <div className="flex flex-col gap-3">
      <Field required>
        <FieldLabel>{tr('job-wizard.job_title', 'Job title')}</FieldLabel>
        <FieldControl>
          <Input
            size="lg"
            value={value}
            placeholder={tr(
              'job-wizard.senior_backend_engineer_m_w_d',
              'Senior Backend Engineer (m/w/d)',
            )}
            // The page opens on this question: the frame puts focus here, not on the close.
            data-autofocus
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      {flagged ? (
        <Alert
          tone="warning"
          title={tr('job-wizard.a_german_ad_needs_a_neutral', 'A German ad needs a neutral title')}
          className="animate-arrive"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onChange(tr('job-wizard.m_w_d', '{{value}} (m/w/d)', { value: value.trim() }));
              }}
            >
              {tr('job-wizard.add_m_w_d', 'Add (m/w/d)')}
            </Button>
          }
        >
          {tr(
            'job-wizard.the_law_agg_11_asks_for',
            'The law (AGG § 11) asks for a marker such as (m/w/d), or a title neutral by itself. Add it now and the ad will not be stopped when you publish.',
          )}
        </Alert>
      ) : null}
    </div>
  );
}

function OpeningsStep({ data, props, commit }: TermsProps): JSX.Element {
  const act = useAct(props);
  const draft = useJobDraft(data);
  const { openings, targetHireDate: start } = draft.job;
  const [error, setError] = useState<string | null>(null);
  useCommit(commit, async () => {
    if (openings === data.job.openings && start === data.job.targetHireDate) return true;
    const done = await act.call('SaveJobDetails', {
      jobId: data.job.id,
      input: detailsOf(data.job, { openings, targetHireDate: start }),
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
      <OpeningsFields
        openings={openings}
        start={start}
        onOpenings={(n) => {
          draft.set({ openings: n ?? 1 });
        }}
        onStart={(d) => {
          draft.set({ targetHireDate: d });
        }}
      />
    </>
  );
}

function OpeningsFields({
  openings,
  start,
  onOpenings,
  onStart,
}: {
  readonly openings: number | null;
  readonly start: string | null;
  readonly onOpenings: (n: number | null) => void;
  readonly onStart: (d: string | null) => void;
}): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberField
        label={tr('job-wizard.openings', 'Openings')}
        value={openings}
        min={1}
        max={500}
        onChange={onOpenings}
      />
      <Field required>
        <FieldLabel>{tr('job-wizard.target_start', 'Target start')}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={tr('job-wizard.target_start', 'Target start')}
            value={start}
            onChange={onStart}
          />
        </FieldControl>
      </Field>
    </div>
  );
}

interface Draft {
  readonly title: string;
  readonly doc: Record<string, unknown>;
  readonly html: string;
}

const LENGTHS = () =>
  [
    ['150', tr('job-wizard.short', 'Short')],
    ['300', tr('job-wizard.medium', 'Medium')],
    ['500', tr('job-wizard.long', 'Long')],
  ] as const;

const TONES = () =>
  [
    ['professional', tr('job-wizard.professional', 'Professional')],
    ['warm', tr('job-wizard.warm', 'Warm')],
    ['direct', tr('job-wizard.direct', 'Direct')],
    ['energetic', tr('job-wizard.energetic', 'Energetic')],
  ] as const;

/** Words in a document, for the length a change starts from. */
const wordsIn = (doc: unknown): number => {
  const walk = (n: unknown): string => {
    if (typeof n !== 'object' || n === null) return '';
    const node = n as { text?: unknown; content?: readonly unknown[] };
    return tr('job-wizard.text', '{{value}} {{join}}', {
      value: typeof node.text === 'string' ? node.text : '',
      join: (node.content ?? []).map(walk).join(' '),
    });
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
  const [words, setWords] = useState(DEFAULT_WORDS);
  const [tone, setTone] = useState('professional');
  const [error, setError] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [doing, setDoing] = useState<string | null>(null);
  // The last thing asked of the AI, said back while it works and after: Enter is never silent.
  const [asked, setAsked] = useState<{ text: string; done: boolean } | null>(null);
  // What a change revises: the words in the editor, else the ad as saved.
  const base: unknown = doc ?? ad?.doc ?? null;
  useAnswered(base !== null);
  const draft = (
    change: 'longer' | 'shorter' | 'rephrase' | 'edit' | null,
    length = Number(words),
    intake = note,
  ): void => {
    setDoing(change ?? 'draft');
    startDrafting(async () => {
      setError(null);
      const done = await act.call('DraftAd', {
        jobId: data.job.id,
        input: {
          language,
          intake,
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
      setAsked((a) => (a === null ? null : { ...a, done: true }));
    });
  };
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || ad !== undefined) return;
    opened.current = true;
    // Written ahead on the page before: taken as it is, or waited on if still being written.
    const ahead = drafts.get(data.job.id);
    if (ahead === undefined) {
      draft(null);
      return;
    }
    drafts.delete(data.job.id);
    setDoing('draft');
    startDrafting(async () => {
      const done = await ahead;
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
  const ask = (): void => {
    const text = note.trim();
    if (text === '' || drafting) return;
    setAsked({ text, done: false });
    setNote('');
    // With words to change, only what is asked changes; with none, it is written with this in mind.
    if (base === null) draft(null, Number(words), text);
    else draft('edit', current, text);
  };
  return (
    <div className="flex flex-col gap-8">
      <Refusal error={error} />
      {/* The description first: it is what this page is for. */}
      <div className="flex flex-col gap-3">
        {drafting ? (
          <Alert
            tone="info"
            icon={<icons.assistant aria-hidden />}
            title={
              doing === 'draft'
                ? tr('job-wizard.writing_the_description', 'Writing the description')
                : tr('job-wizard.changing_the_description', 'Changing the description')
            }
            className="animate-arrive"
          >
            {asked !== null && !asked.done
              ? tr('job-wizard.as_asked_a_few_seconds', 'As asked: “{{text}}”. A few seconds.', {
                  text: asked.text,
                })
              : tr(
                  'job-wizard.from_the_team_the_place_and',
                  'From {{title}}, the team, the place and the terms. A few seconds.',
                  { title: data.job.title },
                )}
          </Alert>
        ) : null}
        <RichTextEditor
          key={String(drawn?.n ?? 0)}
          label={tr('job-wizard.role_description', 'Role description')}
          value={drawn?.html ?? ad?.html ?? ''}
          onChangeJson={(next) => {
            setDoc(next);
          }}
          minHeight="24rem"
        />
      </div>

      {/* Asking the AI for a change: said back while it works, and once it is done. */}
      <section aria-labelledby="ask-ai" className="flex flex-col gap-3">
        <h4 id="ask-ai" className="font-semibold">
          {tr('job-wizard.ask_the_ai_to_change_it', 'Ask the AI to change it')}
        </h4>
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <Input
            aria-label={tr('job-wizard.what_to_change', 'What to change')}
            placeholder={tr(
              'job-wizard.mention_the_payments_team_and_the',
              'Mention the payments team and the move to TypeScript',
            )}
            value={note}
            disabled={drafting}
            containerClassName="min-w-0 flex-1"
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <Button
            type="submit"
            variant="primary"
            loading={drafting && (doing === 'edit' || (doing === 'draft' && asked !== null))}
            disabled={note.trim() === '' || drafting}
            startIcon={<icons.send aria-hidden />}
          >
            {tr('job-wizard.ask', 'Ask')}
          </Button>
        </form>
        {asked === null ? null : (
          <p className="flex items-start gap-2 text-sm text-fg-muted" aria-live="polite">
            {asked.done ? (
              <icons.success aria-hidden className="mt-0.5 size-4 shrink-0 text-success-fg" />
            ) : (
              <icons.loading aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin" />
            )}
            <span>
              {asked.done
                ? tr('job-wizard.done_text', 'Done: “{{text}}”', { text: asked.text })
                : tr('job-wizard.working_on_it_text', 'Working on it: “{{text}}”', {
                    text: asked.text,
                  })}
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(
            [
              [
                'longer',
                tr('job-wizard.longer', 'Longer'),
                <icons.add key="i" aria-hidden />,
                Math.min(900, Math.round(current * 1.4)),
              ],
              [
                'shorter',
                tr('job-wizard.shorter', 'Shorter'),
                <icons.remove key="i" aria-hidden />,
                Math.max(80, Math.round(current * 0.7)),
              ],
              [
                'rephrase',
                tr('job-wizard.rephrase', 'Rephrase'),
                <icons.refresh key="i" aria-hidden />,
                current,
              ],
            ] as const
          ).map(([change, label, icon, length]) => (
            <Button
              key={change}
              size="sm"
              variant="secondary"
              loading={drafting && doing === change}
              disabled={drafting || base === null}
              startIcon={icon}
              onClick={() => {
                setAsked(null);
                draft(change, length, '');
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      {/* How it is written: the length and the voice, then written again with them. */}
      <section aria-labelledby="how-written" className="flex flex-col gap-5">
        <h4 id="how-written" className="font-semibold">
          {tr('job-wizard.how_it_is_written', 'How it is written')}
        </h4>
        <Field>
          <FieldLabel>{tr('job-wizard.length', 'Length')}</FieldLabel>
          <ChipRow aria-label={tr('job-wizard.length', 'Length')}>
            {LENGTHS().map(([value, label]) => (
              <Chip
                key={value}
                selected={words === value}
                onClick={() => {
                  setWords(value);
                }}
              >
                {tr('job-wizard.about_words', '{{label}}, about {{value}} words', { label, value })}
              </Chip>
            ))}
          </ChipRow>
        </Field>
        <Field>
          <FieldLabel>{tr('job-wizard.tone', 'Tone')}</FieldLabel>
          <ChipRow aria-label={tr('job-wizard.tone', 'Tone')}>
            {TONES().map(([value, label]) => (
              <Chip
                key={value}
                selected={tone === value}
                onClick={() => {
                  setTone(value);
                }}
              >
                {label}
              </Chip>
            ))}
          </ChipRow>
        </Field>
        <div>
          <Button
            variant="secondary"
            loading={drafting && doing === 'draft' && asked === null}
            disabled={drafting}
            startIcon={<icons.assistant aria-hidden />}
            onClick={() => {
              setAsked(null);
              draft(null);
            }}
          >
            {ad === undefined && drawn === null
              ? tr('job-wizard.write_it', 'Write it')
              : tr('job-wizard.write_it_again_this_way', 'Write it again this way')}
          </Button>
        </div>
        <p className="text-sm text-fg-muted">
          {tr(
            'job-wizard.pay_hours_holiday_and_the_contract',
            'Pay, hours, holiday and the contract are never written into the text: the ad shows them from the job, exactly as set.',
          )}
        </p>
      </section>
    </div>
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
      aria-label={tr('job-wizard.job_title', 'Job title')}
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

/** A German job whose title has no neutral marker: said where the entity is chosen, with the fix. */
function NeutralTitle({ data, props }: TermsProps): JSX.Element | null {
  const act = useAct(props);
  const draft = useJobDraft(data);
  const title = draft.job.title;
  if (!germanJob(data) || neutralTitle(title)) return null;
  return (
    <Alert
      tone="warning"
      title={tr('job-wizard.a_german_ad_needs_a_neutral', 'A German ad needs a neutral title')}
      className="animate-arrive"
      action={
        <Button
          size="sm"
          variant="secondary"
          loading={act.pending}
          onClick={() => {
            const next = tr('job-wizard.m_w_d_2', '{{title}} (m/w/d)', { title: title.trim() });
            draft.set({ title: next });
            act.run('SaveJobDetails', {
              jobId: data.job.id,
              input: detailsOf(data.job, { title: next }),
            });
          }}
        >
          {tr('job-wizard.add_m_w_d', 'Add (m/w/d)')}
        </Button>
      }
    >
      {tr(
        'job-wizard.has_no_marker_such_as_m',
        '“{{title}}” has no marker such as (m/w/d), which the law (AGG § 11) asks of an ad in Germany.',
        { title },
      )}
    </Alert>
  );
}

const ROLE: Page = {
  key: 'role',
  get title(): string {
    return tr('job-wizard.what_is_the_job', 'What is the job?');
  },
  hint: () =>
    tr(
      'job-wizard.its_title_as_candidates_will_read',
      'Its title as candidates will read it, the team it sits in and how senior it is. The level shapes the description and the pay estimate.',
    ),
  blocks: [
    {
      key: 'title',
      get label(): string {
        return tr('job-wizard.title', 'Title');
      },
      ready: always,
      done: (d) =>
        d.job.title.trim() !== '' && (!onlyGerman(d.entities) || neutralTitle(d.job.title)),
      render: (p) => <TitleStep {...p} />,
    },
    {
      key: 'level',
      get label(): string {
        return tr('job-wizard.team_and_level', 'Team and level');
      },
      // Each part of the first page unfolds once the one before it is filled.
      ready: (d) => d.job.title.trim() !== '',
      done: (d) => d.job.department !== null && d.job.outline.seniority !== null,
      render: (p) => <RoleStep {...p} />,
    },
    {
      key: 'openings',
      get label(): string {
        return tr('job-wizard.openings_and_start', 'Openings and start');
      },
      hint: () =>
        tr(
          'job-wizard.the_start_date_is_a_target_for',
          'The start date is a target for the team, not a promise in the ad.',
        ),
      ready: (d) => d.job.department !== null && d.job.outline.seniority !== null,
      done: (d) => d.job.openings >= 1 && d.job.targetHireDate !== null,
      render: (p) => <OpeningsStep {...p} />,
    },
  ],
};

export const WIZARD_PAGES: readonly Page[] = [
  ROLE,
  {
    key: 'where',
    get title(): string {
      return tr('job-wizard.where_is_the_work', 'Where is the work?');
    },
    hint: () =>
      tr(
        'job-wizard.the_employing_entitys_country_sets_the_law',
        'The employing entity’s country sets the law for everything after this: the contracts on offer, the hours, the leave and the pay floor.',
      ),
    blocks: [
      {
        key: 'entity',
        get label(): string {
          return tr('job-wizard.employer', 'Employer');
        },
        ready: always,
        done: (d) => d.terms.entityId !== null && (!germanJob(d) || neutralTitle(d.job.title)),
        render: (p) => (
          <>
            <EntityChoice {...p} />
            <NeutralTitle {...p} />
          </>
        ),
      },
      {
        key: 'place',
        get label(): string {
          return tr('job-wizard.workplace', 'Workplace');
        },
        ready: (d) => d.terms.entityId !== null,
        done: (d) => d.terms.locationId !== null,
        render: (p) => <PlaceChoice {...p} />,
      },
      {
        key: 'mode',
        get label(): string {
          return tr('job-wizard.how_the_work_is_done', 'How the work is done');
        },
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
    get title(): string {
      return tr('job-wizard.what_kind_of_contract', 'What kind of contract?');
    },
    hint: (d) =>
      tr(
        'job-wizard.as_the_law_in_sees_it',
        'As the law in {{country}} sees it: first the kind of work, then only the contracts allowed for it. One that does not fit says why.',
        { country: countryName(d.options.country) },
      ),
    blocks: [
      {
        key: 'worktype',
        get label(): string {
          return tr('job-wizard.kind_of_work', 'Kind of work');
        },
        ready: (d) => d.options.relationships.length > 0,
        done: (d) => d.terms.relationship !== null,
        render: (p) => <WorkTypeChoice {...p} />,
      },
      {
        key: 'contract',
        get label(): string {
          return tr('job-wizard.contract', 'Contract');
        },
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
    get title(): string {
      return tr('job-wizard.when_do_they_work', 'When do they work?');
    },
    hint: () =>
      tr(
        'job-wizard.the_days_and_the_working_day',
        'The days and the working day, in the workplace’s own time, then the paid holiday. The week is checked against the legal limit, and the leave never falls below the minimum.',
      ),
    blocks: [
      {
        key: 'days',
        get label(): string {
          return tr('job-wizard.work_days', 'Work days');
        },
        ready: (d) => d.terms.contractType !== null,
        done: (d) => d.terms.workDays.length > 0,
        render: (p) => <DaysChoice {...p} />,
      },
      {
        key: 'hours',
        get label(): string {
          return tr('job-wizard.the_working_day', 'The working day');
        },
        ready: (d) => d.terms.workDays.length > 0,
        done: (d) => d.terms.dayStart !== null && d.terms.dayEnd !== null,
        render: (p) => <HoursChoice {...p} />,
      },
      {
        key: 'leave',
        get label(): string {
          return tr('job-wizard.paid_holiday', 'Paid holiday');
        },
        ready: (d) => d.options.leave !== null,
        done: (d) => d.terms.vacationDays !== null,
        render: (p) => <LeaveChoice {...p} />,
      },
    ],
  },
  {
    key: 'pay',
    get title(): string {
      return tr('job-wizard.what_does_it_pay_and_offer', 'What does it pay and offer?');
    },
    hint: () =>
      tr(
        'job-wizard.the_pay_arrives_filled_in',
        'The pay arrives filled in with what the market pays for this role there, as AI estimates it. Then choose the benefits, as many as suit.',
      ),
    blocks: [
      {
        key: 'salary',
        get label(): string {
          return tr('job-wizard.pay', 'Pay');
        },
        ready: (d) => d.terms.locationId !== null,
        done: (d) => d.job.salary !== null,
        render: (p) => <PayChoice {...p} />,
      },
      {
        key: 'benefits',
        get label(): string {
          return tr('job-wizard.benefits', 'Benefits');
        },
        ready: (d) => d.terms.entityId !== null,
        done: () => null,
        render: (p) => <BenefitsChoice {...p} />,
      },
    ],
  },
  {
    key: 'hiring',
    get title(): string {
      return tr('job-wizard.who_hires_and_for_what', 'Who hires, and for what?');
    },
    hint: () =>
      tr(
        'job-wizard.the_people_who_decide_and_what_a',
        'The people who decide, and what a candidate must bring. The match on each candidate is read against these criteria.',
      ),
    blocks: [
      {
        key: 'team',
        get label(): string {
          return tr('job-wizard.hiring_team', 'Hiring team');
        },
        ready: always,
        done: (d) => d.team.some((t) => t.role === 'hiring_manager'),
        render: (p, part) => (p.commit === undefined ? null : part('team', p.commit)),
      },
      {
        key: 'criteria',
        get label(): string {
          return tr('job-wizard.what_they_bring', 'What they bring');
        },
        ready: always,
        done: (d) => d.criteria.length > 0,
        render: (p, part) => (p.commit === undefined ? null : part('criteria', p.commit)),
      },
    ],
  },
  {
    key: 'process',
    get title(): string {
      return tr('job-wizard.how_do_candidates_move_through', 'How do candidates move through?');
    },
    hint: () =>
      tr(
        'job-wizard.choose_the_pipeline_then_give_each_step',
        'Choose the pipeline, then give each step that meets the candidate its interview: who runs it, how long, where, and how the time is set. A candidate reaching that step is asked for it at once.',
      ),
    blocks: [
      {
        key: 'interviews',
        get label(): string {
          return tr('job-wizard.pipeline_and_interviews', 'Pipeline and interviews');
        },
        ready: always,
        // Every interview step of the pipeline has its interview.
        done: (d) =>
          d.stages
            .filter((st) => st.category === 'interview')
            .every((st) => d.plan.some((p) => p.stageId === st.id)),
        render: (p, part) => (p.commit === undefined ? null : part('plan', p.commit)),
      },
    ],
  },
  {
    key: 'description',
    get title(): string {
      return tr('job-wizard.describe_the_role', 'Describe the role');
    },
    hint: () =>
      tr(
        'job-wizard.written_by_ai_from_everything_so_far',
        'Written by AI from everything so far. Edit anything; pay, contract and benefits show beside it from the job.',
      ),
    blocks: [
      {
        key: 'ad',
        get label(): string {
          return tr('job-wizard.role_description', 'Role description');
        },
        ready: always,
        done: (d) => d.ads.length > 0,
        render: (p) => <DescriptionStep {...p} />,
      },
    ],
  },
];

/** A page of the setup, or one part of one, by its key. */
export const isSetupPart = (key: string): boolean =>
  WIZARD_PAGES.some((p) => p.key === key || p.blocks.some((b) => b.key === key));

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
  pinned = true,
  children,
}: {
  readonly label: string;
  readonly hint: string | undefined;
  readonly order: number;
  /** Its name stays at the top while its answer scrolls: on the setup's page, not in a panel. */
  readonly pinned?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-label={label}
      className="flex animate-arrive flex-col gap-4"
      style={staggerStyle(order, 'animation')}
    >
      <header
        className={
          pinned
            ? 'z-10 -mx-2 flex flex-col gap-1 bg-canvas/90 px-2 py-2 backdrop-blur-md lg:sticky lg:top-0'
            : 'flex flex-col gap-1'
        }
      >
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
  parts,
  missing,
  answered,
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
  /** The checklist, when there is no job to judge it on yet (a new one). */
  readonly parts?: readonly {
    readonly key: string;
    readonly label: string;
    readonly done: boolean;
    readonly ready: boolean;
  }[];
  /** What on this page is still to answer: Continue waits for it, and says what it is. */
  readonly missing: readonly string[];
  /** Each part's answer as it stands on the screen, before it is kept. */
  readonly answered?: Readonly<Record<string, boolean>>;
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
          dismissLabel={tr(
            'job-wizard.close_everything_so_far_is_kept',
            'Close. Everything so far is kept.',
          )}
          title={title}
          meta={
            <div className="flex w-36 items-center gap-2 max-sm:hidden">
              <Progress value={percent} label={tr('job-wizard.set_up', 'Set up')} size="sm" />
              <span className="shrink-0 text-xs font-semibold text-fg-muted tabular-nums">{`${String(percent)}%`}</span>
            </div>
          }
          actions={
            <Button size="sm" variant="secondary" onClick={onClose}>
              {tr('job-wizard.save_and_close', 'Save and close')}
            </Button>
          }
        />
        {/* On a wide screen the question stays where it is and only the answers scroll;
            on a phone the page scrolls under a bar that keeps the question. */}
        <ModalPageBody>
          <div
            key={page.key}
            style={travel}
            className="mx-auto grid w-full max-w-6xl gap-x-20 gap-y-8 px-4 pb-16 sm:px-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:pb-24"
          >
            {/* One scroll for the page. The question stays where it is on the left while the
                answers pass on the right, each part's name pinned at the top as they go. */}
            <aside className="sticky top-0 z-20 -mx-4 bg-canvas/90 px-4 pt-6 pb-3 backdrop-blur-md sm:-mx-8 sm:px-8 lg:mx-0 lg:max-h-full lg:self-start lg:bg-transparent lg:px-0 lg:pt-16 lg:pb-0 lg:backdrop-blur-none">
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
                {page.blocks.length < 2 || (data === null && parts === undefined) ? null : (
                  <IconList
                    aria-label={tr('job-wizard.on_this_page', 'On this page')}
                    className="mt-2 animate-arrive max-lg:hidden"
                    style={staggerStyle(2, 'animation')}
                  >
                    {(
                      parts ??
                      page.blocks.map((b) => ({
                        key: b.key,
                        label: b.label,
                        done: data !== null && (answered?.[b.key] ?? b.done(data) === true),
                        ready: data !== null && b.ready(data),
                      }))
                    ).map((b) => {
                      const { done, ready } = b;
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
                            done
                              ? tr('job-wizard.answered', 'Answered')
                              : ready
                                ? tr('job-wizard.to_answer', 'To answer')
                                : tr('job-wizard.after_the_part_above', 'After the part above')
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
            <div className="flex min-w-0 flex-col gap-14 lg:pt-16">
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
            {tr('job-wizard.back', 'Back')}
          </Button>
          <span
            className="text-center text-sm text-fg-muted text-pretty tabular-nums"
            aria-live="polite"
          >
            {missing.length === 0
              ? tr('job-wizard.step_of', 'Step {{value}} of {{length}}', {
                  value: String(index + 1),
                  length: String(WIZARD_PAGES.length),
                })
              : tr('job-wizard.to_continue', 'To continue: {{join}}', {
                  join: missing.join(', ').toLowerCase(),
                })}
          </span>
          <Button
            loading={moving}
            disabled={missing.length > 0}
            endIcon={last ? <icons.visible aria-hidden /> : <icons.forward aria-hidden />}
            onClick={onNext}
          >
            {last
              ? tr('job-wizard.review_the_ad', 'Review the ad')
              : tr('job-wizard.continue', 'Continue')}
          </Button>
        </ModalPageFooter>
      </ModalPageContent>
    </ModalPage>
  );
}

type Call = (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;

const prefetched = new Set<string>();

/** The market pay, estimated once a job has a place and before its page is reached. */
function prefetchPay(call: Call, data: JobData, refresh: (() => void) | undefined): void {
  if (
    data.terms.payEstimate !== null ||
    data.job.salary !== null ||
    data.terms.locationId === null ||
    prefetched.has(`pay:${data.job.id}`)
  )
    return;
  prefetched.add(`pay:${data.job.id}`);
  void call('SuggestJobPay', { jobId: data.job.id, input: { kind: 'range' } }).then((done) => {
    if (done.ok) refresh?.();
  });
}

/** Drafts written ahead, by job: the description page takes its first from here. */
const drafts = new Map<string, Promise<Done>>();

const DEFAULT_WORDS = '500';

function prefetchDraft(call: Call, data: JobData): void {
  if (data.ads.length > 0 || drafts.has(data.job.id)) return;
  drafts.set(
    data.job.id,
    call('DraftAd', {
      jobId: data.job.id,
      input: {
        language: data.job.languages[0] ?? 'en',
        intake: '',
        words: Number(DEFAULT_WORDS),
        tone: 'professional',
        change: null,
      },
    }),
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
  data: served,
  props,
  stepKey,
  entered,
  onClose,
  onFinish,
  part,
  focus = null,
}: {
  readonly open: boolean;
  readonly data: JobData;
  readonly props: ScreenProps<JobData>;
  readonly stepKey: string | null;
  readonly entered: boolean;
  readonly onClose: () => void;
  readonly onFinish: () => void;
  readonly part: (part: BorrowedPart, commit: Commit) => ReactNode;
  /** One page or one part of it, edited on its own in a panel off the ad: pressed in the preview. */
  readonly focus?: string | null;
}): JSX.Element {
  const act = useAct(props);
  // Picks on their way to Recruiting, which every part reads: what they unlock shows at once.
  const [picks, setPicks] = useState<{ base: JobTerms; value: Partial<JobTerms> }>({
    base: served.terms,
    value: {},
  });
  if (picks.base !== served.terms)
    setPicks({ base: served.terms, value: stillPending(picks.value, served.terms) });
  const shared = useMemo<Picks>(
    () => ({
      picks: picks.value,
      add: (patch) => {
        setPicks((p) => ({ ...p, value: { ...p.value, ...patch } }));
      },
      drop: (keys) => {
        setPicks((p) => ({
          ...p,
          value: Object.fromEntries(Object.entries(p.value).filter(([k]) => !keys.includes(k))),
        }));
      },
    }),
    [picks.value],
  );
  const chosenEntity =
    picks.value.entityId === undefined ? served.terms.entityId : picks.value.entityId;
  const catalogue = useCatalogue(
    served.options.entities.find((e) => e.id === chosenEntity)?.country ?? null,
  );
  // The job as the setup shows it: the server's, the picks on top, choices from the country's catalogue.
  const data = useMemo(
    () => viewOf(served, picks.value, catalogue),
    [served, picks.value, catalogue],
  );
  // Ahead of being asked: every country's terms as the setup opens.
  const call = useRef(act.call);
  call.current = act.call;
  useEffect(() => {
    prefetchCatalogues((name, variables) => call.current(name, variables), served);
  }, [served]);
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
  const index = focus === null ? step.index : pageIndex(focus);
  const page = WIZARD_PAGES[index] ?? ROLE;
  // A part pressed in the preview is asked alone; a page pressed, every part on it.
  const blocks =
    focus === null || page.key === focus ? page.blocks : page.blocks.filter((b) => b.key === focus);
  const alone = focus !== null && blocks.length === 1 ? blocks[0] : undefined;
  // On the page before theirs, the pay estimate and the description are asked for, so each
  // is already there when its page opens.
  const next = WIZARD_PAGES[index + 1]?.key;
  useEffect(() => {
    if (next === 'pay') prefetchPay((n, v) => call.current(n, v), served, props.onRefresh);
    if (next === 'description') prefetchDraft((n, v) => call.current(n, v), served);
  }, [next, served, props.onRefresh]);
  // The title as it is typed, shown in the bar word by word.
  // The first page's answers as typed and picked: the bar, the checklist and the parts read them.
  const [draft, setDraft] = useState<{ base: JobRecord; value: JobDraft }>({
    base: served.job,
    value: {},
  });
  if (draft.base !== served.job)
    setDraft({ base: served.job, value: stillDrafted(draft.value, served.job) });
  const drafted = useMemo(() => withDraft(data.job, draft.value), [data.job, draft.value]);
  const jobDraft = useMemo(
    () => ({
      job: drafted,
      set: (patch: JobDraft) => {
        setDraft((d) => ({ ...d, value: { ...d.value, ...patch } }));
      },
    }),
    [drafted],
  );
  // What the checklist, the progress and each part's turn are judged on.
  const gate = useMemo(() => ({ ...data, job: drafted }), [data, drafted]);
  // What each part on the page holds, answered or not, before it is kept.
  const [answered, setAnswered] = useState<Readonly<Record<string, boolean>>>({});
  const report = useCallback((key: string, value: boolean) => {
    setAnswered((a) => (a[key] === value ? a : { ...a, [key]: value }));
  }, []);
  const title = { value: drafted.title };
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
  // Continue waits for every part the page asks for; a part with nothing it must have never holds it.
  const missing = page.blocks
    .filter((b) => {
      const done = b.done(gate);
      return done !== null && !(answered[b.key] ?? done);
    })
    .map((b) => b.label);
  const body = (
    <SaveQueue value={track}>
      <Answers value={report}>
        <TermsPicks value={shared}>
          {blocks.some((b) => b.ready(gate)) ? null : (
            <Alert
              tone="info"
              title={tr(
                'job-wizard.this_page_follows_from_the_one',
                'This page follows from the one before',
              )}
              className="animate-arrive"
              style={staggerStyle(2, 'animation')}
            >
              {tr(
                'job-wizard.answer_the_earlier_pages_first_the',
                'Answer the earlier pages first; the questions here depend on them.',
              )}
            </Alert>
          )}
          {blocks.map((b, i) => {
            const ready = b.ready(gate);
            return (
              <PartKey key={b.key} value={b.key}>
                <Reveal open={ready} unmountOnExit from="bottom">
                  {!ready ? null : alone === undefined ? (
                    <BlockView
                      label={b.label}
                      hint={b.hint?.(data)}
                      order={i + 2}
                      pinned={focus === null}
                    >
                      {b.render({ data, props, commit }, part)}
                    </BlockView>
                  ) : (
                    b.render({ data, props, commit }, part)
                  )}
                </Reveal>
              </PartKey>
            );
          })}
        </TermsPicks>
      </Answers>
    </SaveQueue>
  );
  if (focus !== null) {
    // Done keeps what was typed; the panel stays open on a refusal, which the part shows.
    const done = (): void => {
      void settle().then((ok) => {
        if (ok) onClose();
      });
    };
    return (
      <JobDraftContext value={jobDraft}>
        <Sheet
          open={open}
          onOpenChange={(o) => {
            if (!o) done();
          }}
        >
          <SheetContent size="xl">
            <SheetHeader>
              <SheetTitle>{alone?.label ?? page.title}</SheetTitle>
              <SheetDescription>{alone?.hint?.(data) ?? page.hint(data)}</SheetDescription>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-10">{body}</SheetBody>
            <SheetFooter>
              <Button loading={moving} onClick={done}>
                {tr('job-wizard.done', 'Done')}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </JobDraftContext>
    );
  }
  return (
    <JobDraftContext value={jobDraft}>
      <WizardFrame
        open={open}
        label={
          title.value.trim() === ''
            ? tr('job-wizard.set_up_a_job', 'Set up a job')
            : tr('job-wizard.set_up_2', 'Set up {{value}}', { value: title.value })
        }
        title={
          // On the page that asks for the title the bar shows it as it is typed: one place to type it.
          page.key === ROLE.key ? (
            <span className="truncate text-md font-semibold text-fg">
              {title.value.trim() === '' ? tr('job-wizard.new_job', 'New job') : title.value}
            </span>
          ) : (
            <TitleField key={data.job.title} data={data} props={props} />
          )
        }
        percent={percentOf(gate, index)}
        index={index}
        page={page}
        data={gate}
        missing={missing}
        answered={answered}
        direction={step.direction}
        moving={moving}
        last={last}
        entered={entered}
        notice={
          failed === null ? null : (
            <Alert
              tone="danger"
              title={tr(
                'job-wizard.something_on_did_not_save',
                'Something on “{{value}}” did not save',
                { value: WIZARD_PAGES[failed]?.title ?? '' },
              )}
              className="animate-arrive"
            >
              <span className="flex flex-wrap items-center gap-3">
                {tr(
                  'job-wizard.go_back_to_it_to_see',
                  'Go back to it to see what Recruiting said.',
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    go(failed);
                  }}
                >
                  {tr('job-wizard.go_back', 'Go back')}
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
        {body}
      </WizardFrame>
    </JobDraftContext>
  );
}

/**
 * A new job, on the same first page as any job's setup: the title, then the
 * team and level, then the openings, each unfolding once the one before is
 * filled. The job is made as soon as a title has been typed, in the
 * background, and every answer after it is kept as it is given, so Continue
 * has nothing left to save and opens the next page at once. Every entity's
 * country's terms are fetched meanwhile, for the page after.
 */
export function NewJobWizard({
  part,
  ...props
}: ScreenProps<JobData> & {
  /** The parts the setup borrows from the ad's panels, for the job once it is made. */
  readonly part: (
    part: BorrowedPart,
    commit: Commit,
    data: JobData,
    props: ScreenProps<JobData>,
  ) => ReactNode;
}): JSX.Element {
  const act = useAct(props);
  const loaded =
    props.load.status === 'ready'
      ? (props.load.data as unknown as {
          orgUnits?: JobData['orgUnits'];
          entities?: readonly { country: string }[];
        })
      : null;
  const orgUnits = loaded?.orgUnits ?? [];
  const call = useRef(act.call);
  call.current = act.call;
  useEffect(() => {
    for (const country of new Set((loaded?.entities ?? []).map((e) => e.country)))
      prefetchCatalogue((n, v) => call.current(n, v), country);
  }, [loaded]);
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [openings, setOpenings] = useState<number | null>(1);
  const [start, setStart] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requisition = props.search?.['requisition'] ?? null;
  // The answers now, for whatever is kept next.
  const now = useRef({ title, team, level, openings, start });
  now.current = { title, team, level, openings, start };
  const [id] = useState(newId);
  const made = useRef<JobRecord | null>(null);
  // The job's own screen, read as soon as it is made, so the next page opens here at once
  // rather than after a trip to the server for a page of its own.
  const screen = useRef<Promise<Done> | null>(null);
  const [opened, setOpened] = useState<JobData | null>(null);
  const reads = useRef(0);
  const reread = useCallback(() => {
    const n = ++reads.current;
    void call.current('RecruitingJob', { jobId: id }).then((done) => {
      if (done.ok && n === reads.current) setOpened(done.data as JobData);
    });
  }, [id]);
  const here = useMemo(() => ({ ...props, onRefresh: reread }), [props, reread]);
  const creating = useRef<Promise<JobRecord | null> | null>(null);
  const saving = useRef(new Set<Promise<unknown>>());
  const track = (p: Promise<unknown>): void => {
    saving.current.add(p);
    void p.finally(() => saving.current.delete(p));
  };
  /** The job as answered so far, kept: one save of whatever differs from what Recruiting holds. */
  const keep = (): void => {
    const job = made.current;
    if (job === null) return;
    const v = now.current;
    const change: Partial<JobRecord> = {
      title: v.title.trim() === '' ? job.title : v.title.trim(),
      internalTitle: v.title.trim() === '' ? job.internalTitle : v.title.trim(),
      department: v.team,
      openings: v.openings ?? 1,
      targetHireDate: v.start,
      outline: { ...job.outline, seniority: v.level },
    };
    const next = { ...job, ...change };
    if (JSON.stringify(detailsOf(job, {})) === JSON.stringify(detailsOf(next, {}))) return;
    made.current = next;
    track(act.call('SaveJobDetails', { jobId: id, input: detailsOf(job, change) }));
  };
  const ensure = (): Promise<JobRecord | null> => {
    if (creating.current !== null) return creating.current;
    const v = now.current;
    creating.current = act
      .call('CreateJob', {
        input: {
          id,
          title: v.title.trim(),
          internalTitle: v.title.trim(),
          requisitionIds: requisition === null ? [] : [requisition],
          entityId: null,
          locationIds: [],
          department: v.team,
          // A placeholder: with `setup`, the work mode is left unanswered for its own page.
          workMode: 'onsite',
          openings: v.openings ?? 1,
          languages: ['en'],
          hiringManagerId: null,
          seniority: v.level,
          targetHireDate: v.start,
          setup: { step: 'role' },
        },
      })
      .then((done) => {
        if (!done.ok) {
          setError(done.message);
          creating.current = null;
          return null;
        }
        made.current = done.data as JobRecord;
        screen.current = act.call('RecruitingJob', { jobId: id });
        // Anything answered while it was being made.
        keep();
        return made.current;
      });
    track(creating.current);
    return creating.current;
  };
  // Made once a title has rested a moment; then each answer is kept as it is given.
  useEffect(() => {
    if (title.trim() === '') return;
    const wait = setTimeout(() => {
      if (creating.current === null) void ensure();
      else keep();
    }, 600);
    return () => {
      clearTimeout(wait);
    };
    // `ensure` and `keep` read the answers through `now`.
  }, [title, team, level, openings, start]);
  const next = async (): Promise<void> => {
    if (title.trim() === '') {
      setError(tr('job-wizard.a_job_needs_a_title', 'A job needs a title'));
      return;
    }
    // Enter in the title moves on only when the page is answered, as Continue does.
    if (!(named && placed && start !== null)) return;
    setMoving(true);
    setError(null);
    const job = await ensure();
    if (job === null) {
      setMoving(false);
      return;
    }
    keep();
    await Promise.all(saving.current);
    const read = await screen.current;
    const at = `/recruiting/jobs/${id}/setup?setup=1&step=where&entered=1`;
    if (read?.ok !== true || made.current === null) {
      props.onNavigate?.(at);
      return;
    }
    // The job read when it was made, with this page's answers as last kept.
    setOpened({ ...(read.data as JobData), job: made.current });
    window.history.replaceState(window.history.state, '', at);
  };
  if (opened !== null) {
    // Leaving the setup, or finishing it, lands on the ad, which is now the job's own page.
    const ad = (): void => props.onNavigate?.(`/recruiting/jobs/${id}/setup`);
    return (
      <JobWizard
        open
        data={opened}
        props={here}
        stepKey="where"
        entered
        onClose={ad}
        onFinish={ad}
        part={(p, commit) => part(p, commit, opened, here)}
      />
    );
  }
  const named = title.trim() !== '' && (!onlyGerman(loaded?.entities ?? []) || neutralTitle(title));
  const placed = team !== null && level !== null;
  const parts = [
    { key: 'title', label: tr('job-wizard.title', 'Title'), done: named, ready: true },
    {
      key: 'level',
      label: tr('job-wizard.team_and_level', 'Team and level'),
      done: placed,
      ready: named,
    },
    {
      key: 'openings',
      label: tr('job-wizard.openings_and_start', 'Openings and start'),
      done: start !== null,
      ready: placed,
    },
  ];
  const total = WIZARD_PAGES.reduce((n, p) => n + p.blocks.length, 0);
  return (
    <WizardFrame
      open
      label={
        named
          ? tr('job-wizard.set_up_3', 'Set up {{title}}', { title: title.trim() })
          : tr('job-wizard.new_job', 'New job')
      }
      title={
        <span className="truncate text-md font-semibold text-fg">
          {named ? title : tr('job-wizard.new_job', 'New job')}
        </span>
      }
      percent={Math.round((parts.filter((p) => p.done).length / total) * 100)}
      index={0}
      page={ROLE}
      data={null}
      parts={parts}
      missing={parts.filter((p) => !p.done).map((p) => p.label)}
      direction={1}
      moving={moving}
      last={false}
      entered={false}
      onClose={() => {
        // Closing keeps what was answered: the job stays as a draft once it has a title.
        if (named && made.current !== null) keep();
        props.onNavigate?.('/recruiting/jobs');
      }}
      onBack={null}
      onNext={() => {
        void next();
      }}
    >
      <Refusal error={error} />
      <BlockView label={tr('job-wizard.title', 'Title')} hint={undefined} order={2}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void next();
          }}
        >
          <TitleInput
            value={title}
            german={(loaded?.entities ?? []).some((e) => e.country === 'DE')}
            onChange={setTitle}
          />
        </form>
      </BlockView>
      <Reveal open={named} unmountOnExit from="bottom">
        {named ? (
          <BlockView
            label={tr('job-wizard.team_and_level', 'Team and level')}
            hint={undefined}
            order={0}
          >
            <Field required>
              <FieldLabel>{tr('job-wizard.team', 'Team')}</FieldLabel>
              <FieldControl>
                <Combobox
                  label={tr('job-wizard.team', 'Team')}
                  placeholder={tr('job-wizard.choose_a_team', 'Choose a team')}
                  searchPlaceholder={tr('job-wizard.search_teams', 'Search teams')}
                  options={orgUnits.map((u) => ({ value: u.name, label: u.name }))}
                  value={team}
                  emptyMessage={tr(
                    'job-wizard.no_team_by_that_name_add',
                    'No team by that name. Add teams under Settings.',
                  )}
                  onChange={(v) => {
                    setTeam(typeof v === 'string' ? v : null);
                  }}
                />
              </FieldControl>
            </Field>
            <Field required>
              <FieldLabel>{tr('job-wizard.level', 'Level')}</FieldLabel>
              <RadioGroup
                aria-label={tr('job-wizard.level', 'Level')}
                className="grid gap-2 sm:grid-cols-2"
                value={level ?? ''}
                onValueChange={setLevel}
              >
                {SENIORITY().map(([key, label, description, icon]) => (
                  <RadioCard key={key} value={key} description={description} icon={icon}>
                    {label}
                  </RadioCard>
                ))}
              </RadioGroup>
            </Field>
          </BlockView>
        ) : null}
      </Reveal>
      <Reveal open={placed} unmountOnExit from="bottom">
        {placed ? (
          <BlockView
            label={tr('job-wizard.openings_and_start', 'Openings and start')}
            hint={tr(
              'job-wizard.the_start_date_is_a_target',
              'The start date is a target for the team, not a promise in the ad.',
            )}
            order={0}
          >
            <OpeningsFields
              openings={openings}
              start={start}
              onOpenings={setOpenings}
              onStart={setStart}
            />
          </BlockView>
        ) : null}
      </Reveal>
    </WizardFrame>
  );
}
