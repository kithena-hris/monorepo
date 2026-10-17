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
} from '@reach/ui';
import { useState, type JSX } from 'react';

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
            title="Offers"
            description="Drafts, those waiting on an approver, those sent and those accepted."
          />
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.agreement aria-hidden />}
                  title="No offers yet"
                  description="An offer starts from a candidate’s application."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Base</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>State</TableHead>
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
                                Needs you
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
        title="New offer"
        description="Start with the pay and the dates; the terms composer comes next."
      />
      <Refusal error={act.error} />
      {application === '' ? (
        <Alert tone="warning" title="Start from an application">
          Open the candidate and make the offer from their application.
        </Alert>
      ) : null}
      <Card padded>
        <div className="grid gap-4 md:grid-cols-2">
          <NumberField label="Base pay (yearly)" value={base} min={0} onChange={setBase} />
          <Field>
            <FieldLabel>Currency</FieldLabel>
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
            <FieldLabel>Start date</FieldLabel>
            <FieldControl>
              <DatePicker
                label="Start date"
                value={start === '' ? null : start}
                onChange={(d) => {
                  setStart(d ?? '');
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>Offer expires</FieldLabel>
            <FieldControl>
              <DatePicker
                label="Offer expires"
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
            Create draft
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
          <CardTitle level={2}>Checks</CardTitle>
          <CardDescription>
            Run on every change, again before approval and before sending
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {c === null ? (
            <Alert tone="warning" title="Choose the job’s legal entity first">
              Checks need the country.
            </Alert>
          ) : null}
          {c !== null && c.terms !== null && c.checks.length === 0 && c.termsIssues.length === 0 ? (
            <Alert tone="success" title="Every check passes">
              Terms, pay band, pay equity and budget.
            </Alert>
          ) : null}
          {c?.termsIssues.map((i) => (
            <Alert
              key={`${i.step}:${i.code}`}
              tone={i.severity === 'error' ? 'danger' : 'warning'}
              title={words(i.step)}
            >
              {`${i.message} (${i.source})`}
            </Alert>
          ))}
          {c?.checks.map((k) => (
            <Alert
              key={k.code}
              tone={k.severity === 'error' ? 'danger' : 'warning'}
              title={k.severity === 'error' ? 'Blocks the offer' : 'Adds an approval step'}
            >
              {k.message}
            </Alert>
          ))}
          {c !== null && !c.packReviewed ? (
            <p className="text-xs text-fg-muted">
              This country pack is awaiting a country reviewer.
            </p>
          ) : null}
        </CardContent>
      </Card>
      {r === undefined ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Total rewards</CardTitle>
            <CardDescription>Added up by Kithena</CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValues
              items={[
                { label: 'Base', value: money(r.baseMinor, currency) },
                { label: 'Variable at target', value: money(r.variableMinor, currency) },
                { label: 'Benefits with a value', value: money(r.benefitsMinor, currency) },
                { label: 'Total', value: money(r.totalMinor, currency) },
                ...(r.descriptive.length === 0 && r.equityUnits === null
                  ? []
                  : [
                      {
                        label: 'Also',
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
  entity: 'Legal entity',
  location: 'Work location',
  relationship: 'Relationship',
  contract_type: 'Contract type',
  fixed_term_reason: 'Fixed-term reason',
  duration: 'Duration',
  hours: 'Hours',
  probation: 'Probation',
  notice: 'Notice',
  work_mode: 'Work mode',
  agreement: 'Collective agreement',
  pay: 'Pay',
  benefits: 'Benefits',
  clauses: 'Clauses',
  summary: 'Summary',
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
        <SelectTrigger aria-label={`${label}, unit`} className="w-32">
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
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.key} value={c.key} disabled={c.unavailable !== undefined}>
              {c.unavailable === undefined ? c.label : `${c.label} — ${c.unavailable}`}
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
      <Alert tone="warning" title="No country pack yet">
        Choose the job’s legal entity; its country decides what the composer offers.
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
      <nav aria-label="Steps" className="flex flex-col gap-1">
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
          <CardDescription>{`${c.country} pack ${c.version}${c.reviewed ? '' : ' · awaiting a country reviewer'}`}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Refusal error={act.error} />
          {current?.issues.map((i) => (
            <Alert
              key={i.code}
              tone={i.severity === 'error' ? 'danger' : 'warning'}
              title={i.severity === 'error' ? 'Not lawful' : 'Read and confirm'}
            >
              {`${i.message} (${i.source})`}
            </Alert>
          ))}
          {step === 'entity' ? (
            <p>{`${data.job.title} is hired through the job’s legal entity, in ${c.country}. Change it on the job.`}</p>
          ) : null}
          {step === 'location' ? (
            <Pick
              label="Region"
              value={answers.region}
              choices={c.regions}
              onChange={(v) => {
                set({ region: v });
              }}
            />
          ) : null}
          {step === 'relationship' ? (
            <Pick
              label="Relationship"
              value={answers.relationship}
              choices={c.relationships}
              onChange={(v) => {
                set({ relationship: v as NonNullable<TermsAnswers['relationship']> });
              }}
            />
          ) : null}
          {step === 'contract_type' ? (
            <Pick
              label="Contract type"
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
                label="Reason"
                value={answers.fixedTermReason}
                choices={c.reasons}
                onChange={(v) => {
                  set({ fixedTermReason: v });
                }}
              />
              {c.asksPreviousEmployment ? (
                <Field>
                  <FieldLabel>{`Has ${data.candidate.name} worked for this employer before?`}</FieldLabel>
                  <SegmentedControl
                    aria-label="Worked here before"
                    value={answers.previouslyEmployed === true ? 'yes' : 'no'}
                    onValueChange={(v) => {
                      set({ previouslyEmployed: v === 'yes' });
                    }}
                  >
                    <SegmentedControlItem value="no">No</SegmentedControlItem>
                    <SegmentedControlItem value="yes">Yes</SegmentedControlItem>
                  </SegmentedControl>
                </Field>
              ) : null}
            </>
          ) : null}
          {step === 'duration' ? (
            <Field>
              <FieldLabel>Ends on</FieldLabel>
              <FieldControl>
                <DatePicker
                  label="Ends on"
                  value={answers.contractEnd ?? null}
                  onChange={(d) => {
                    set({ contractEnd: d });
                  }}
                />
              </FieldControl>
              <FieldDescription>{`Starts ${day(version.startDate)}, from the offer’s dates. Leave empty for no end.`}</FieldDescription>
            </Field>
          ) : null}
          {step === 'hours' ? (
            <NumberField
              label="Hours a week"
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
                <label htmlFor="no-probation">No probation</label>
              </div>
              {answers.probation === null ? null : (
                <Length
                  label="Probation"
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
                label="Notice from the employee"
                value={answers.noticeEmployee}
                onChange={(v) => {
                  set({ noticeEmployee: v });
                }}
              />
              <Length
                label="Notice from the employer"
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
                aria-label="Work mode"
                value={answers.workMode ?? ''}
                onValueChange={(v) => {
                  set({ workMode: v as NonNullable<TermsAnswers['workMode']> });
                }}
              >
                <SegmentedControlItem value="onsite">On site</SegmentedControlItem>
                <SegmentedControlItem value="hybrid">Hybrid</SegmentedControlItem>
                <SegmentedControlItem value="remote">Remote</SegmentedControlItem>
              </SegmentedControl>
              {answers.workMode === 'hybrid' ? (
                <NumberField
                  label="Days on site a week"
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
                  <FieldLabel>Working from (country code)</FieldLabel>
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
                <FieldLabel>Agreement</FieldLabel>
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
                <FieldLabel>Group</FieldLabel>
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
                label={`Yearly pay (${version.pay.currency})`}
                value={answers.annualPayMinor === undefined ? null : answers.annualPayMinor / 100}
                min={0}
                onChange={(n) => {
                  set({ annualPayMinor: n === null ? undefined : Math.round(n * 100) });
                }}
              />
              {c.paymentsPerYear.length > 1 ? (
                <Pick
                  label="Payments a year"
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
              Chosen on the Benefits tab; statutory ones are included and locked.
            </p>
          ) : null}
          {step === 'clauses' ? (
            <>
              <NumberField
                label="Non-compete, months"
                value={answers.nonCompeteMonths ?? 0}
                min={0}
                max={36}
                onChange={(n) => {
                  set({ nonCompeteMonths: n === 0 ? null : n });
                }}
              />
              {(answers.nonCompeteMonths ?? 0) > 0 ? (
                <NumberField
                  label="Compensation during it, % of last pay"
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
                <label htmlFor="mobility">Mobility clause</label>
              </div>
            </>
          ) : null}
          {step === 'summary' ? (
            data.checked?.terms == null ? (
              <Alert tone="danger" title="Not ready">
                Every error above blocks the offer; fix the steps marked “!”.
              </Alert>
            ) : (
              <KeyValues
                items={[
                  {
                    label: 'Contract',
                    value: `${words(data.checked.terms.contractType)} · ${words(data.checked.terms.employmentType)}`,
                  },
                  {
                    label: 'Hours',
                    value: `${String(data.checked.terms.weeklyMinutes / 60)} h · FTE ${data.checked.terms.fte}`,
                  },
                  {
                    label: 'Signature',
                    value:
                      data.checked.terms.signature === 'wet_ink'
                        ? 'Wet ink: printed and signed by hand'
                        : 'Electronic',
                  },
                  {
                    label: 'Documents',
                    value: ['contract', ...data.checked.terms.documents].map(words).join(', '),
                  },
                  {
                    label: 'Before the start',
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
                  ? 'Save'
                  : `Save, then ${STEP_LABEL[next.step] ?? words(next.step)}`}
              </Button>
            </div>
          )}
          <p className="text-xs text-fg-muted">
            Changing an earlier answer re-checks every step after it.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Rules that applied</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {c.rules.filter((r) => r.step === step).length === 0 ? (
            <p className="text-sm text-fg-muted">None for this step.</p>
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
          <CardTitle level={2}>Compensation</CardTitle>
          <CardDescription>{pay.currency}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Refusal error={act.error} />
          <NumberField
            label="Base pay"
            value={major(pay.baseMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, baseMinor: minor(n) });
            }}
          />
          <Pick
            label="Per"
            value={pay.frequency}
            choices={['year', 'month', 'hour'].map((k) => ({ key: k, label: words(k) }))}
            onChange={(f) => {
              setPay({ ...pay, frequency: f as typeof pay.frequency });
            }}
          />
          <NumberField
            label="Variable at target"
            value={major(pay.variableTargetMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, variableTargetMinor: minor(n) });
            }}
          />
          <NumberField
            label="Sign-on bonus"
            value={major(pay.signOnMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, signOnMinor: minor(n) });
            }}
          />
          <NumberField
            label="Relocation"
            value={major(pay.relocationMinor)}
            min={0}
            onChange={(n) => {
              setPay({ ...pay, relocationMinor: minor(n) });
            }}
          />
          <NumberField
            label="Equity, units"
            value={pay.equity?.units ?? 0}
            min={0}
            onChange={(n) => {
              setPay({
                ...pay,
                equity:
                  (n ?? 0) === 0
                    ? null
                    : { description: pay.equity?.description ?? 'Options', units: n ?? 0 },
              });
            }}
          />
          <Field>
            <FieldLabel>Grade</FieldLabel>
            <Select value={grade} onValueChange={setGrade}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">No grade</SelectItem>
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
              <FieldLabel>Why outside the band</FieldLabel>
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
              Save pay
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
        <CardTitle level={2}>Benefits in this offer</CardTitle>
        <CardDescription>
          From the entity’s catalogue; statutory ones are included and locked
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Refusal error={act.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">Included</span>
              </TableHead>
              <TableHead>Benefit</TableHead>
              <TableHead>Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.benefits.map((b) => {
              const name = b.names['en'] ?? Object.values(b.names)[0] ?? words(b.key);
              return (
                <TableRow key={b.id}>
                  <TableCell>
                    {b.statutory ? (
                      <icons.locked aria-label="Statutory" />
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
            Save benefits
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
          <FieldLabel>Start date</FieldLabel>
          <FieldControl>
            <DatePicker
              label="Start date"
              value={start === '' ? null : start}
              onChange={(d) => {
                setStart(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>Offer expires</FieldLabel>
          <FieldControl>
            <DatePicker
              label="Offer expires"
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
          Save dates
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
    <Loaded load={props.load} what="the offer">
      {(data) => {
        const v = data.offer.versions.at(-1);
        const s = data.offer.state;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={`Offer: ${data.candidate.name}`}
              meta={
                <StateBadge state={s} label={`Version ${String(v?.version ?? 1)} · ${words(s)}`} />
              }
              description={`${data.job.title}${data.offer.versions.length > 1 ? ` · ${String(data.offer.versions.length - 1)} earlier version${data.offer.versions.length > 2 ? 's' : ''} kept` : ''}`}
              actions={
                <>
                  {s === 'draft' ? (
                    <Button
                      loading={act.pending}
                      onClick={() => {
                        act.run('SubmitOffer', { offerId: data.offer.id });
                      }}
                    >
                      Send for approval
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
                      Send to the candidate
                    </Button>
                  ) : null}
                  {s === 'accepted' ? (
                    <Button
                      onClick={() =>
                        props.onNavigate?.(`/recruiting/offers/${data.offer.id}/contract`)
                      }
                    >
                      Contract
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
                      Withdraw
                    </Button>
                  ) : null}
                </>
              }
            />
            <Refusal error={act.error} />
            {data.approval === null || s !== 'pending_approval' ? null : (
              <Alert
                tone="info"
                title={`Waiting on step ${String(data.approval.state.step + 1)} of ${String(data.approval.steps.length)}`}
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
    <Loaded load={props.load} what="the offer">
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
              title={`Approve offer: ${data.candidate.name}`}
              description={data.job.title}
              meta={<StateBadge state={data.offer.state} />}
            />
            <Refusal error={act.error} />
            <Card padded>
              <KeyValues
                items={[
                  { label: 'Job', value: data.job.title },
                  {
                    label: 'Terms',
                    value:
                      t == null
                        ? 'Not complete'
                        : `${words(t.contractType)} · ${String(t.weeklyMinutes / 60)} h a week`,
                  },
                  {
                    label: 'Base',
                    value:
                      v === undefined
                        ? '—'
                        : `${money(v.pay.baseMinor, v.pay.currency)} a ${v.pay.frequency}`,
                  },
                  { label: 'Start', value: day(v?.startDate ?? null) },
                ]}
              />
            </Card>
            {data.meta.outsideBandReason === null ? null : (
              <Alert tone="warning" title="Outside the band">
                {data.meta.outsideBandReason}
              </Alert>
            )}
            <Checks data={data} />
            <p className="text-xs text-fg-muted">
              You see the offer and its checks; nothing else about the candidate.
            </p>
            {data.approval?.mine === true ? (
              <Card padded>
                <Field>
                  <FieldLabel>Comment</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      value={comment}
                      onChange={(e) => {
                        setComment(e.target.value);
                      }}
                      placeholder="Optional. Required to reject."
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
                    Reject
                  </Button>
                  <Button
                    loading={act.pending}
                    onClick={() => {
                      decide('approved');
                    }}
                  >
                    Approve
                  </Button>
                </div>
              </Card>
            ) : (
              <Alert tone="info" title="Not waiting on you">
                Another approver holds this step.
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
  return (
    <Loaded load={props.load} what="the contract">
      {(data) => {
        const k = data.contract;
        const p = data.prehire;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={`Contract: ${data.candidate.name}`}
              description={
                data.offer.acceptance === null
                  ? data.job.title
                  : `${data.job.title} · offer v${String(data.offer.acceptance.version)} accepted ${day(data.offer.acceptance.at)} · version hash ${data.offer.acceptance.versionHash.slice(0, 8)}…`
              }
            />
            <Refusal error={act.error} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>Contract</CardTitle>
                    <CardDescription>
                      {k === null
                        ? 'Generated when the offer is accepted'
                        : `Pack ${k.packVersion}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {k === null ? (
                      <EmptyState icon={<icons.document aria-hidden />} title="No contract yet" />
                    ) : (
                      <KeyValues
                        items={[
                          { label: 'State', value: words(k.state) },
                          {
                            label: 'Signing',
                            value:
                              k.route === 'wet_ink'
                                ? 'Wet ink: printed, signed by hand by both, scan uploaded'
                                : k.route === 'documents'
                                  ? 'Through Documents'
                                  : 'Signed contract uploaded',
                          },
                          { label: 'Documents', value: k.documents.map(words).join(', ') },
                          {
                            label: 'Signed',
                            value: k.signedOn === null ? 'Not yet' : day(k.signedOn),
                          },
                        ]}
                      />
                    )}
                  </CardContent>
                </Card>
                {k !== null && k.state !== 'signed' && k.route !== 'documents' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle level={2}>Record the signed contract</CardTitle>
                      <CardDescription>
                        Upload the scan to Documents or the candidate’s files, then record it here.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                      <Field required>
                        <FieldLabel>File reference</FieldLabel>
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
                        <FieldLabel>Date of the second signature</FieldLabel>
                        <FieldControl>
                          <DatePicker
                            label="Date of the second signature"
                            value={signedOn === '' ? null : signedOn}
                            onChange={(d) => {
                              setSignedOn(d ?? '');
                            }}
                          />
                        </FieldControl>
                        <FieldDescription>Must be before the start date.</FieldDescription>
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
                          Record as signed
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>Pre-start conditions</CardTitle>
                    <CardDescription>
                      An open condition on the start date blocks the start
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {p === null || p.conditions.length === 0 ? (
                      <p className="text-sm text-fg-muted">None.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Condition</TableHead>
                            <TableHead>State</TableHead>
                            <TableHead>
                              <span className="sr-only">Decide</span>
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
                  <h2 className="mb-2 font-semibold">When it’s signed</h2>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                    {props.with?.people === false ? (
                      <li>The hired webhook carries the hire to any HRIS</li>
                    ) : (
                      <li>People creates the pre-hire with the terms, pay and start date</li>
                    )}
                    <li>Onboarding starts the plan</li>
                    {props.with?.documents === false ? null : (
                      <li>Documents files the contract once they are a member</li>
                    )}
                    {props.with?.timeoff === false ? null : (
                      <li>Time Off gives the entitlement from the hire</li>
                    )}
                  </ul>
                </Card>
                {p !== null && p.state !== 'cancelled' && p.state !== 'started' ? (
                  <Card padded>
                    <h2 className="mb-2 font-semibold">Hire fell through?</h2>
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
