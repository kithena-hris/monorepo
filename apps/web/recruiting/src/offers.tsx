import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  NumberField,
  PageHeader,
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
  Textarea,
  icons,
  DatePicker,
  FileUploader,
  type UploadItem,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, day, money, useAct, words } from './shared';
import type {
  OfferData,
  OffersData,
  OfferVersion,
  ScreenProps,
  TermLength,
  TermsAnswers,
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
                      <TableRow key={r.id}>
                        <TableCell>
                          <To
                            href={
                              r.needsMe
                                ? `/recruiting/offers/${r.id}/approve`
                                : `/recruiting/offers/${r.id}`
                            }
                            onNavigate={props.onNavigate}
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
        </div>
      )}
    </Loaded>
  );
}

const plusDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** The version's body as ComposeOffer takes it, with what changed laid over. */
function input(
  v: OfferVersion,
  meta: OfferData['meta'],
  patch: Partial<OfferVersion> & { grade?: string | null; outsideBandReason?: string | null } = {},
) {
  const { grade, outsideBandReason, ...rest } = patch;
  const next = { ...v, ...rest };
  return {
    terms: next.terms,
    pay: next.pay,
    benefitIds: next.benefitIds,
    startDate: next.startDate,
    expiresOn: next.expiresOn,
    letterTemplateId: next.letterTemplateId,
    grade: grade === undefined ? meta.grade : grade,
    outsideBandReason: outsideBandReason === undefined ? meta.outsideBandReason : outsideBandReason,
  };
}

