import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChatComposer,
  ChatLog,
  ChatMessage,
  Checkbox,
  CurrencyField,
  DatePicker,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  FileUploader,
  Input,
  KeyValues,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageHeader,
  NumberField,
  PageHeader,
  PdfPages,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagsInput,
  Textarea,
  icons,
  type UploadItem,
} from '@reach/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';
import { formatList } from '@reach/ui/intl';

import { BenefitPicker } from './benefits';
import { AgreementFields } from './job-terms';
import { Loaded } from './load';
import { MoreMenu, Refusal, StateBadge, To, day, money, range, useAct, words } from './shared';
import type {
  CatalogueBenefit,
  Done,
  OfferData,
  OfferStartData,
  OffersData,
  OfferVersion,
  ScreenProps,
  TermLength,
  TermsAnswers,
  TermsIssue,
} from './types';
import { t as tr } from './i18n';

/**
 * R19–R22: offers, the editor with its checks and the terms composer, the
 * approver's view, and the contract with its pre-start conditions. Every
 * check, total and rule is Recruiting's; the screen only asks and shows.
 */

const CURRENCIES = ['EUR', 'GBP', 'USD', 'INR'] as const;

export function Offers(props: ScreenProps<OffersData>): JSX.Element {
  return (
    <Loaded load={props.load} what="offers">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('offers.offers', 'Offers')}
            description={tr(
              'offers.drafts_those_waiting_on_an_approver',
              'Drafts, those waiting on an approver, those sent and those accepted.',
            )}
          />
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.agreement aria-hidden />}
                  title={tr('offers.no_offers_yet', 'No offers yet')}
                  description={tr(
                    'offers.an_offer_starts_from_a_candidates',
                    'An offer starts from a candidate’s application.',
                  )}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr('offers.candidate', 'Candidate')}</TableHead>
                      <TableHead>{tr('offers.job', 'Job')}</TableHead>
                      <TableHead>{tr('offers.base', 'Base')}</TableHead>
                      <TableHead>{tr('offers.start', 'Start')}</TableHead>
                      <TableHead>{tr('offers.expires', 'Expires')}</TableHead>
                      <TableHead>{tr('offers.state', 'State')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow
                        key={r.id}
                        // The whole row opens the offer over the list; an approver's opens their decision.
                        className="cursor-pointer"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('a') !== null) return;
                          if (r.needsMe) props.onNavigate?.(`/recruiting/offers/${r.id}/approve`);
                          else props.onFilter?.({ offer: r.id });
                        }}
                      >
                        <TableCell>
                          <To
                            href={
                              r.needsMe
                                ? `/recruiting/offers/${r.id}/approve`
                                : `/recruiting/offers?offer=${r.id}`
                            }
                            onNavigate={(to) => {
                              if (r.needsMe) props.onNavigate?.(to);
                              else props.onFilter?.({ offer: r.id });
                            }}
                          >
                            {r.candidate}
                          </To>
                        </TableCell>
                        <TableCell>{r.job}</TableCell>
                        <TableCell>{money(r.baseMinor, r.currency)}</TableCell>
                        <TableCell>{day(r.startDate)}</TableCell>
                        <TableCell>{day(r.expiresOn)}</TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            <StateBadge state={r.state} />
                            {r.needsMe ? (
                              <Badge size="sm" tone="warning">
                                {tr('offers.needs_you', 'Needs you')}
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <OfferModal
            offer={data.openOffer}
            props={props}
            onClose={() => props.onFilter?.({ offer: null })}
          />
        </div>
      )}
    </Loaded>
  );
}

/** The yearly base the terms carry, from the pay as entered. */
const yearly = (baseMinor: number, frequency: string, weeklyMinutes: number): number =>
  frequency === 'year'
    ? baseMinor
    : frequency === 'month'
      ? baseMinor * 12
      : Math.ceil((baseMinor * weeklyMinutes * 52) / 60);

/** A calendar date moved by the days between two others. */
const shifted = (date: string, from: string, to: string): string =>
  new Date(Date.parse(date) + (Date.parse(to) - Date.parse(from))).toISOString().slice(0, 10);

function NewOffer(props: ScreenProps<OfferData>): JSX.Element {
  const application = props.search?.['application'] ?? '';
  if (application === '')
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={tr('offers.new_offer', 'New offer')} />
        <Alert
          tone="warning"
          title={tr('offers.start_from_an_application', 'Start from an application')}
        >
          {tr(
            'offers.open_the_candidate_and_make_the',
            'Open the candidate and make the offer from their application.',
          )}
        </Alert>
      </div>
    );
  return (
    <Loaded
      load={props.load as unknown as ScreenProps<OfferStartData>['load']}
      what={tr('offers.the_offer', 'the offer')}
    >
      {(data) => <NewOfferBody data={data} application={application} props={props} />}
    </Loaded>
  );
}

/**
 * R19's way in, when the offer stage did not open one already: the draft is
 * made at once from what the job says, and the offer opens filled in. There
 * is no form before the offer; the offer is the form.
 */
function NewOfferBody({
  data,
  application,
  props,
}: {
  readonly data: OfferStartData;
  readonly application: string;
  readonly props: ScreenProps<OfferData>;
}): JSX.Element {
  const act = useAct(props);
  const started = useRef(false);
  const { onNavigate } = props;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Making it twice edits the same draft, so a second mount is harmless.
    act.run('ComposeOffer', { applicationId: application, input: data.input }, (offer) => {
      onNavigate?.(`/recruiting/offers/${(offer as { id: string }).id}`);
      return 'left';
    });
  }, [act, application, data.input, onNavigate]);
  return act.error === null ? (
    <Spinner
      label={tr('offers.preparing_the_offer', 'Preparing the offer for {{name}}', {
        name: data.candidate.name,
      })}
    />
  ) : (
    <Refusal error={act.error} />
  );
}

function Checks({ data }: { readonly data: OfferData }): JSX.Element {
  const c = data.checked;
  const r = c?.rewards;
  const currency = data.offer.versions.at(-1)?.pay.currency ?? 'EUR';
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('offers.checks', 'Checks')}</CardTitle>
          <CardDescription>
            {tr(
              'offers.run_on_every_change_again_before',
              'Run on every change, again before approval and before sending',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {c === null ? (
            <Alert
              tone="warning"
              title={tr(
                'offers.choose_the_jobs_legal_entity_first',
                'Choose the job’s legal entity first',
              )}
            >
              {tr('offers.checks_need_the_country', 'Checks need the country.')}
            </Alert>
          ) : null}
          {c !== null && c.terms !== null && c.checks.length === 0 && c.termsIssues.length === 0 ? (
            <Alert tone="success" title={tr('offers.every_check_passes', 'Every check passes')}>
              {tr(
                'offers.terms_pay_band_pay_equity_and',
                'Terms, pay band, pay equity and budget.',
              )}
            </Alert>
          ) : null}
          {c?.termsIssues.map((i) => (
            <Alert
              key={`${i.step}:${i.code}`}
              tone={i.severity === 'error' ? 'danger' : 'warning'}
              title={words(i.step)}
            >
              {tr('offers.text', '{{message}} ({{source}})', {
                message: i.message,
                source: i.source,
              })}
            </Alert>
          ))}
          {c?.checks.map((k) => (
            <Alert
              key={k.code}
              tone={k.severity === 'error' ? 'danger' : 'warning'}
              title={
                k.severity === 'error'
                  ? tr('offers.blocks_the_offer', 'Blocks the offer')
                  : tr('offers.adds_an_approval_step', 'Adds an approval step')
              }
            >
              {k.message}
            </Alert>
          ))}
          {c !== null && !c.packReviewed ? (
            <p className="text-xs text-fg-muted">
              {tr(
                'offers.this_country_pack_is_awaiting_a',
                'This country pack is awaiting a country reviewer.',
              )}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {r === undefined ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('offers.total_rewards', 'Total rewards')}</CardTitle>
            <CardDescription>
              {tr('offers.added_up_by_kithena', 'Added up by Kithena')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValues
              items={[
                { label: tr('offers.base', 'Base'), value: money(r.baseMinor, currency) },
                {
                  label: tr('offers.variable_at_target', 'Variable at target'),
                  value: money(r.variableMinor, currency),
                },
                {
                  label: tr('offers.benefits_with_a_value', 'Benefits with a value'),
                  value: money(r.benefitsMinor, currency),
                },
                { label: tr('offers.total', 'Total'), value: money(r.totalMinor, currency) },
                ...(r.descriptive.length === 0 && r.equityUnits === null
                  ? []
                  : [
                      {
                        label: tr('offers.also', 'Also'),
                        value: [
                          ...(r.equityUnits === null
                            ? []
                            : [`${String(r.equityUnits)} units of equity`]),
                          ...r.descriptive,
                        ].join(' · '),
                      },
                    ]),
              ]}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const STEP_LABEL: Readonly<Record<string, string>> = {
  get entity(): string {
    return tr('offers.legal_entity', 'Legal entity');
  },
  get location(): string {
    return tr('offers.work_location', 'Work location');
  },
  get relationship(): string {
    return tr('offers.relationship', 'Relationship');
  },
  get contract_type(): string {
    return tr('offers.contract_type', 'Contract type');
  },
  get fixed_term_reason(): string {
    return tr('offers.fixed_term_reason', 'Fixed-term reason');
  },
  get duration(): string {
    return tr('offers.duration', 'Duration');
  },
  get hours(): string {
    return tr('offers.hours', 'Hours');
  },
  get probation(): string {
    return tr('offers.probation', 'Probation');
  },
  get notice(): string {
    return tr('offers.notice', 'Notice');
  },
  get work_mode(): string {
    return tr('offers.work_mode', 'Work mode');
  },
  get agreement(): string {
    return tr('offers.collective_agreement', 'Collective agreement');
  },
  get pay(): string {
    return tr('offers.pay', 'Pay');
  },
  get benefits(): string {
    return tr('offers.benefits', 'Benefits');
  },
  get clauses(): string {
    return tr('offers.clauses', 'Clauses');
  },
  get summary(): string {
    return tr('offers.summary', 'Summary');
  },
};

const UNIT: Readonly<Record<TermLength['unit'], () => string>> = {
  days: () => tr('offers.unit_days', 'days'),
  weeks: () => tr('offers.unit_weeks', 'weeks'),
  months: () => tr('offers.unit_months', 'months'),
};

/** A length, in the unit the country's law gives it in, shown inside the field. */
function Length({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: TermLength | null | undefined;
  readonly onChange: (v: TermLength) => void;
}): JSX.Element {
  const v = value ?? { count: 0, unit: 'months' as const };
  return (
    <NumberField
      label={label}
      value={v.count}
      min={0}
      suffix={UNIT[v.unit]()}
      onChange={(n) => {
        onChange({ ...v, count: n ?? 0 });
      }}
    />
  );
}

/** An amount of money: typed in major units, kept in minor ones, the currency inside the field. */
function MoneyField({
  label,
  currency,
  minor,
  onChange,
}: {
  readonly label: string;
  readonly currency: string;
  readonly minor: number;
  readonly onChange: (minor: number) => void;
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <CurrencyField
          currency={currency}
          value={String(minor)}
          onValueChange={(next) => {
            onChange(Number(next) || 0);
          }}
        />
      </FieldControl>
    </Field>
  );
}

function Pick({
  label,
  value,
  choices,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null | undefined;
  readonly choices: readonly {
    readonly key: string;
    readonly label: string;
    readonly unavailable?: string;
  }[];
  readonly onChange: (v: string) => void;
}): JSX.Element {
  const chosen = choices.find((c) => c.key === value);
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value ?? ''} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue placeholder={tr('offers.choose', 'Choose…')} />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.key} value={c.key} disabled={c.unavailable !== undefined}>
              {c.unavailable === undefined
                ? c.label
                : tr('offers.text_2', '{{label}} — {{unavailable}}', {
                    label: c.label,
                    unavailable: c.unavailable,
                  })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chosen?.unavailable === undefined ? null : (
        <FieldDescription>{chosen.unavailable}</FieldDescription>
      )}
    </Field>
  );
}

/** The offer as it is edited: the version, and the grade and reason kept beside it. */
interface Draft {
  readonly terms: TermsAnswers;
  readonly pay: OfferVersion['pay'];
  readonly benefitIds: readonly string[];
  readonly extraBenefits: readonly string[];
  readonly startDate: string;
  readonly expiresOn: string;
  readonly letterTemplateId: string | null;
  readonly grade: string | null;
  readonly outsideBandReason: string | null;
}

const draftOf = (v: OfferVersion, meta: OfferData['meta']): Draft => ({
  terms: v.terms,
  pay: v.pay,
  benefitIds: v.benefitIds,
  extraBenefits: v.extraBenefits ?? [],
  startDate: v.startDate,
  expiresOn: v.expiresOn,
  letterTemplateId: v.letterTemplateId,
  grade: meta.grade,
  outsideBandReason: meta.outsideBandReason,
});

/** The pay changed: the yearly figure the terms are checked against follows it. */
const withPay = (d: Draft, pay: Draft['pay'], weeklyMinutes = d.terms.weeklyMinutes): Draft => ({
  ...d,
  pay,
  terms: {
    ...d.terms,
    weeklyMinutes,
    ...(d.terms.annualPayMinor === undefined
      ? {}
      : { annualPayMinor: yearly(pay.baseMinor, pay.frequency, weeklyMinutes ?? 0) }),
  },
});

/** The start moved: a fixed term's end moves with it, so its length stays what it was. */
const withStart = (d: Draft, start: string): Draft => ({
  ...d,
  startDate: start,
  terms:
    d.terms.contractEnd == null || d.startDate === ''
      ? d.terms
      : { ...d.terms, contractEnd: shifted(d.terms.contractEnd, d.startDate, start) },
});

type Saving = 'saved' | 'waiting' | 'saving' | 'failed';

/**
 * Every change saves itself: a press at once, typing once it pauses. Saves
 * go one after another, so the last word wins; one still waiting when the
 * page closes is sent then. `flush` sends what is waiting and resolves once
 * it is in, for an action that must act on the saved offer.
 */
function useAutosave<T>(
  save: (value: T) => Promise<Done>,
  onSaved: () => void,
): {
  readonly state: Saving;
  readonly error: string | null;
  readonly schedule: (value: T, wait: number) => void;
  readonly flush: () => Promise<void>;
} {
  const [state, setState] = useState<Saving>('saved');
  const [error, setError] = useState<string | null>(null);
  const waiting = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const calls = useRef({ save, onSaved });
  useEffect(() => {
    calls.current = { save, onSaved };
  });
  const flush = useCallback((): Promise<void> => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const next = waiting.current;
    waiting.current = null;
    if (next !== null)
      chain.current = chain.current.then(async () => {
        setState('saving');
        const done = await calls.current.save(next.value);
        if (!done.ok) {
          setError(done.message);
          setState('failed');
          return;
        }
        setError(null);
        setState(waiting.current === null ? 'saved' : 'waiting');
        calls.current.onSaved();
      });
    return chain.current;
  }, []);
  const schedule = useCallback(
    (value: T, wait: number) => {
      waiting.current = { value };
      setState('waiting');
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), wait);
    },
    [flush],
  );
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );
  return { state, error, schedule, flush };
}

/** Where the saving is, said quietly beside the title. */
function SaveNote({ state }: { readonly state: Saving }): JSX.Element {
  return (
    <span aria-live="polite" className="flex items-center gap-1.5 text-sm text-fg-muted">
      {state === 'saved' ? (
        <>
          <icons.success aria-hidden className="size-4 text-success-fg" />
          {tr('offers.saved', 'Saved')}
        </>
      ) : state === 'failed' ? (
        <>
          <icons.warning aria-hidden className="size-4 text-danger-fg" />
          {tr('offers.not_saved', 'Not saved')}
        </>
      ) : (
        <>
          <Spinner size="xs" />
          {tr('offers.saving', 'Saving…')}
        </>
      )}
    </span>
  );
}