function NewOffer(props: ScreenProps<OfferData>): JSX.Element {
  const act = useAct(props);
  const application = props.search?.['application'] ?? '';
  const [base, setBase] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>('EUR');
  const [start, setStart] = useState(plusDays(60));
  const [expires, setExpires] = useState(plusDays(10));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={tr('offers.new_offer', 'New offer')}
        description={tr(
          'offers.start_with_the_pay_and_the',
          'Start with the pay and the dates; the terms composer comes next.',
        )}
      />
      <Refusal error={act.error} />
      {application === '' ? (
        <Alert
          tone="warning"
          title={tr('offers.start_from_an_application', 'Start from an application')}
        >
          {tr(
            'offers.open_the_candidate_and_make_the',
            'Open the candidate and make the offer from their application.',
          )}
        </Alert>
      ) : null}
      <Card padded>
        <div className="grid gap-4 md:grid-cols-2">
          <NumberField
            label={tr('offers.base_pay_yearly', 'Base pay (yearly)')}
            value={base}
            min={0}
            onChange={setBase}
          />
          <Field>
            <FieldLabel>{tr('offers.currency', 'Currency')}</FieldLabel>
            <Select value={currency} onValueChange={setCurrency}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field required>
            <FieldLabel>{tr('offers.start_date', 'Start date')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('offers.start_date', 'Start date')}
                value={start === '' ? null : start}
                onChange={(d) => {
                  setStart(d ?? '');
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('offers.offer_expires', 'Offer expires')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('offers.offer_expires', 'Offer expires')}
                value={expires === '' ? null : expires}
                onChange={(d) => {
                  setExpires(d ?? '');
                }}
              />
            </FieldControl>
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            disabled={application === '' || base === null}
            loading={act.pending}
            onClick={() => {
              act.run(
                'ComposeOffer',
                {
                  applicationId: application,
                  input: {
                    terms: {},
                    pay: {
                      baseMinor: Math.round((base ?? 0) * 100),
                      currency,
                      frequency: 'year',
                      variableTargetMinor: 0,
                      signOnMinor: 0,
                      relocationMinor: 0,
                      equity: null,
                    },
                    benefitIds: [],
                    startDate: start,
                    expiresOn: expires,
                    letterTemplateId: null,
                    grade: null,
                    outsideBandReason: null,
                  },
                },
                (offer) =>
                  props.onNavigate?.(
                    `/recruiting/offers/${(offer as { id: string }).id}?tab=terms`,
                  ),
              );
            }}
          >
            {tr('offers.create_draft', 'Create draft')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

const TABS = ['terms', 'pay', 'benefits', 'dates'] as const;
type Tab = (typeof TABS)[number];

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
    <div className="flex items-end gap-2">
      <NumberField
        label={label}
        value={v.count}
        min={0}
        onChange={(n) => {
          onChange({ ...v, count: n ?? 0 });
        }}
      />
      <Select
        value={v.unit}
        onValueChange={(u) => {
          onChange({ ...v, unit: u as TermLength['unit'] });
        }}
      >
        <SelectTrigger
          aria-label={tr('offers.unit', '{{label}}, unit', { label })}
          className="w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(['days', 'weeks', 'months'] as const).map((u) => (
            <SelectItem key={u} value={u}>
              {words(u)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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

/** R21: fifteen steps, each one's options from the pack for the answers above it. */
function Composer({
  data,
  props,
}: {
  readonly data: OfferData;
  readonly props: ScreenProps<OfferData>;
}): JSX.Element {
  const act = useAct(props);
  const version = data.offer.versions.at(-1);
  const [answers, setAnswers] = useState<TermsAnswers>(version?.terms ?? {});
  const c = data.composer;
  if (c === null || version === undefined)
    return (
      <Alert tone="warning" title={tr('offers.no_country_pack_yet', 'No country pack yet')}>
        {tr(
          'offers.choose_the_jobs_legal_entity_its',
          'Choose the job’s legal entity; its country decides what the composer offers.',
        )}
      </Alert>
    );
  const steps = c.steps.filter((s) => s.state !== 'skipped');
  const current =
    steps.find((s) => s.step === props.search?.['step']) ??
    steps.find((s) => s.state !== 'done') ??
    steps[0];
  const set = (patch: TermsAnswers) => {
    setAnswers({ ...answers, ...patch });
  };
  const editable =
    data.offer.state === 'draft' || data.offer.state === 'approved' || data.offer.state === 'sent';
  const next = steps[steps.findIndex((s) => s.step === current?.step) + 1];
  const save = () => {
    act.run(
      'ComposeOffer',
      {
        applicationId: data.offer.applicationId,
        input: input(version, data.meta, { terms: answers }),
      },
      () => {
        if (next !== undefined) props.onFilter?.({ step: next.step });
      },
    );
  };
  const hours = answers.weeklyMinutes === undefined ? null : answers.weeklyMinutes / 60;
  const step = current?.step ?? 'summary';
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      <nav aria-label={tr('offers.steps', 'Steps')} className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <a
            key={s.step}
            href={`?tab=terms&step=${s.step}`}
            aria-current={s.step === step ? 'step' : undefined}
            className="flex items-center gap-2 rounded-[var(--reach-radius-md)] px-2 py-1.5 text-sm hover:bg-[var(--reach-fill)] aria-[current=step]:bg-[var(--reach-accent-soft)]"
            onClick={(e) => {
              if (props.onFilter === undefined) return;
              e.preventDefault();
              props.onFilter({ step: s.step });
            }}
          >
            <Badge
              size="sm"
              tone={s.state === 'done' ? 'success' : s.state === 'invalid' ? 'warning' : 'neutral'}
            >
              {s.state === 'done' ? '✓' : s.state === 'invalid' ? '!' : String(i + 1)}
            </Badge>
            <span>{STEP_LABEL[s.step] ?? words(s.step)}</span>
          </a>
        ))}
      </nav>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{STEP_LABEL[step] ?? words(step)}</CardTitle>
          <CardDescription>
            {c.reviewed
              ? tr('offers.pack', '{{country}} pack {{version}}', {
                  country: c.country,
                  version: c.version,
                })
              : tr(
                  'offers.pack_awaiting_reviewer',
                  '{{country}} pack {{version}} · awaiting a country reviewer',
                  {
                    country: c.country,
                    version: c.version,
                  },
                )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Refusal error={act.error} />
          {current?.issues.map((i) => (
            <Alert
              key={i.code}
              tone={i.severity === 'error' ? 'danger' : 'warning'}
              title={
                i.severity === 'error'
                  ? tr('offers.not_lawful', 'Not lawful')
                  : tr('offers.read_and_confirm', 'Read and confirm')
              }
            >
              {tr('offers.text', '{{message}} ({{source}})', {
                message: i.message,
                source: i.source,
              })}
            </Alert>
          ))}
          {step === 'entity' ? (
            <p>
              {tr(
                'offers.is_hired_through_the_jobs_legal',
                '{{title}} is hired through the job’s legal entity, in {{country}}. Change it on the job.',
                { title: data.job.title, country: c.country },
              )}
            </p>
          ) : null}
          {step === 'location' ? (
            <Pick
              label={tr('offers.region', 'Region')}
              value={answers.region}
              choices={c.regions}
              onChange={(v) => {
                set({ region: v });
              }}
            />
          ) : null}
          {step === 'relationship' ? (
            <Pick
              label={tr('offers.relationship', 'Relationship')}
              value={answers.relationship}
              choices={c.relationships}
              onChange={(v) => {
                set({ relationship: v as NonNullable<TermsAnswers['relationship']> });
              }}
            />
          ) : null}
          {step === 'contract_type' ? (
            <Pick
              label={tr('offers.contract_type', 'Contract type')}
              value={answers.contractType}
              choices={c.contractTypes}
              onChange={(v) => {
                set({ contractType: v });
              }}
            />
          ) : null}
          {step === 'fixed_term_reason' ? (
            <>
              <Pick
                label={tr('offers.reason', 'Reason')}
                value={answers.fixedTermReason}
                choices={c.reasons}
                onChange={(v) => {
                  set({ fixedTermReason: v });
                }}
              />
              {c.asksPreviousEmployment ? (
                <Field>
                  <FieldLabel>
                    {tr(
                      'offers.has_worked_for_this_employer_before',
                      'Has {{name}} worked for this employer before?',
                      { name: data.candidate.name },
                    )}
                  </FieldLabel>
                  <SegmentedControl
                    aria-label={tr('offers.worked_here_before', 'Worked here before')}
                    value={answers.previouslyEmployed === true ? 'yes' : 'no'}
                    onValueChange={(v) => {
                      set({ previouslyEmployed: v === 'yes' });
                    }}
                  >
                    <SegmentedControlItem value="no">{tr('offers.no', 'No')}</SegmentedControlItem>
                    <SegmentedControlItem value="yes">
                      {tr('offers.yes', 'Yes')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                </Field>
              ) : null}
            </>
          ) : null}
          {step === 'duration' ? (
            <Field>
              <FieldLabel>{tr('offers.ends_on', 'Ends on')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={tr('offers.ends_on', 'Ends on')}
                  value={answers.contractEnd ?? null}
                  onChange={(d) => {
                    set({ contractEnd: d });
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {tr(
                  'offers.starts_from_the_offers_dates_leave',
                  'Starts {{startDate}}, from the offer’s dates. Leave empty for no end.',
                  { startDate: day(version.startDate) },
                )}
              </FieldDescription>
            </Field>
          ) : null}
          {step === 'hours' ? (
            <NumberField
              label={tr('offers.hours_a_week', 'Hours a week')}
              value={hours}
              min={1}
              max={60}
              step={0.5}
              onChange={(n) => {
                set({ weeklyMinutes: n === null ? undefined : Math.round(n * 60) });
              }}
            />
          ) : null}
          {step === 'probation' ? (
            <>
              <div className="flex items-center gap-3">
                <Switch
                  id="no-probation"
                  checked={answers.probation === null}
                  onCheckedChange={(on) => {
                    set({ probation: on ? null : { count: 6, unit: 'months' } });
                  }}
                />
                <label htmlFor="no-probation">{tr('offers.no_probation', 'No probation')}</label>
              </div>
              {answers.probation === null ? null : (
                <Length
                  label={tr('offers.probation', 'Probation')}
                  value={answers.probation}
                  onChange={(v) => {
                    set({ probation: v });
                  }}
                />
              )}
            </>
          ) : null}
          {step === 'notice' ? (
            <>
              <Length
                label={tr('offers.notice_from_the_employee', 'Notice from the employee')}
                value={answers.noticeEmployee}
                onChange={(v) => {
                  set({ noticeEmployee: v });
                }}
              />
              <Length
                label={tr('offers.notice_from_the_employer', 'Notice from the employer')}
                value={answers.noticeEmployer}
                onChange={(v) => {
                  set({ noticeEmployer: v });
                }}
              />
            </>
          ) : null}
          {step === 'work_mode' ? (
            <>
              <SegmentedControl
                aria-label={tr('offers.work_mode', 'Work mode')}
                value={answers.workMode ?? ''}
                onValueChange={(v) => {
                  set({ workMode: v as NonNullable<TermsAnswers['workMode']> });
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
              {answers.workMode === 'hybrid' ? (
                <NumberField
                  label={tr('offers.days_on_site_a_week', 'Days on site a week')}
                  value={answers.hybridDaysOnsite ?? null}
                  min={1}
                  max={5}
                  onChange={(n) => {
                    set({ hybridDaysOnsite: n });
                  }}
                />
              ) : null}
              {answers.workMode === 'remote' ? (
                <Field>
                  <FieldLabel>
                    {tr('offers.working_from_country_code', 'Working from (country code)')}
                  </FieldLabel>
                  <FieldControl>
                    <Input
                      maxLength={2}
                      value={answers.remoteCountry ?? ''}
                      onChange={(e) => {
                        set({
                          remoteCountry:
                            e.target.value === '' ? null : e.target.value.toUpperCase(),
                        });
                      }}
                    />
                  </FieldControl>
                </Field>
              ) : null}
            </>
          ) : null}
          {step === 'agreement' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>{tr('offers.agreement', 'Agreement')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={answers.agreement?.key ?? ''}
                    onChange={(e) => {
                      set({
                        agreement:
                          e.target.value === ''
                            ? null
                            : { key: e.target.value, group: answers.agreement?.group ?? null },
                      });
                    }}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{tr('offers.group', 'Group')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={answers.agreement?.group ?? ''}
                    disabled={answers.agreement == null}
                    onChange={(e) => {
                      set({
                        agreement: {
                          key: answers.agreement?.key ?? '',
                          group: e.target.value === '' ? null : e.target.value,
                        },
                      });
                    }}
                  />
                </FieldControl>
              </Field>
            </div>
          ) : null}
          {step === 'pay' ? (
            <>
              <NumberField
                label={tr('offers.yearly_pay', 'Yearly pay ({{currency}})', {
                  currency: version.pay.currency,
                })}
                value={answers.annualPayMinor === undefined ? null : answers.annualPayMinor / 100}
                min={0}
                onChange={(n) => {
                  set({ annualPayMinor: n === null ? undefined : Math.round(n * 100) });
                }}
              />
              {c.paymentsPerYear.length > 1 ? (
                <Pick
                  label={tr('offers.payments_a_year', 'Payments a year')}
                  value={String(answers.paymentsPerYear ?? c.paymentsPerYear[0])}
                  choices={c.paymentsPerYear.map((n) => ({ key: String(n), label: String(n) }))}
                  onChange={(v) => {
                    set({ paymentsPerYear: Number(v) });
                  }}
                />
              ) : null}
            </>
          ) : null}
          {step === 'benefits' ? (
            <p className="text-sm">
              {tr(
                'offers.chosen_on_the_benefits_tab_statutory',
                'Chosen on the Benefits tab; statutory ones are included and locked.',
              )}
            </p>
          ) : null}
          {step === 'clauses' ? (
            <>
              <NumberField
                label={tr('offers.non_compete_months', 'Non-compete, months')}
                value={answers.nonCompeteMonths ?? 0}
                min={0}
                max={36}
                onChange={(n) => {
                  set({ nonCompeteMonths: n === 0 ? null : n });
                }}
              />
              {(answers.nonCompeteMonths ?? 0) > 0 ? (
                <NumberField
                  label={tr(
                    'offers.compensation_during_it_of_last_pay',
                    'Compensation during it, % of last pay',
                  )}
                  value={answers.nonCompeteCompensationPercent ?? null}
                  min={0}
                  max={100}
                  onChange={(n) => {
                    set({ nonCompeteCompensationPercent: n });
                  }}
                />
              ) : null}
              <div className="flex items-center gap-3">
                <Switch
                  id="mobility"
                  checked={answers.mobilityClause === true}
                  onCheckedChange={(on) => {
                    set({ mobilityClause: on });
                  }}
                />
                <label htmlFor="mobility">{tr('offers.mobility_clause', 'Mobility clause')}</label>
              </div>
            </>
          ) : null}
          {step === 'summary' ? (
            data.checked?.terms == null ? (
              <Alert tone="danger" title={tr('offers.not_ready', 'Not ready')}>
                {tr(
                  'offers.every_error_above_blocks_the_offer',
                  'Every error above blocks the offer; fix the steps marked “!”.',
                )}
              </Alert>
            ) : (
              <KeyValues
                items={[
                  {
                    label: tr('offers.contract', 'Contract'),
                    value: `${words(data.checked.terms.contractType)} · ${words(data.checked.terms.employmentType)}`,
                  },
                  {
                    label: tr('offers.hours', 'Hours'),
                    value: `${String(data.checked.terms.weeklyMinutes / 60)} h · FTE ${data.checked.terms.fte}`,
                  },
                  {
                    label: tr('offers.signature', 'Signature'),
                    value:
                      data.checked.terms.signature === 'wet_ink'
                        ? tr(
                            'offers.wet_ink_printed_and_signed_by',
                            'Wet ink: printed and signed by hand',
                          )
                        : 'Electronic',
                  },
                  {
                    label: tr('offers.documents', 'Documents'),
                    value: ['contract', ...data.checked.terms.documents].map(words).join(', '),
                  },
                  {
                    label: tr('offers.before_the_start', 'Before the start'),
                    value: data.checked.terms.conditions.map(words).join(', ') || '—',
                  },
                ]}
              />
            )
          ) : null}
          {step === 'summary' || step === 'entity' || step === 'benefits' ? null : (
            <div className="flex justify-end gap-2">
              <Button disabled={!editable} loading={act.pending} onClick={save}>
                {next === undefined
                  ? tr('offers.save', 'Save')
                  : tr('offers.save_then', 'Save, then {{value}}', {
                      value: STEP_LABEL[next.step] ?? words(next.step),
                    })}
              </Button>
            </div>
          )}
          <p className="text-xs text-fg-muted">
            {tr(
              'offers.changing_an_earlier_answer_re_checks',
              'Changing an earlier answer re-checks every step after it.',
            )}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('offers.rules_that_applied', 'Rules that applied')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {c.rules.filter((r) => r.step === step).length === 0 ? (
            <p className="text-sm text-fg-muted">
              {tr('offers.none_for_this_step', 'None for this step.')}
            </p>
          ) : null}
          {c.rules
            .filter((r) => r.step === step)
            .map((r) => (
              <div
                key={r.text}
                className="flex flex-col gap-1 border-b border-[var(--reach-line)] pb-2"
              >
                <span className="text-sm">{r.text}</span>
                <span className="font-mono text-xs text-fg-muted">{r.source}</span>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PayTab({
  data,
  props,
}: {
  readonly data: OfferData;
  readonly props: ScreenProps<OfferData>;
}): JSX.Element | null {
  const act = useAct(props);
  const v = data.offer.versions.at(-1);
  const [pay, setPay] = useState(v?.pay);
  const [grade, setGrade] = useState(data.meta.grade ?? 'none');
  const [reason, setReason] = useState(data.meta.outsideBandReason ?? '');
  if (v === undefined || pay === undefined) return null;
  const major = (minor: number) => minor / 100;
  const minor = (n: number | null) => Math.round((n ?? 0) * 100);
  const outside = data.checked?.checks.some((c) => c.code === 'outside_band') === true;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('offers.compensation', 'Compensation')}</CardTitle>
          <CardDescription>{pay.currency}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Refusal error={act.error} />
          <NumberField
            label={tr('offers.base_pay', 'Base pay')}
            value={major(pay.baseMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, baseMinor: minor(n) });
            }}
          />
          <Pick
            label={tr('offers.per', 'Per')}
            value={pay.frequency}
            choices={['year', 'month', 'hour'].map((k) => ({ key: k, label: words(k) }))}
            onChange={(f) => {
              setPay({ ...pay, frequency: f as typeof pay.frequency });
            }}
          />
          <NumberField
            label={tr('offers.variable_at_target', 'Variable at target')}
            value={major(pay.variableTargetMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, variableTargetMinor: minor(n) });
            }}
          />
          <NumberField
            label={tr('offers.sign_on_bonus', 'Sign-on bonus')}
            value={major(pay.signOnMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, signOnMinor: minor(n) });
            }}
          />
          <NumberField
            label={tr('offers.relocation', 'Relocation')}
            value={major(pay.relocationMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, relocationMinor: minor(n) });
            }}
          />
          <NumberField
            label={tr('offers.equity_units', 'Equity, units')}
            value={pay.equity?.units ?? 0}
            min={0}
            onChange={(n) => {
              setPay({
                ...pay,
                equity:
                  (n ?? 0) === 0
                    ? null
                    : {
                        description: pay.equity?.description ?? tr('offers.options', 'Options'),
                        units: n ?? 0,
                      },
              });
            }}
          />
          <Field>
            <FieldLabel>{tr('offers.grade', 'Grade')}</FieldLabel>
            <Select value={grade} onValueChange={setGrade}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">{tr('offers.no_grade', 'No grade')}</SelectItem>
                {[...new Set(data.bands.map((b) => b.grade))].map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {outside || reason !== '' ? (
            <Field className="md:col-span-2">
              <FieldLabel>{tr('offers.why_outside_the_band', 'Why outside the band')}</FieldLabel>
              <FieldControl>
                <Textarea
                  autoResize
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
          ) : null}
          <div className="flex justify-end md:col-span-2">
            <Button
              loading={act.pending}
              onClick={() => {
                act.run('ComposeOffer', {
                  applicationId: data.offer.applicationId,
                  input: input(v, data.meta, {
                    pay,
                    grade: grade === 'none' ? null : grade,
                    outsideBandReason: reason === '' ? null : reason,
                  }),
                });
              }}
            >
              {tr('offers.save_pay', 'Save pay')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Checks data={data} />
    </div>
  );
}

function BenefitsTab({
  data,
  props,
}: {
  readonly data: OfferData;
  readonly props: ScreenProps<OfferData>;
}): JSX.Element | null {
  const act = useAct(props);
  const v = data.offer.versions.at(-1);
  const [chosen, setChosen] = useState<readonly string[]>(v?.benefitIds ?? []);
  if (v === undefined) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>
          {tr('offers.benefits_in_this_offer', 'Benefits in this offer')}
        </CardTitle>
        <CardDescription>
          {tr(
            'offers.from_the_entitys_catalogue_statutory_ones',
            'From the entity’s catalogue; statutory ones are included and locked',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">{tr('offers.included', 'Included')}</span>
              </TableHead>
              <TableHead>{tr('offers.benefit', 'Benefit')}</TableHead>
              <TableHead>{tr('offers.category', 'Category')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.benefits.map((b) => {
              const name = b.names['en'] ?? Object.values(b.names)[0] ?? words(b.key);
              return (
                <TableRow key={b.id}>
                  <TableCell>
                    {b.statutory ? (
                      <icons.locked aria-label={tr('offers.statutory', 'Statutory')} />
                    ) : (
                      <Checkbox
                        aria-label={name}
                        checked={chosen.includes(b.id)}
                        onCheckedChange={(on) => {
                          setChosen(
                            on === true ? [...chosen, b.id] : chosen.filter((x) => x !== b.id),
                          );
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{name}</TableCell>
                  <TableCell className="text-sm text-fg-muted">{words(b.category)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Button
            loading={act.pending}
            onClick={() => {
              act.run('ComposeOffer', {
                applicationId: data.offer.applicationId,
                input: input(v, data.meta, { benefitIds: chosen }),
              });
            }}
          >
            {tr('offers.save_benefits', 'Save benefits')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DatesTab({
  data,
  props,
}: {
  readonly data: OfferData;
  readonly props: ScreenProps<OfferData>;
}): JSX.Element | null {
  const act = useAct(props);
  const v = data.offer.versions.at(-1);
  const [start, setStart] = useState(v?.startDate ?? '');
  const [expires, setExpires] = useState(v?.expiresOn ?? '');
  if (v === undefined) return null;
  return (
    <Card padded>
      <Refusal error={act.error} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field required>
          <FieldLabel>{tr('offers.start_date', 'Start date')}</FieldLabel>
          <FieldControl>
            <DatePicker
              label={tr('offers.start_date', 'Start date')}
              value={start === '' ? null : start}
              onChange={(d) => {
                setStart(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>{tr('offers.offer_expires', 'Offer expires')}</FieldLabel>
          <FieldControl>
            <DatePicker
              label={tr('offers.offer_expires', 'Offer expires')}
              value={expires === '' ? null : expires}
              onChange={(d) => {
                setExpires(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          loading={act.pending}
          onClick={() => {
            act.run('ComposeOffer', {
              applicationId: data.offer.applicationId,
              input: input(v, data.meta, { startDate: start, expiresOn: expires }),
            });
          }}
        >
          {tr('offers.save_dates', 'Save dates')}
        </Button>
      </div>
    </Card>
  );
}

/** R19: the offer, its versions and checks; the composer is its first tab. */
export function Offer(props: ScreenProps<OfferData>): JSX.Element {
  const act = useAct(props);
  if (props.params?.['id'] === 'new') return <NewOffer {...props} />;
  const tab: Tab = TABS.find((t) => t === props.search?.['tab']) ?? 'terms';
  return (
    <Loaded load={props.load} what={tr('offers.the_offer', 'the offer')}>
      {(data) => {
        const v = data.offer.versions.at(-1);
        const s = data.offer.state;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={tr('offers.offer', 'Offer: {{name}}', { name: data.candidate.name })}
              meta={
                <StateBadge
                  state={s}
                  label={tr('offers.version', 'Version {{value}} · {{s}}', {
                    value: String(v?.version ?? 1),
                    s: words(s),
                  })}
                />
              }
              description={
                data.offer.versions.length > 1
                  ? tr(
                      'offers.title_earlier_versions_kept',
                      {
                        one: '{{title}} · {{count}} earlier version kept',
                        other: '{{title}} · {{count}} earlier versions kept',
                      },
                      {
                        title: data.job.title,
                        count: data.offer.versions.length - 1,
                      },
                    )
                  : data.job.title
              }
              actions={
                <>
                  {s === 'draft' ? (
                    <Button
                      loading={act.pending}
                      onClick={() => {
                        act.run('SubmitOffer', { offerId: data.offer.id });
                      }}
                    >
                      {tr('offers.send_for_approval', 'Send for approval')}
                    </Button>
                  ) : null}
                  {s === 'approved' ? (
                    <Button
                      loading={act.pending}
                      startIcon={<icons.send aria-hidden />}
                      onClick={() => {
                        act.run('SendOffer', { offerId: data.offer.id });
                      }}
                    >
                      {tr('offers.send_to_the_candidate', 'Send to the candidate')}
                    </Button>
                  ) : null}
                  {s === 'accepted' ? (
                    <Button
                      onClick={() =>
                        props.onNavigate?.(`/recruiting/offers/${data.offer.id}/contract`)
                      }
                    >
                      {tr('offers.contract', 'Contract')}
                    </Button>
                  ) : null}
                  {s === 'draft' || s === 'pending_approval' || s === 'approved' || s === 'sent' ? (
                    <Button
                      variant="secondary"
                      loading={act.pending}
                      onClick={() => {
                        act.run('WithdrawOffer', { offerId: data.offer.id });
                      }}
                    >
                      {tr('offers.withdraw', 'Withdraw')}
                    </Button>
                  ) : null}
                </>
              }
            />
            <Refusal error={act.error} />
            {s === 'declined' ? (
              <Alert
                tone="warning"
                title={tr('offers.declined_version', '{{name}} declined version {{version}}', {
                  name: data.candidate.name,
                  version: String(v?.version ?? 1),
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
                    'offers.change_the_terms_and_send_again',
                    'Change the terms below and save: that makes a new version, which goes through approval and to {{name}} again. The declined one is kept.',
                    { name: data.candidate.name },
                  )}
                </p>
              </Alert>
            ) : null}
            {s === 'accepted' ? (
              <Alert
                tone="success"
                title={tr('offers.accepted_hired', '{{name}} accepted and is hired', {
                  name: data.candidate.name,
                })}
              >
                {tr(
                  'offers.prepare_the_contract_next',
                  'Next, prepare the contract and send it to sign. Once it is signed, {{name}} is handed on to People.',
                  { name: data.candidate.name },
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
            <Tabs
              value={tab}
              onValueChange={(t) => props.onFilter?.({ tab: t === 'terms' ? null : t, step: null })}
            >
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {words(t)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="terms">
                <Composer data={data} props={props} />
              </TabsContent>
              <TabsContent value="pay">
                <PayTab data={data} props={props} />
              </TabsContent>
              <TabsContent value="benefits">
                <BenefitsTab data={data} props={props} />
              </TabsContent>
              <TabsContent value="dates">
                <DatesTab data={data} props={props} />
              </TabsContent>
            </Tabs>
          </div>
        );
      }}
    </Loaded>
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
            () => props.onNavigate?.('/recruiting/offers'),
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
                    disabled={comment.trim() === ''}
                    loading={act.pending}
                    onClick={() => {
                      decide('rejected');
                    }}
                  >
                    {tr('offers.reject', 'Reject')}
                  </Button>
                  <Button
                    loading={act.pending}
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
      if (id !== undefined) props.onNavigate?.(`/documents/${id}`);
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
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-fg-muted">
                          {tr(
                            'offers.drawn_from_the_accepted_terms_signs',
                            'Drawn from the accepted terms; {{name}} signs first with an emailed code, then you for the company.',
                            { name: data.candidate.name },
                          )}
                        </p>
                        <Button
                          loading={act.pending}
                          onClick={() => {
                            act.run('SendContract', { offerId: data.offer.id }, (made) => {
                              const id = (made as { id?: string } | null)?.id;
                              if (id !== undefined) props.onNavigate?.(`/documents/${id}`);
                            });
                          }}
                        >
                          {tr('offers.send_to_sign', 'Send to sign')}
                        </Button>
                      </div>
                    ) : null}
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
                      <div className="flex justify-end md:col-span-2">
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