/** One group of the offer: a title, a line on what it is, and its fields on a grid. */
function Group({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{title}</CardTitle>
        {description === undefined ? null : <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

/** A step's findings, under the fields they are about. */
function Issues({ issues }: { readonly issues: readonly TermsIssue[] }): JSX.Element | null {
  if (issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {issues.map((i) => (
        <Alert
          key={`${i.step}:${i.code}`}
          tone={i.severity === 'error' ? 'danger' : 'warning'}
          title={
            i.severity === 'error'
              ? tr('offers.not_lawful', 'Not lawful')
              : tr('offers.read_and_confirm', 'Read and confirm')
          }
        >
          {tr('offers.text', '{{message}} ({{source}})', { message: i.message, source: i.source })}
        </Alert>
      ))}
    </div>
  );
}

/** R19, R21: the offer on one page, filled from the job, every change saved as it is made. */
export function Offer(props: ScreenProps<OfferData>): JSX.Element {
  if (props.params?.['id'] === 'new') return <NewOffer {...props} />;
  return (
    <Loaded load={props.load} what={tr('offers.the_offer', 'the offer')}>
      {(data) => <OfferEditor key={data.offer.id} data={data} props={props} />}
    </Loaded>
  );
}

/**
 * The offer over the page it was opened from: the offers list, the board or a
 * candidate. Its address is the page's with `?offer=`; closing it goes back.
 */
export function OfferModal({
  offer,
  props,
  onClose,
}: {
  readonly offer: OfferData | null | undefined;
  readonly props: Pick<ScreenProps<unknown>, 'onAct' | 'onRefresh' | 'onNavigate'>;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <ModalPage
      open={offer != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {offer == null ? null : (
        <ModalPageContent size="column">
          <OfferEditor
            key={offer.offer.id}
            data={offer}
            props={props as ScreenProps<OfferData>}
            onClose={onClose}
          />
        </ModalPageContent>
      )}
    </ModalPage>
  );
}

function OfferEditor({
  data,
  props,
  onClose,
}: {
  readonly data: OfferData;
  readonly props: ScreenProps<OfferData>;
  /** Drawn in a modal over the page it was opened from, which this closes back to. */
  readonly onClose?: () => void;
}): JSX.Element {
  const act = useAct(props);
  const v = data.offer.versions.at(-1);
  const [draft, setDraft] = useState<Draft | null>(v === undefined ? null : draftOf(v, data.meta));
  const { onRefresh } = props;
  const applicationId = data.offer.applicationId;
  const autosave = useAutosave<Draft>(
    (d) => act.call('ComposeOffer', { applicationId, input: d }),
    () => onRefresh?.(),
  );
  if (v === undefined || draft === null)
    return (
      <EmptyState
        icon={<icons.agreement aria-hidden />}
        title={tr('offers.no_version_yet', 'This offer has no version yet')}
      />
    );

  const s = data.offer.state;
  const name = data.candidate.name;
  // A sent or approved offer is changed by revising it: the next save is a new version.
  const editable = s === 'draft' || s === 'declined' || s === 'approved' || s === 'sent';
  const c = data.composer;
  const step = (key: string) => c?.steps.find((x) => x.step === key);
  // The pack lists every step it asks; one it leaves out, or skips, is not asked here either.
  const shown = (key: string): boolean => {
    const at = step(key);
    return c === null || (at !== undefined && at.state !== 'skipped');
  };
  const issues = (...keys: string[]): readonly TermsIssue[] =>
    keys.flatMap((k) => step(k)?.issues ?? []);
  const change = (next: Draft, typing = false): void => {
    setDraft(next);
    autosave.schedule(next, typing ? 700 : 150);
  };
  const setTerms = (patch: TermsAnswers, typing = false): void => {
    change({ ...draft, terms: { ...draft.terms, ...patch } }, typing);
  };
  const setPay = (patch: Partial<Draft['pay']>, typing = false): void => {
    change(withPay(draft, { ...draft.pay, ...patch }), typing);
  };
  /** An action on the offer as saved: what is waiting goes first. */
  const afterSave = (operation: string): void => {
    void autosave.flush().then(() => {
      act.run(operation, { offerId: data.offer.id });
    });
  };
  const currency = draft.pay.currency;
  const currencies: readonly string[] = (CURRENCIES as readonly string[]).includes(currency)
    ? CURRENCIES
    : [currency, ...CURRENCIES];
  const outside = data.checked?.checks.some((k) => k.code === 'outside_band') === true;
  const ad = data.advertised ?? null;
  const hours = draft.terms.weeklyMinutes === undefined ? null : draft.terms.weeklyMinutes / 60;
  const catalogue: CatalogueBenefit[] = data.benefits.map((b) => ({
    id: b.id,
    name: b.names['en'] ?? Object.values(b.names)[0] ?? words(b.key),
    description: b.description ?? null,
    category: b.category,
    statutory: b.statutory,
  }));
  const rules = c?.rules ?? [];

  const head = {
    title: tr('offers.offer_for', 'Offer for {{name}}', { name }),
    meta: (
      <span className="flex flex-wrap items-center gap-3">
        <StateBadge
          state={s}
          label={tr('offers.version', 'Version {{value}} · {{s}}', {
            value: String(v.version),
            s: words(s),
          })}
        />
        {editable ? <SaveNote state={autosave.state} /> : null}
      </span>
    ),
    description:
      s === 'approved' || s === 'sent'
        ? tr(
            'offers.changing_makes_a_new_version',
            '{{title}} · Changing anything makes version {{next}}, which is approved and sent again.',
            { title: data.job.title, next: String(v.version + 1) },
          )
        : data.job.title,
    actions: (
      <>
        {s === 'draft' ? (
          <Button
            variant="primary"
            loading={act.pending}
            onClick={() => {
              afterSave('SubmitOffer');
            }}
          >
            {tr('offers.send_for_approval', 'Send for approval')}
          </Button>
        ) : null}
        {s === 'approved' ? (
          <Button
            variant="primary"
            loading={act.pending}
            startIcon={<icons.send aria-hidden />}
            onClick={() => {
              afterSave('SendOffer');
            }}
          >
            {tr('offers.send_to_the_candidate', 'Send to the candidate')}
          </Button>
        ) : null}
        {s === 'accepted' ? (
          <Button
            variant="primary"
            onClick={() => props.onNavigate?.(`/recruiting/offers/${data.offer.id}/contract`)}
          >
            {tr('offers.contract', 'Contract')}
          </Button>
        ) : null}
        <MoreMenu
          label={tr('offers.more_for_the_offer', 'More for the offer')}
          items={[
            {
              id: 'candidate',
              label: tr('offers.open_the_candidate', 'Open the candidate'),
              icon: <icons.person aria-hidden />,
              group: 'go',
              onSelect: () =>
                props.onNavigate?.(
                  `/recruiting/candidates/${data.candidate.id}?application=${applicationId}`,
                ),
            },
            {
              id: 'withdraw',
              label: tr('offers.withdraw', 'Withdraw'),
              icon: <icons.undo aria-hidden />,
              destructive: true,
              group: 'state',
              hidden: !(
                s === 'draft' ||
                s === 'pending_approval' ||
                s === 'approved' ||
                s === 'sent'
              ),
              onSelect: () => {
                act.run('WithdrawOffer', { offerId: data.offer.id });
              },
            },
          ]}
        />
      </>
    ),
  };
  const body = (
    <>
      <Refusal error={autosave.error ?? act.error} />
      {s === 'declined' ? (
        <Alert
          tone="warning"
          title={tr('offers.declined_version', '{{name}} declined version {{version}}', {
            name,
            version: String(v.version),
          })}
        >
          <p>
            {data.offer.declineReason == null
              ? tr('offers.no_reason_given', 'No reason given.')
              : tr('offers.their_reason', 'Their reason: “{{reason}}”', {
                  reason: data.offer.declineReason,
                })}
          </p>
          <p>
            {tr(
              'offers.change_anything_for_a_new_version',
              'Change anything below for a new version, which goes through approval and to {{name}} again. The declined one is kept.',
              { name },
            )}
          </p>
        </Alert>
      ) : null}
      {s === 'accepted' ? (
        <Alert
          tone="success"
          title={tr('offers.accepted_hired', '{{name}} accepted and is hired', { name })}
        >
          {tr(
            'offers.prepare_the_contract_next',
            'Next, prepare the contract and send it to sign. Once it is signed, {{name}} is handed on to People.',
            { name },
          )}
        </Alert>
      ) : null}
      {data.approval === null || s !== 'pending_approval' ? null : (
        <Alert
          tone="info"
          title={tr('offers.waiting_on_step_of', 'Waiting on step {{value}} of {{length}}', {
            value: String(data.approval.state.step + 1),
            length: String(data.approval.steps.length),
          })}
        >
          {data.offer.approvalReasons.map(words).join(', ')}
        </Alert>
      )}

      <Checks data={data} />
      {/* Read-only once it waits on an approver or is settled: the fieldset turns every control off at once. */}
      <fieldset disabled={!editable} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        <legend className="sr-only">
          {tr('offers.the_offer_to', 'The offer to {{name}}', { name })}
        </legend>

        <Group
          title={tr('offers.pay', 'Pay')}
          description={
            ad === null
              ? tr('offers.the_job_ad_gave_no_pay', 'The job ad gave no pay.')
              : tr('offers.the_job_ad_gave', 'The job ad gave {{range}}.', {
                  range: range(ad.minMinor, ad.maxMinor, ad.currency),
                })
          }
        >
          <MoneyField
            label={tr('offers.base_pay', 'Base pay')}
            currency={currency}
            minor={draft.pay.baseMinor}
            onChange={(n) => {
              setPay({ baseMinor: n }, true);
            }}
          />
          <Field>
            <FieldLabel>{tr('offers.paid_per', 'Paid per')}</FieldLabel>
            <SegmentedControl
              aria-label={tr('offers.paid_per', 'Paid per')}
              value={draft.pay.frequency}
              onValueChange={(f) => {
                if (f !== '') setPay({ frequency: f as Draft['pay']['frequency'] });
              }}
            >
              <SegmentedControlItem value="year">{tr('offers.year', 'Year')}</SegmentedControlItem>
              <SegmentedControlItem value="month">
                {tr('offers.month', 'Month')}
              </SegmentedControlItem>
              <SegmentedControlItem value="hour">{tr('offers.hour', 'Hour')}</SegmentedControlItem>
            </SegmentedControl>
          </Field>
          <Pick
            label={tr('offers.currency', 'Currency')}
            value={currency}
            choices={currencies.map((k) => ({ key: k, label: k }))}
            onChange={(k) => {
              setPay({ currency: k });
            }}
          />
          {c !== null && c.paymentsPerYear.length > 1 ? (
            <Pick
              label={tr('offers.payments_a_year', 'Payments a year')}
              value={String(draft.terms.paymentsPerYear ?? c.paymentsPerYear[0])}
              choices={c.paymentsPerYear.map((n) => ({ key: String(n), label: String(n) }))}
              onChange={(k) => {
                setTerms({ paymentsPerYear: Number(k) });
              }}
            />
          ) : null}
          <MoneyField
            label={tr('offers.variable_at_target', 'Variable at target')}
            currency={currency}
            minor={draft.pay.variableTargetMinor}
            onChange={(n) => {
              setPay({ variableTargetMinor: n }, true);
            }}
          />
          <MoneyField
            label={tr('offers.sign_on_bonus', 'Sign-on bonus')}
            currency={currency}
            minor={draft.pay.signOnMinor}
            onChange={(n) => {
              setPay({ signOnMinor: n }, true);
            }}
          />
          <MoneyField
            label={tr('offers.relocation', 'Relocation')}
            currency={currency}
            minor={draft.pay.relocationMinor}
            onChange={(n) => {
              setPay({ relocationMinor: n }, true);
            }}
          />
          <NumberField
            label={tr('offers.equity', 'Equity')}
            value={draft.pay.equity?.units ?? 0}
            min={0}
            suffix={tr('offers.unit_units', 'units')}
            onChange={(n) => {
              setPay(
                {
                  equity:
                    (n ?? 0) === 0
                      ? null
                      : {
                          description:
                            draft.pay.equity?.description ?? tr('offers.options', 'Options'),
                          units: n ?? 0,
                        },
                },
                true,
              );
            }}
          />
          {data.bands.length === 0 ? null : (
            <Pick
              label={tr('offers.grade', 'Grade')}
              value={draft.grade ?? 'none'}
              choices={[
                { key: 'none', label: tr('offers.no_grade', 'No grade') },
                ...[...new Set(data.bands.map((b) => b.grade))].map((g) => ({
                  key: g,
                  label: g,
                })),
              ]}
              onChange={(g) => {
                change({ ...draft, grade: g === 'none' ? null : g });
              }}
            />
          )}
          {outside || (draft.outsideBandReason ?? '') !== '' ? (
            <Field>
              <FieldLabel>{tr('offers.why_outside_the_band', 'Why outside the band')}</FieldLabel>
              <FieldControl>
                <Textarea
                  autoResize
                  value={draft.outsideBandReason ?? ''}
                  onChange={(e) => {
                    change(
                      {
                        ...draft,
                        outsideBandReason: e.target.value === '' ? null : e.target.value,
                      },
                      true,
                    );
                  }}
                />
              </FieldControl>
            </Field>
          ) : null}
          {c?.asks.includes('exempt') === true ? (
            <Field>
              <FieldLabel>{tr('offers.exempt_q', 'Exempt from overtime?')}</FieldLabel>
              <SegmentedControl
                aria-label={tr('offers.exempt', 'Exempt from overtime')}
                value={draft.terms.exempt == null ? '' : draft.terms.exempt ? 'yes' : 'no'}
                onValueChange={(k) => {
                  if (k !== '') setTerms({ exempt: k === 'yes' });
                }}
              >
                <SegmentedControlItem value="no">{tr('offers.no', 'No')}</SegmentedControlItem>
                <SegmentedControlItem value="yes">{tr('offers.yes', 'Yes')}</SegmentedControlItem>
              </SegmentedControl>
            </Field>
          ) : null}
          <Issues issues={issues('pay')} />
        </Group>

        <Group
          title={tr('offers.dates', 'Dates')}
          description={tr(
            'offers.when_they_start_and_how_long',
            'When they start, and how long the offer stays open.',
          )}
        >
          <Field required>
            <FieldLabel>{tr('offers.start_date', 'Start date')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('offers.start_date', 'Start date')}
                value={draft.startDate === '' ? null : draft.startDate}
                onChange={(d) => {
                  if (d !== null) change(withStart(draft, d));
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('offers.offer_expires', 'Offer expires')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('offers.offer_expires', 'Offer expires')}
                value={draft.expiresOn === '' ? null : draft.expiresOn}
                onChange={(d) => {
                  if (d !== null) change({ ...draft, expiresOn: d });
                }}
              />
            </FieldControl>
          </Field>
          {shown('duration') ? (
            <Field>
              <FieldLabel>{tr('offers.ends_on', 'Ends on')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={tr('offers.ends_on', 'Ends on')}
                  value={draft.terms.contractEnd ?? null}
                  onChange={(d) => {
                    setTerms({ contractEnd: d });
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {tr('offers.leave_empty_for_no_end', 'Leave empty for no end.')}
              </FieldDescription>
            </Field>
          ) : null}
          <Issues issues={issues('duration')} />
        </Group>

        <Group
          title={tr('offers.contract', 'Contract')}
          {...(c === null
            ? {}
            : {
                description: c.reviewed
                  ? tr(
                      'offers.hired_through_pack',
                      'Hired through the job’s legal entity, in {{country}}; {{country}} pack {{version}}.',
                      { country: c.country, version: c.version },
                    )
                  : tr(
                      'offers.hired_through_pack_awaiting',
                      'Hired through the job’s legal entity, in {{country}}; {{country}} pack {{version}}, awaiting a country reviewer.',
                      { country: c.country, version: c.version },
                    ),
              })}
        >
          {c === null ? (
            <Alert tone="warning" title={tr('offers.no_country_pack_yet', 'No country pack yet')}>
              {tr(
                'offers.choose_the_jobs_legal_entity_its',
                'Choose the job’s legal entity; its country decides what the composer offers.',
              )}
            </Alert>
          ) : (
            <>
              <Pick
                label={tr('offers.relationship', 'Relationship')}
                value={draft.terms.relationship}
                choices={c.relationships}
                onChange={(k) => {
                  setTerms({ relationship: k as NonNullable<TermsAnswers['relationship']> });
                }}
              />
              <Pick
                label={tr('offers.contract_type', 'Contract type')}
                value={draft.terms.contractType}
                choices={c.contractTypes}
                onChange={(k) => {
                  setTerms({ contractType: k });
                }}
              />
              {shown('fixed_term_reason') ? (
                <Pick
                  label={tr('offers.fixed_term_reason', 'Fixed-term reason')}
                  value={draft.terms.fixedTermReason}
                  choices={c.reasons}
                  onChange={(k) => {
                    setTerms({ fixedTermReason: k });
                  }}
                />
              ) : null}
              {c.asksPreviousEmployment ? (
                <Field>
                  <FieldLabel>
                    {tr('offers.worked_here_before_q', 'Worked for this employer before?')}
                  </FieldLabel>
                  <SegmentedControl
                    aria-label={tr('offers.worked_here_before', 'Worked here before')}
                    value={draft.terms.previouslyEmployed === true ? 'yes' : 'no'}
                    onValueChange={(k) => {
                      if (k !== '') setTerms({ previouslyEmployed: k === 'yes' });
                    }}
                  >
                    <SegmentedControlItem value="no">{tr('offers.no', 'No')}</SegmentedControlItem>
                    <SegmentedControlItem value="yes">
                      {tr('offers.yes', 'Yes')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                </Field>
              ) : null}
              {shown('agreement') ? (
                <AgreementFields
                  agreements={data.agreements ?? []}
                  value={draft.terms.agreement}
                  required
                  disabled={!editable}
                  onChange={(agreement) => {
                    setTerms({ agreement });
                  }}
                  onNavigate={props.onNavigate}
                />
              ) : null}
              <Issues
                issues={issues(
                  'entity',
                  'relationship',
                  'contract_type',
                  'fixed_term_reason',
                  'agreement',
                )}
              />
            </>
          )}
        </Group>

        <Group
          title={tr('offers.time_and_place', 'Time and place')}
          description={tr('offers.how_much_and_where_they_work', 'How much they work, and where.')}
        >
          {c !== null && c.regions.length > 0 ? (
            <Pick
              label={tr('offers.region', 'Region')}
              value={draft.terms.region}
              choices={c.regions}
              onChange={(k) => {
                setTerms({ region: k });
              }}
            />
          ) : null}
          <NumberField
            label={tr('offers.hours_a_week', 'Hours a week')}
            value={hours}
            min={1}
            max={60}
            step={0.5}
            suffix={tr('offers.unit_hours', 'hours')}
            onChange={(n) => {
              change(withPay(draft, draft.pay, n === null ? undefined : Math.round(n * 60)), true);
            }}
          />
          <Field>
            <FieldLabel>{tr('offers.work_mode', 'Work mode')}</FieldLabel>
            <SegmentedControl
              aria-label={tr('offers.work_mode', 'Work mode')}
              value={draft.terms.workMode ?? ''}
              onValueChange={(k) => {
                if (k !== '') setTerms({ workMode: k as NonNullable<TermsAnswers['workMode']> });
              }}
            >
              <SegmentedControlItem value="onsite">
                {tr('offers.on_site', 'On site')}
              </SegmentedControlItem>
              <SegmentedControlItem value="hybrid">
                {tr('offers.hybrid', 'Hybrid')}
              </SegmentedControlItem>
              <SegmentedControlItem value="remote">
                {tr('offers.remote', 'Remote')}
              </SegmentedControlItem>
            </SegmentedControl>
          </Field>
          {draft.terms.workMode === 'hybrid' ? (
            <NumberField
              label={tr('offers.days_on_site_a_week', 'Days on site a week')}
              value={draft.terms.hybridDaysOnsite ?? null}
              min={1}
              max={5}
              suffix={tr('offers.unit_days', 'days')}
              onChange={(n) => {
                setTerms({ hybridDaysOnsite: n }, true);
              }}
            />
          ) : null}
          {draft.terms.workMode === 'remote' ? (
            <Field>
              <FieldLabel>
                {tr('offers.working_from_country_code', 'Working from (country code)')}
              </FieldLabel>
              <FieldControl>
                <Input
                  maxLength={2}
                  value={draft.terms.remoteCountry ?? ''}
                  onChange={(e) => {
                    setTerms(
                      {
                        remoteCountry: e.target.value === '' ? null : e.target.value.toUpperCase(),
                      },
                      true,
                    );
                  }}
                />
              </FieldControl>
            </Field>
          ) : null}
          <Issues issues={issues('location', 'hours', 'work_mode')} />
        </Group>

        <Group
          title={tr('offers.probation_and_notice', 'Probation and notice')}
          description={tr(
            'offers.the_law_sets_the_limits',
            'Filled with the law’s defaults; the checks say when a change goes past what it allows.',
          )}
        >
          {c?.asks.includes('roleGroup') === true ? (
            <Field>
              <FieldLabel>
                {tr('offers.qualified_technician_q', 'Is the role for a qualified technician?')}
              </FieldLabel>
              <SegmentedControl
                aria-label={tr('offers.qualified_technician', 'Qualified technician')}
                value={draft.terms.roleGroup ?? ''}
                onValueChange={(k) => {
                  if (k === 'qualified' || k === 'other') setTerms({ roleGroup: k });
                }}
              >
                <SegmentedControlItem value="other">{tr('offers.no', 'No')}</SegmentedControlItem>
                <SegmentedControlItem value="qualified">
                  {tr('offers.yes', 'Yes')}
                </SegmentedControlItem>
              </SegmentedControl>
            </Field>
          ) : null}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch
                id="no-probation"
                checked={draft.terms.probation === null}
                onCheckedChange={(on) => {
                  setTerms({ probation: on ? null : { count: 6, unit: 'months' } });
                }}
              />
              <label htmlFor="no-probation">{tr('offers.no_probation', 'No probation')}</label>
            </div>
            {draft.terms.probation === null ? null : (
              <Length
                label={tr('offers.probation', 'Probation')}
                value={draft.terms.probation}
                onChange={(x) => {
                  setTerms({ probation: x }, true);
                }}
              />
            )}
          </div>
          <Length
            label={tr('offers.notice_from_the_employee', 'Notice from the employee')}
            value={draft.terms.noticeEmployee}
            onChange={(x) => {
              setTerms({ noticeEmployee: x }, true);
            }}
          />
          <Length
            label={tr('offers.notice_from_the_employer', 'Notice from the employer')}
            value={draft.terms.noticeEmployer}
            onChange={(x) => {
              setTerms({ noticeEmployer: x }, true);
            }}
          />
          <Issues issues={issues('probation', 'notice')} />
        </Group>

        {shown('clauses') ? (
          <Group title={tr('offers.clauses', 'Clauses')}>
            <NumberField
              label={tr('offers.non_compete', 'Non-compete')}
              value={draft.terms.nonCompeteMonths ?? 0}
              min={0}
              max={36}
              suffix={tr('offers.unit_months', 'months')}
              onChange={(n) => {
                setTerms({ nonCompeteMonths: n === 0 ? null : n }, true);
              }}
            />
            {(draft.terms.nonCompeteMonths ?? 0) > 0 ? (
              <NumberField
                label={tr(
                  'offers.compensation_during_it_of_last_pay',
                  'Compensation during it, % of last pay',
                )}
                value={draft.terms.nonCompeteCompensationPercent ?? null}
                min={0}
                max={100}
                suffix="%"
                onChange={(n) => {
                  setTerms({ nonCompeteCompensationPercent: n }, true);
                }}
              />
            ) : null}
            <div className="flex items-center gap-3">
              <Switch
                id="mobility"
                checked={draft.terms.mobilityClause === true}
                onCheckedChange={(on) => {
                  setTerms({ mobilityClause: on });
                }}
              />
              <label htmlFor="mobility">{tr('offers.mobility_clause', 'Mobility clause')}</label>
            </div>
            <Issues issues={issues('clauses')} />
          </Group>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('offers.benefits', 'Benefits')}</CardTitle>
            <CardDescription>
              {tr(
                'offers.from_the_job_ad_change_or_add',
                'Those the job ad gave are chosen; change them, or write in one the catalogue does not have.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <BenefitPicker
              benefits={catalogue}
              categories={data.categories ?? []}
              chosen={draft.benefitIds}
              disabled={!editable}
              onChange={(ids) => {
                change({ ...draft, benefitIds: ids });
              }}
            />
            <TagsInput
              label={tr('offers.also_in_this_offer', 'Also in this offer')}
              hint={tr(
                'offers.also_in_this_offer_hint',
                'A benefit for this offer alone, in a few words. Press Enter to add it.',
              )}
              placeholder={tr('offers.a_team_retreat', 'A team retreat in spring')}
              delimiters={[]}
              max={30}
              disabled={!editable}
              value={draft.extraBenefits}
              onChange={(list) => {
                change({ ...draft, extraBenefits: list });
              }}
            />
            <Issues issues={issues('benefits')} />
          </CardContent>
        </Card>
      </fieldset>
      {rules.length === 0 ? null : (
        <Card>
          <Accordion type="single" collapsible>
            <AccordionItem value="rules">
              <AccordionTrigger className="px-5">
                {tr('offers.rules_that_applied_n', 'Rules that applied ({{count}})', {
                  count: String(rules.length),
                })}
              </AccordionTrigger>
              <AccordionContent className="px-5">
                <ul className="flex flex-col gap-3">
                  {rules.map((r) => (
                    <li key={`${r.step}:${r.text}`} className="flex flex-col gap-0.5">
                      <span className="text-sm">{r.text}</span>
                      <span className="font-mono text-xs text-fg-muted">
                        {STEP_LABEL[r.step] ?? words(r.step)} · {r.source}
                      </span>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      )}
    </>
  );
  if (onClose === undefined)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader {...head} />
        {body}
      </div>
    );
  return (
    <>
      <ModalPageHeader {...head} />
      <ModalPageBody className="px-4 py-5 @2xl:px-8 @2xl:py-7">
        <div className="flex flex-col gap-6">{body}</div>
      </ModalPageBody>
    </>
  );
}

/** R20: the approver sees the offer and its checks, nothing else about the candidate. */
export function OfferApproval(props: ScreenProps<OfferData>): JSX.Element {
  const act = useAct(props);
  const [comment, setComment] = useState('');
  return (
    <Loaded load={props.load} what={tr('offers.the_offer', 'the offer')}>
      {(data) => {
        const v = data.offer.versions.at(-1);
        const t = data.checked?.terms;
        const decide = (decision: 'approved' | 'rejected') => {
          act.run(
            'DecideOffer',
            {
              offerId: data.offer.id,
              input: { decision, comment: comment === '' ? null : comment },
            },
            () => {
              props.onNavigate?.('/recruiting/offers');
              return 'left';
            },
            undefined,
            decision,
          );
        };
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={tr('offers.approve_offer', 'Approve offer: {{name}}', {
                name: data.candidate.name,
              })}
              description={data.job.title}
              meta={<StateBadge state={data.offer.state} />}
            />
            <Refusal error={act.error} />
            <Card padded>
              <KeyValues
                items={[
                  { label: tr('offers.job', 'Job'), value: data.job.title },
                  {
                    label: tr('offers.terms', 'Terms'),
                    value:
                      t == null
                        ? tr('offers.not_complete', 'Not complete')
                        : `${words(t.contractType)} · ${String(t.weeklyMinutes / 60)} h a week`,
                  },
                  {
                    label: tr('offers.base', 'Base'),
                    value:
                      v === undefined
                        ? '—'
                        : `${money(v.pay.baseMinor, v.pay.currency)} a ${v.pay.frequency}`,
                  },
                  { label: tr('offers.start', 'Start'), value: day(v?.startDate ?? null) },
                ]}
              />
            </Card>
            {data.meta.outsideBandReason === null ? null : (
              <Alert tone="warning" title={tr('offers.outside_the_band', 'Outside the band')}>
                {data.meta.outsideBandReason}
              </Alert>
            )}
            <Checks data={data} />
            <p className="text-xs text-fg-muted">
              {tr(
                'offers.you_see_the_offer_and_its',
                'You see the offer and its checks; nothing else about the candidate.',
              )}
            </p>
            {data.approval?.mine === true ? (
              <Card padded>
                <Field>
                  <FieldLabel>{tr('offers.comment', 'Comment')}</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      value={comment}
                      onChange={(e) => {
                        setComment(e.target.value);
                      }}
                      placeholder={tr(
                        'offers.optional_required_to_reject',
                        'Optional. Required to reject.',
                      )}
                    />
                  </FieldControl>
                </Field>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={comment.trim() === '' || act.pending}
                    loading={act.busy('rejected')}
                    onClick={() => {
                      decide('rejected');
                    }}
                  >
                    {tr('offers.reject', 'Reject')}
                  </Button>
                  <Button
                    disabled={act.pending}
                    loading={act.busy('approved')}
                    onClick={() => {
                      decide('approved');
                    }}
                  >
                    {tr('offers.approve', 'Approve')}
                  </Button>
                </div>
              </Card>
            ) : (
              <Alert tone="info" title={tr('offers.not_waiting_on_you', 'Not waiting on you')}>
                {tr('offers.another_approver_holds_this_step', 'Another approver holds this step.')}
              </Alert>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

/** R22: the contract, its signing, and the conditions before the start. */
interface Particular {
  readonly key: string;
  readonly law: string;
  readonly value: string | null;
}

interface Drafted {
  readonly ai: boolean;
  readonly title: string;
  readonly body: string;
  readonly particulars: readonly Particular[];
  readonly figures: readonly string[];
  readonly signers: readonly {
    readonly name: string;
    readonly order: number;
    readonly who: string;
  }[];
}

/** What each statutory particular is called, whichever country's law asks for it. */
const PARTICULAR = (): Readonly<Record<string, string>> => ({
  parties: tr('offers.particular.parties', 'The parties'),
  employer_address: tr('offers.particular.employer_address', 'Employer’s registered address'),
  employee_address: tr('offers.particular.employee_address', 'Employee’s address'),
  start: tr('offers.particular.start', 'Start date'),
  continuous_employment: tr(
    'offers.particular.continuous_employment',
    'Continuous employment from',
  ),
  end: tr('offers.particular.end', 'End of the fixed term'),
  role: tr('offers.particular.role', 'Job title'),
  place_of_work: tr('offers.particular.place_of_work', 'Place of work'),
  contract_type: tr('offers.particular.contract_type', 'Type of contract'),
  pay: tr('offers.particular.pay', 'Pay'),
  pay_timing: tr('offers.particular.pay_timing', 'When and how pay is paid'),
  variable_pay: tr('offers.particular.variable_pay', 'Bonus and other payments'),
  hours: tr('offers.particular.hours', 'Working hours'),
  overtime: tr('offers.particular.overtime', 'Overtime'),
  holiday: tr('offers.particular.holiday', 'Holiday'),
  sick_pay: tr('offers.particular.sick_pay', 'Sick pay'),
  benefits: tr('offers.particular.benefits', 'Benefits'),
  pension: tr('offers.particular.pension', 'Pension'),
  probation: tr('offers.particular.probation', 'Probation'),
  notice: tr('offers.particular.notice', 'Notice periods'),
  dismissal_procedure: tr('offers.particular.dismissal_procedure', 'Dismissal procedure'),
  training: tr('offers.particular.training', 'Training'),
  disciplinary: tr('offers.particular.disciplinary', 'Disciplinary and grievance rules'),
  collective_agreement: tr('offers.particular.collective_agreement', 'Collective agreement'),
  at_will: tr('offers.particular.at_will', 'At-will employment'),
  overtime_status: tr('offers.particular.overtime_status', 'Overtime status'),
  conditions: tr('offers.particular.conditions', 'Conditions before the start'),
  non_compete: tr('offers.particular.non_compete', 'Non-compete'),
  governing_law: tr('offers.particular.governing_law', 'Governing law'),
});

const TO_CONFIRM = /\[\[TO CONFIRM:\s*([^\]]+?)\s*\]\]/gu;

/** A draft kept in this tab while HR works on it: a reload does not lose an edit. */
const kept = (offerId: string): { title: string; body: string } | null => {
  try {
    const raw = sessionStorage.getItem(`contract-draft:${offerId}`);
    return raw === null ? null : (JSON.parse(raw) as { title: string; body: string });
  } catch {
    return null;
  }
};
const keep = (offerId: string, draft: { title: string; body: string } | null): void => {
  try {
    if (draft === null) sessionStorage.removeItem(`contract-draft:${offerId}`);
    else sessionStorage.setItem(`contract-draft:${offerId}`, JSON.stringify(draft));
  } catch {
    // A private window keeps nothing; the draft is still on the screen.
  }
};

/**
 * The contract, drafted and checked (PRD §21.1): Kithena writes it from the
 * accepted offer and what the law of the employing entity's country says a
 * written contract states. HR reads every fact beside the law that asks for
 * it, fills in what Kithena does not hold, edits the text, previews it as it
 * will be filed, and sends it: the candidate signs first, then the company,
 * each initialling every page before the last.
 */
/** One turn of the conversation that changes the contract. */
interface Turn {
  readonly from: 'self' | 'other';
  readonly text: string;
}

/**
 * The contract changed by asking: "make the probation clause plainer", "add
 * a clause on working from home". The text as it stands goes with the ask,
 * the parties' names masked from the model, and comes back whole; the last
 * change can be taken back.
 */
function ReviseChat({
  offerId,
  body,
  props,
  onRevised,
}: {
  readonly offerId: string;
  readonly body: string;
  readonly props: ScreenProps<OfferData>;
  readonly onRevised: (body: string) => void;
}): JSX.Element {
  const act = useAct(props);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const ask = (instruction: string): void => {
    setTurns((all) => [...all, { from: 'self', text: instruction }]);
    startAsking(async () => {
      const done = await act.call('ReviseContract', {
        offerId,
        input: { body, instruction },
      });
      if (!done.ok) {
        setTurns((all) => [...all, { from: 'other', text: done.message }]);
        return;
      }
      const revised = done.data as { reply: string; body: string };
      setBefore(body);
      onRevised(revised.body);
      setTurns((all) => [...all, { from: 'other', text: revised.reply }]);
    });
  };
  const ai = tr('offers.revise_ai', 'AI');
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{tr('offers.revise_title', 'Change it by asking')}</h3>
        <p className="text-sm text-fg-muted">
          {tr(
            'offers.revise_hint',
            'Ask for a change in words: the AI rewrites the contract and says what it changed. Names stay out of what it reads.',
          )}
        </p>
      </div>
      {turns.length === 0 ? null : (
        <ChatLog label={tr('offers.revise_conversation', 'Changes asked')} className="max-h-[40vh]">
          {turns.map((m, i) => (
            <ChatMessage
              // The conversation only grows; a turn's place is its identity.
              key={i}
              from={m.from}
              author={m.from === 'self' ? tr('offers.revise_you', 'You') : ai}
            >
              {m.text}
            </ChatMessage>
          ))}
          {asking ? <ChatMessage author={ai} pending /> : null}
        </ChatLog>
      )}
      <ChatComposer
        label={tr('offers.revise_label', 'What to change')}
        placeholder={tr(
          'offers.revise_placeholder',
          'Make the probation clause plainer, or add a clause on working from home…',
        )}
        busy={asking}
        disabled={body.trim() === ''}
        onSend={ask}
      />
      {before === null || asking ? null : (
        <div>
          <Button
            variant="ghost"
            size="sm"
            startIcon={<icons.undo aria-hidden />}
            onClick={() => {
              onRevised(before);
              setBefore(null);
              setTurns((all) => [
                ...all,
                {
                  from: 'other',
                  text: tr('offers.revise_undone', 'Taken back: the text is as it was.'),
                },
              ]);
            }}
          >
            {tr('offers.revise_undo', 'Undo the last change')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ContractDraft({
  data,
  props,
}: {
  readonly data: OfferData;
  readonly props: ScreenProps<OfferData>;
}): JSX.Element {
  const act = useAct(props);
  const offerId = data.offer.id;
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [checked, setChecked] = useState(false);
  const [preview, setPreview] = useState<Uint8Array | null>(null);
  const [previewing, startPreviewing] = useTransition();
  const [drafting, startDrafting] = useTransition();
  const [draftError, setDraftError] = useState<string | null>(null);
  const draft = (fresh: boolean): void => {
    setDraftError(null);
    startDrafting(async () => {
      const done = await act.call('DraftContract', { offerId });
      if (!done.ok) {
        setDraftError(done.message);
        return;
      }
      const made = done.data as Drafted;
      setDrafted(made);
      const held = fresh ? null : kept(offerId);
      setTitle(held?.title ?? made.title);
      setBody(held?.body ?? made.body);
      setChecked(false);
      if (fresh) keep(offerId, null);
    });
  };
  useEffect(() => {
    draft(false);
  }, [offerId]);
  const edit = (next: { title?: string; body?: string }): void => {
    const now = { title: next.title ?? title, body: next.body ?? body };
    setTitle(now.title);
    setBody(now.body);
    setChecked(false);
    keep(offerId, now);
  };
  const open = Array.from(body.matchAll(TO_CONFIRM), (m) => m[1] ?? '');
  const labels = PARTICULAR();
  const ready = drafted !== null && body.trim() !== '' && open.length === 0 && checked;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle level={2}>{tr('offers.contract_draft', 'The contract')}</CardTitle>
            <CardDescription>
              {tr(
                'offers.contract_draft_hint',
                'Drafted from the accepted offer and the law of the employing entity. Check every fact, edit what you need, then send it to sign.',
              )}
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={drafting}
            startIcon={<icons.assistant aria-hidden />}
            onClick={() => {
              draft(true);
            }}
          >
            {tr('offers.draft_again', 'Draft again')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draftError === null ? null : (
          <Alert tone="danger" title={tr('offers.not_drafted', 'Not drafted')}>
            {draftError}
          </Alert>
        )}
        {drafted === null ? (
          <EmptyState
            icon={<icons.assistant aria-hidden />}
            title={tr('offers.drafting_the_contract', 'Drafting the contract…')}
            description={tr(
              'offers.drafting_the_contract_hint',
              'From the accepted terms, the pay and the law of the country it is signed under.',
            )}
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="flex flex-col gap-4">
              {drafted.ai ? (
                <Alert tone="info" title={tr('offers.drafted_by_ai', 'Drafted by AI')}>
                  {tr(
                    'offers.drafted_by_ai_hint',
                    'An AI wrote this from the facts on the right and never saw a name. It is a draft: you are responsible for what is sent, so read it in full.',
                  )}
                </Alert>
              ) : (
                <Alert
                  tone="info"
                  title={tr('offers.drawn_from_the_terms', 'Drawn from the terms')}
                >
                  {tr(
                    'offers.drawn_from_the_terms_hint',
                    'Kithena drew this from the accepted terms. Switch on the AI writer in Recruiting settings for a full contract under the law of the country.',
                  )}
                </Alert>
              )}
              {open.length === 0 ? null : (
                <Alert
                  tone="warning"
                  title={tr('offers.fill_in_before_sending', 'Fill in before sending')}
                >
                  {formatList(open)}
                </Alert>
              )}
              {drafted.figures.length === 0 ? null : (
                <Alert
                  tone="warning"
                  title={tr('offers.check_these_figures', 'Check these figures')}
                >
                  {tr(
                    'offers.check_these_figures_hint',
                    'The draft has figures no fact gave: {{figures}}. Correct or remove each one.',
                    { figures: formatList(drafted.figures) },
                  )}
                </Alert>
              )}
              <Field required>
                <FieldLabel>{tr('offers.contract_title', 'Title')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={title}
                    onChange={(e) => {
                      edit({ title: e.target.value });
                    }}
                  />
                </FieldControl>
              </Field>
              <Field required>
                <FieldLabel>{tr('offers.contract_text', 'Contract')}</FieldLabel>
                <FieldControl>
                  <Textarea
                    rows={28}
                    value={body}
                    onChange={(e) => {
                      edit({ body: e.target.value });
                    }}
                  />
                </FieldControl>
                <FieldDescription>
                  {tr(
                    'offers.contract_text_hint',
                    'Each signer’s signature line and initials on every page are added when it is filed.',
                  )}
                </FieldDescription>
              </Field>
            </div>
            <aside className="flex flex-col gap-4">
              {drafted.ai ? (
                <ReviseChat
                  offerId={offerId}
                  body={body}
                  props={props}
                  onRevised={(next) => {
                    edit({ body: next });
                  }}
                />
              ) : null}
              <div>
                <h3 className="font-semibold">{tr('offers.facts_to_check', 'Facts to check')}</h3>
                <p className="text-sm text-fg-muted">
                  {tr(
                    'offers.facts_to_check_hint',
                    'What the law of the employing entity says the contract states, and where each comes from.',
                  )}
                </p>
              </div>
              <KeyValues
                items={drafted.particulars.map((p) => ({
                  label: labels[p.key] ?? words(p.key),
                  value: (
                    <span className="flex flex-col gap-0.5">
                      {p.value === null ? (
                        <Badge size="sm" tone="warning">
                          {tr('offers.to_fill_in', 'To fill in')}
                        </Badge>
                      ) : (
                        <span>{p.value}</span>
                      )}
                      <span className="text-xs text-fg-muted">{p.law}</span>
                    </span>
                  ),
                }))}
              />
              <div>
                <h3 className="font-semibold">{tr('offers.who_signs', 'Who signs')}</h3>
                <ol className="mt-1 list-decimal pl-5 text-sm">
                  {drafted.signers.map((s) => (
                    <li key={s.order}>
                      {s.who === 'candidate'
                        ? tr(
                            'offers.signer_candidate',
                            '{{name}}, with a code sent to their email',
                            {
                              name: s.name,
                            },
                          )
                        : tr('offers.signer_company', '{{name}}, for the company', {
                            name: s.name,
                          })}
                    </li>
                  ))}
                </ol>
                <p className="mt-1 text-xs text-fg-muted">
                  {tr(
                    'offers.signers_initial_hint',
                    'Each initials every page and signs and dates the last.',
                  )}
                </p>
              </div>
              <Field orientation="horizontal" className="justify-start">
                <FieldControl>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(on) => {
                      setChecked(on === true);
                    }}
                  />
                </FieldControl>
                <FieldLabel>
                  {tr(
                    'offers.i_checked_every_fact',
                    'I checked every fact against the accepted offer and the law',
                  )}
                </FieldLabel>
              </Field>
              <Refusal error={act.error} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={body.trim() === '' || act.pending}
                  loading={previewing}
                  startIcon={<icons.visible aria-hidden />}
                  onClick={() => {
                    startPreviewing(async () => {
                      const done = await act.call('PreviewContract', { offerId, title, body });
                      if (done.ok) {
                        const b64 = (done.data as { base64: string }).base64;
                        setPreview(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
                      }
                    });
                  }}
                >
                  {tr('offers.preview', 'Preview')}
                </Button>
                <Button
                  disabled={!ready || previewing}
                  loading={act.pending}
                  startIcon={<icons.send aria-hidden />}
                  onClick={() => {
                    act.run('SendContract', { offerId, title, body }, (made) => {
                      keep(offerId, null);
                      const id = (made as { id?: string } | null)?.id;
                      if (id === undefined) return undefined;
                      props.onNavigate?.(`/documents/d/${id}`);
                      return 'left';
                    });
                  }}
                >
                  {tr('offers.send_to_sign', 'Send to sign')}
                </Button>
              </div>
            </aside>
          </div>
        )}
      </CardContent>
      <ModalPage
        open={preview !== null}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
      >
        <ModalPageContent size="inset">
          <ModalPageHeader title={title} />
          <ModalPageBody>
            {preview === null ? null : <PdfPages src={preview} label={title} />}
          </ModalPageBody>
        </ModalPageContent>
      </ModalPage>
    </Card>
  );
}

export function Contract(props: ScreenProps<OfferData>): JSX.Element {
  const act = useAct(props);
  const [fileId, setFileId] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [own, setOwn] = useState<readonly UploadItem[]>([]);
  const [attaching, attach] = useTransition();
  const [attachError, setAttachError] = useState<string | null>(null);
  /** HR's own PDF: put where Documents asks, then filed and sent to sign as the drawn one would be. */
  const sendOwn = (offerId: string, file: File): void => {
    setAttachError(null);
    setOwn([{ id: file.name, file, status: 'uploading', progress: null }]);
    attach(async () => {
      const fail = (message: string): void => {
        setAttachError(message);
        setOwn([{ id: file.name, file, status: 'error', error: message }]);
      };
      const started = await act.call('StartContractUpload', {
        name: file.name,
        mediaType: file.type,
        size: file.size,
      });
      if (!started.ok) {
        fail(started.message);
        return;
      }
      const put = started.data as {
        uploadId: string;
        url: string;
        headers: Record<string, string>;
      };
      const sent = await fetch(put.url, { method: 'PUT', headers: put.headers, body: file }).catch(
        () => null,
      );
      if (sent?.ok !== true) {
        fail(tr('offers.documents_did_not_take_it', 'Documents did not take the file. Try again.'));
        return;
      }
      const done = await act.call('SendOwnContract', {
        offerId,
        upload: { uploadId: put.uploadId, name: file.name },
      });
      if (!done.ok) {
        fail(done.message);
        return;
      }
      setOwn([{ id: file.name, file, status: 'done' }]);
      const id = (done.data as { id?: string } | null)?.id;
      if (id !== undefined) props.onNavigate?.(`/documents/d/${id}`);
    });
  };
  return (
    <Loaded load={props.load} what={tr('offers.the_contract', 'the contract')}>
      {(data) => {
        const k = data.contract;
        const p = data.prehire;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={tr('offers.contract_2', 'Contract: {{name}}', { name: data.candidate.name })}
              description={
                data.offer.acceptance === null
                  ? data.job.title
                  : tr(
                      'offers.offer_v_accepted_version_hash',
                      '{{title}} · offer v{{version}} accepted {{at}} · version hash {{slice}}…',
                      {
                        title: data.job.title,
                        version: String(data.offer.acceptance.version),
                        at: day(data.offer.acceptance.at),
                        slice: data.offer.acceptance.versionHash.slice(0, 8),
                      },
                    )
              }
            />
            <Refusal error={act.error} />
            {k !== null &&
            k.route === 'documents' &&
            k.state === 'generated' &&
            data.offer.acceptance !== null ? (
              <ContractDraft data={data} props={props} />
            ) : null}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>{tr('offers.contract', 'Contract')}</CardTitle>
                    <CardDescription>
                      {k === null
                        ? tr(
                            'offers.generated_when_the_offer_is_accepted',
                            'Generated when the offer is accepted',
                          )
                        : tr('offers.pack_2', 'Pack {{packVersion}}', {
                            packVersion: k.packVersion,
                          })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {k === null ? (
                      <EmptyState
                        icon={<icons.document aria-hidden />}
                        title={tr('offers.no_contract_yet', 'No contract yet')}
                      />
                    ) : (
                      <KeyValues
                        items={[
                          { label: tr('offers.state', 'State'), value: words(k.state) },
                          {
                            label: tr('offers.signing', 'Signing'),
                            value:
                              k.route === 'wet_ink'
                                ? tr(
                                    'offers.wet_ink_printed_signed_by_hand',
                                    'Wet ink: printed, signed by hand by both, scan uploaded',
                                  )
                                : k.route === 'documents'
                                  ? tr('offers.through_documents', 'Through Documents')
                                  : tr(
                                      'offers.signed_contract_uploaded',
                                      'Signed contract uploaded',
                                    ),
                          },
                          {
                            label: tr('offers.documents', 'Documents'),
                            value: k.documents.map(words).join(', '),
                          },
                          {
                            label: tr('offers.signed', 'Signed'),
                            value:
                              k.signedOn === null
                                ? tr('offers.not_yet', 'Not yet')
                                : day(k.signedOn),
                          },
                        ]}
                      />
                    )}
                    {k !== null && k.route === 'documents' && k.state === 'generated' ? (
                      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
                        <div>
                          <h3 className="font-semibold">
                            {tr('offers.or_attach_your_own', 'Or attach your own contract')}
                          </h3>
                          <p className="text-sm text-fg-muted">
                            {tr(
                              'offers.your_own_pdf_is_sent',
                              'A PDF your company wrote: it is sent to {{name}} to sign in the same order, and signing it hires them the same way. Each signature goes beside a signature line the PDF already has.',
                              { name: data.candidate.name },
                            )}
                          </p>
                        </div>
                        {attachError === null ? null : (
                          <Alert tone="danger" title={tr('offers.not_sent', 'Not sent')}>
                            {attachError}
                          </Alert>
                        )}
                        <FileUploader
                          label={tr('offers.the_contract_pdf', 'The contract, as a PDF')}
                          accept={['application/pdf']}
                          maxFiles={1}
                          maxSize={20 * 1024 * 1024}
                          value={own}
                          onChange={setOwn}
                          disabled={attaching}
                          onAccepted={(files) => {
                            const file = files[0];
                            if (file !== undefined) sendOwn(data.offer.id, file);
                          }}
                        />
                      </div>
                    ) : null}
                    {k !== null && k.route === 'documents' && k.state === 'out_for_signature' ? (
                      <p className="mt-4 text-sm text-fg-muted">
                        {tr(
                          'offers.out_for_signature_in_documents_it',
                          'Out for signature in Documents. It is signed here the moment the last signature lands.',
                        )}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
                {k !== null && k.state !== 'signed' && k.route !== 'documents' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle level={2}>
                        {tr('offers.record_the_signed_contract', 'Record the signed contract')}
                      </CardTitle>
                      <CardDescription>
                        {tr(
                          'offers.upload_the_scan_to_documents_or',
                          'Upload the scan to Documents or the candidate’s files, then record it here.',
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                      <Field required>
                        <FieldLabel>{tr('offers.file_reference', 'File reference')}</FieldLabel>
                        <FieldControl>
                          <Input
                            value={fileId}
                            onChange={(e) => {
                              setFileId(e.target.value);
                            }}
                          />
                        </FieldControl>
                      </Field>
                      <Field required>
                        <FieldLabel>
                          {tr(
                            'offers.date_of_the_second_signature',
                            'Date of the second signature',
                          )}
                        </FieldLabel>
                        <FieldControl>
                          <DatePicker
                            label={tr(
                              'offers.date_of_the_second_signature',
                              'Date of the second signature',
                            )}
                            value={signedOn === '' ? null : signedOn}
                            onChange={(d) => {
                              setSignedOn(d ?? '');
                            }}
                          />
                        </FieldControl>
                        <FieldDescription>
                          {tr(
                            'offers.must_be_before_the_start_date',
                            'Must be before the start date.',
                          )}
                        </FieldDescription>
                      </Field>
                      <div className="flex justify-end">
                        <Button
                          disabled={fileId === '' || signedOn === ''}
                          loading={act.pending}
                          onClick={() => {
                            act.run('UploadSignedContract', {
                              offerId: data.offer.id,
                              input: { fileId, signedOn },
                            });
                          }}
                        >
                          {tr('offers.record_as_signed', 'Record as signed')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>
                      {tr('offers.pre_start_conditions', 'Pre-start conditions')}
                    </CardTitle>
                    <CardDescription>
                      {tr(
                        'offers.an_open_condition_on_the_start',
                        'An open condition on the start date blocks the start',
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {p === null || p.conditions.length === 0 ? (
                      <p className="text-sm text-fg-muted">{tr('offers.none', 'None.')}</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr('offers.condition', 'Condition')}</TableHead>
                            <TableHead>{tr('offers.state', 'State')}</TableHead>
                            <TableHead>
                              <span className="sr-only">{tr('offers.decide', 'Decide')}</span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {p.conditions.map((c) => (
                            <TableRow key={c.kind}>
                              <TableCell>{words(c.kind)}</TableCell>
                              <TableCell>
                                <StateBadge state={c.state} />
                              </TableCell>
                              <TableCell>
                                {c.state === 'open' ? (
                                  <span className="flex gap-1">
                                    {(['met', 'waived', 'failed'] as const).map((to) => (
                                      <Button
                                        key={to}
                                        size="sm"
                                        variant={to === 'met' ? 'secondary' : 'ghost'}
                                        loading={act.pending}
                                        onClick={() => {
                                          act.run('DecideCondition', {
                                            applicationId: data.offer.applicationId,
                                            kind: c.kind,
                                            input: { state: to, note: null },
                                          });
                                        }}
                                      >
                                        {words(to)}
                                      </Button>
                                    ))}
                                  </span>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
              <div className="flex flex-col gap-4">
                <Card padded>
                  <h2 className="mb-2 font-semibold">
                    {tr('offers.when_its_signed', 'When it’s signed')}
                  </h2>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                    {props.with?.people === false ? (
                      <li>
                        {tr(
                          'offers.the_hired_webhook_carries_the_hire',
                          'The hired webhook carries the hire to any HRIS',
                        )}
                      </li>
                    ) : (
                      <li>
                        {tr(
                          'offers.people_creates_the_pre_hire_with',
                          'People creates the pre-hire with the terms, pay and start date',
                        )}
                      </li>
                    )}
                    <li>{tr('offers.onboarding_starts_the_plan', 'Onboarding starts the plan')}</li>
                    {props.with?.documents === false ? null : (
                      <li>
                        {tr(
                          'offers.documents_files_the_contract_once_they',
                          'Documents files the contract once they are a member',
                        )}
                      </li>
                    )}
                    {props.with?.timeoff === false ? null : (
                      <li>
                        {tr(
                          'offers.time_off_gives_the_entitlement_from',
                          'Time Off gives the entitlement from the hire',
                        )}
                      </li>
                    )}
                  </ul>
                </Card>
                {p !== null && p.state !== 'cancelled' && p.state !== 'started' ? (
                  <Card padded>
                    <h2 className="mb-2 font-semibold">
                      {tr('offers.hire_fell_through', 'Hire fell through?')}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {(['reneged', 'no_show', 'failed_condition'] as const).map((reason) => (
                        <Button
                          key={reason}
                          size="sm"
                          variant="secondary"
                          loading={act.pending}
                          onClick={() => {
                            act.run('CancelPrehire', {
                              applicationId: data.offer.applicationId,
                              input: { reason },
                            });
                          }}
                        >
                          {words(reason)}
                        </Button>
                      ))}
                    </div>
                  </Card>
                ) : null}
              </div>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
