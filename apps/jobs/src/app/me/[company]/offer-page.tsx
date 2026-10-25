'use client';

import {
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
  ChatTyping,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  IconList,
  IconListItem,
  KeyValues,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  Spinner,
  Stat,
  Textarea,
  icons,
} from '@reach/ui';
import { locale } from '@reach/ui/intl';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi } from '../../../lib/browser-api';
import { t as tr } from '../../../lib/i18n';

interface Length {
  readonly count: number;
  readonly unit: 'days' | 'weeks' | 'months';
}

interface Version {
  readonly version: number;
  readonly startDate: string;
  readonly expiresOn: string;
  readonly pay: {
    readonly baseMinor: number;
    readonly currency: string;
    readonly frequency: 'year' | 'month' | 'hour';
    readonly variableTargetMinor: number;
    readonly signOnMinor: number;
    readonly relocationMinor?: number;
    readonly equity?: { readonly description: string; readonly units: number } | null;
  };
  readonly terms: {
    readonly contractType?: string;
    readonly contractEnd?: string | null;
    readonly weeklyMinutes?: number;
    readonly probation?: Length | null;
    readonly noticeEmployee?: Length;
    readonly workMode?: 'onsite' | 'hybrid' | 'remote';
    readonly hybridDaysOnsite?: number | null;
    readonly paymentsPerYear?: number;
  };
}

interface OfferRead {
  readonly offer: {
    readonly id: string;
    readonly state: string;
    readonly declineReason?: string | null;
    readonly versions: readonly Version[];
  };
  readonly hash: string;
  readonly setting?: {
    readonly job: { readonly title: string };
    /** The contract by the employer's country: its name, the relationship and the paid leave the law gives. */
    readonly contract?: {
      readonly contract: string | null;
      readonly relationship: string | null;
      readonly leave: {
        readonly days: number;
        readonly unit: 'working_days' | 'calendar_days';
        readonly source: string;
      };
    } | null;
    readonly company: { readonly name: string; readonly logoUrl: string | null };
    readonly benefits: readonly {
      readonly id: string;
      readonly name: string;
      readonly description: string | null;
    }[];
  };
}

const money = (minor: number, currency: string): string =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );

/** "24 Dec 2026", for a tile, where the long form wraps onto three lines. */
const shortDay = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const day = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "3 months", "1 week", in the reader's language. */
function lengthOf(l: Length | null | undefined): string {
  if (l == null) return tr('app.me.[company].offer-page.none', 'None');
  if (l.unit === 'days')
    return tr(
      'app.me.[company].offer-page.days',
      { one: '{{count}} day', other: '{{count}} days' },
      { count: l.count },
    );
  if (l.unit === 'weeks')
    return tr(
      'app.me.[company].offer-page.weeks',
      { one: '{{count}} week', other: '{{count}} weeks' },
      { count: l.count },
    );
  return tr(
    'app.me.[company].offer-page.months',
    { one: '{{count}} month', other: '{{count}} months' },
    { count: l.count },
  );
}

function contractOf(kind: string | undefined): string {
  switch (kind) {
    case 'permanent':
      return tr('app.me.[company].offer-page.permanent', 'Permanent');
    case 'fixed_term':
      return tr('app.me.[company].offer-page.fixed_term', 'Fixed term');
    case 'contractor':
      return tr('app.me.[company].offer-page.contractor', 'Contractor');
    case 'intern':
      return tr('app.me.[company].offer-page.internship', 'Internship');
    case 'apprentice':
      return tr('app.me.[company].offer-page.apprenticeship', 'Apprenticeship');
    case 'seasonal':
      return tr('app.me.[company].offer-page.seasonal', 'Seasonal');
    default:
      return '—';
  }
}

function modeOf(v: Version): string {
  switch (v.terms.workMode) {
    case 'onsite':
      return tr('app.me.[company].offer-page.on_site', 'On site');
    case 'remote':
      return tr('app.me.[company].offer-page.remote', 'Remote');
    case 'hybrid':
      return v.terms.hybridDaysOnsite == null
        ? tr('app.me.[company].offer-page.hybrid', 'Hybrid')
        : tr(
            'app.me.[company].offer-page.hybrid_days',
            {
              one: 'Hybrid, {{count}} day a week on site',
              other: 'Hybrid, {{count}} days a week on site',
            },
            { count: v.terms.hybridDaysOnsite },
          );
    default:
      return '—';
  }
}

function perOf(v: Version): string {
  const amount = money(v.pay.baseMinor, v.pay.currency);
  if (v.pay.frequency === 'month')
    return tr('app.me.[company].offer-page.a_month', '{{amount}} a month', { amount });
  if (v.pay.frequency === 'hour')
    return tr('app.me.[company].offer-page.an_hour', '{{amount}} an hour', { amount });
  return tr('app.me.[company].offer-page.a_year', '{{amount}} a year', { amount });
}

interface Said {
  readonly q: string;
  readonly a: string | null;
}

/**
 * J7, the offer as a page of its own (PRD §18.5): every term the candidate
 * is agreeing to, laid out to be read top to bottom; beside it an AI that
 * explains a term and never changes one; and the answer at the foot, where
 * a decline says why, for the recruiter, who may send new terms.
 */
export function OfferPage({
  company,
  token,
  offerId,
  onClose,
  onDone,
}: {
  readonly company: string;
  readonly token: string;
  readonly offerId: string;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  const [read, setRead] = useState<OfferRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState<readonly Said[]>([]);
  const [asking, ask] = useTransition();
  const [pending, start] = useTransition();
  useEffect(() => {
    void publicApi<OfferRead>(company, `/me/offers/${offerId}`, { token }).then((a) => {
      if (a.ok) setRead(a.data);
      else setError(a.message);
    });
  }, [company, offerId, token]);
  const v = read?.offer.versions.at(-1);
  const state = read?.offer.state;
  const setting = read?.setting;
  // The contract by its name in the employer's country ("Autónomo"), not a generic kind.
  const contract = setting?.contract?.contract ?? contractOf(v?.terms.contractType);
  const act = (path: string, body: unknown): void => {
    start(async () => {
      const done = await publicApi(company, `/me/offers/${offerId}${path}`, {
        method: 'POST',
        body,
        token,
      });
      if (!done.ok) setError(done.message);
      else onDone();
    });
  };
  const question = (q: string): void => {
    setSaid((s) => [...s, { q, a: null }]);
    ask(async () => {
      const done = await publicApi<{ answer: string; answered: boolean }>(
        company,
        `/me/offers/${offerId}/questions`,
        { method: 'POST', body: { question: q }, token },
      );
      const a = done.ok
        ? done.data.answered
          ? done.data.answer
          : `${done.data.answer} ${tr(
              'app.me.[company].offer-page.ask_the_recruiter',
              'For anything the offer does not say, reply to the offer email: it reaches the recruiter.',
            )}`
        : done.message;
      setSaid((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, a } : x)));
    });
  };
  const extras =
    v === undefined
      ? []
      : [
          ...(v.pay.variableTargetMinor > 0
            ? [
                {
                  label: tr('app.me.[company].offer-page.bonus_at_target', 'Bonus at target'),
                  value: money(v.pay.variableTargetMinor, v.pay.currency),
                },
              ]
            : []),
          ...(v.pay.signOnMinor > 0
            ? [
                {
                  label: tr('app.me.[company].offer-page.when_you_join', 'When you join'),
                  value: money(v.pay.signOnMinor, v.pay.currency),
                },
              ]
            : []),
          ...((v.pay.relocationMinor ?? 0) > 0
            ? [
                {
                  label: tr('app.me.[company].offer-page.relocation', 'Relocation'),
                  value: money(v.pay.relocationMinor ?? 0, v.pay.currency),
                },
              ]
            : []),
          ...(v.pay.equity == null
            ? []
            : [
                {
                  label: tr('app.me.[company].offer-page.equity', 'Equity'),
                  value: tr(
                    'app.me.[company].offer-page.equity_units',
                    '{{description}} · {{units}} units',
                    {
                      description: v.pay.equity.description,
                      units: v.pay.equity.units,
                    },
                  ),
                },
              ]),
          ...(v.terms.paymentsPerYear === undefined || v.terms.paymentsPerYear === 12
            ? []
            : [
                {
                  label: tr('app.me.[company].offer-page.payments', 'Paid in'),
                  value: tr(
                    'app.me.[company].offer-page.payments_a_year',
                    { one: '{{count}} payment a year', other: '{{count}} payments a year' },
                    { count: v.terms.paymentsPerYear },
                  ),
                },
              ]),
        ];
  return (
    <ModalPage
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalPageContent size="inset">
        <ModalPageHeader
          title={
            setting === undefined
              ? tr('app.me.[company].offer-page.your_offer', 'Your offer')
              : tr('app.me.[company].offer-page.your_offer_from', 'Your offer from {{company}}', {
                  company: setting.company.name,
                })
          }
          description={
            v === undefined
              ? undefined
              : tr(
                  'app.me.[company].offer-page.role_version',
                  '{{role}} · version {{version}} · open until {{until}}',
                  {
                    role: setting?.job.title ?? '',
                    version: v.version,
                    until: day(v.expiresOn),
                  },
                )
          }
          meta={
            state === 'accepted' ? (
              <Badge tone="success" size="sm">
                {tr('app.me.[company].offer-page.accepted', 'Accepted')}
              </Badge>
            ) : state === 'declined' ? (
              <Badge tone="neutral" size="sm">
                {tr('app.me.[company].offer-page.declined', 'Declined')}
              </Badge>
            ) : null
          }
        />
        <ModalPageBody className="px-4 pt-6 pb-16 @2xl:px-8">
          {error === null ? null : (
            <Alert
              tone="danger"
              title={tr(
                'app.me.[company].offer-page.that_did_not_go_through',
                'That did not go through',
              )}
            >
              {error}
            </Alert>
          )}
          {v === undefined ? (
            error === null ? (
              <Spinner
                label={tr('app.me.[company].offer-page.loading_the_offer', 'Loading the offer')}
              />
            ) : null
          ) : (
            <div className="mx-auto grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <section
                  className="grid gap-4 sm:grid-cols-3"
                  aria-label={tr('app.me.[company].offer-page.at_a_glance', 'At a glance')}
                >
                  <Stat
                    label={tr('app.me.[company].offer-page.base_pay', 'Base pay')}
                    value={perOf(v)}
                  />
                  <Stat
                    label={tr('app.me.[company].offer-page.start', 'You start')}
                    value={shortDay(v.startDate)}
                  />
                  <Stat
                    label={tr('app.me.[company].offer-page.contract', 'Contract')}
                    value={contract}
                  />
                </section>
                {state === 'declined' ? (
                  <Alert
                    tone="neutral"
                    title={tr(
                      'app.me.[company].offer-page.you_declined',
                      'You declined this offer',
                    )}
                  >
                    {read?.offer.declineReason == null
                      ? null
                      : tr(
                          'app.me.[company].offer-page.your_reason',
                          'Your reason: “{{reason}}”. The recruiter may come back with new terms.',
                          {
                            reason: read.offer.declineReason,
                          },
                        )}
                  </Alert>
                ) : null}
                {state === 'accepted' ? (
                  <Alert
                    tone="success"
                    title={tr(
                      'app.me.[company].offer-page.you_accepted',
                      'You accepted this offer',
                    )}
                  >
                    {tr(
                      'app.me.[company].offer-page.contract_next',
                      'Your contract comes next: you will get it by email to sign.',
                    )}
                  </Alert>
                ) : null}
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>
                      {tr('app.me.[company].offer-page.pay_and_rewards', 'Pay and rewards')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <KeyValues
                      items={[
                        {
                          label: tr('app.me.[company].offer-page.base_pay', 'Base pay'),
                          value: perOf(v),
                        },
                        ...extras,
                      ]}
                    />
                  </CardContent>
                </Card>
                {setting === undefined || setting.benefits.length === 0 ? null : (
                  <Card>
                    <CardHeader>
                      <CardTitle level={2}>
                        {tr('app.me.[company].offer-page.benefits', 'Benefits')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <IconList>
                        {setting.benefits.map((b) => (
                          <IconListItem
                            key={b.id}
                            icon={<icons.success aria-hidden />}
                            description={b.description ?? undefined}
                          >
                            {b.name}
                          </IconListItem>
                        ))}
                      </IconList>
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader>
                    <CardTitle level={2}>
                      {tr('app.me.[company].offer-page.the_terms', 'The terms')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <KeyValues
                      items={[
                        {
                          label: tr('app.me.[company].offer-page.contract', 'Contract'),
                          value: contract,
                        },
                        ...(setting?.contract?.relationship == null
                          ? []
                          : [
                              {
                                label: tr('app.me.[company].offer-page.relationship', 'As'),
                                value: setting.contract.relationship,
                              },
                            ]),
                        ...(v.terms.contractEnd == null
                          ? []
                          : [
                              {
                                label: tr('app.me.[company].offer-page.ends', 'Ends'),
                                value: day(v.terms.contractEnd),
                              },
                            ]),
                        {
                          label: tr('app.me.[company].offer-page.hours', 'Hours'),
                          value:
                            v.terms.weeklyMinutes === undefined
                              ? '—'
                              : tr(
                                  'app.me.[company].offer-page.hours_a_week',
                                  '{{hours}} hours a week',
                                  {
                                    hours: v.terms.weeklyMinutes / 60,
                                  },
                                ),
                        },
                        {
                          label: tr('app.me.[company].offer-page.where', 'Where you work'),
                          value: modeOf(v),
                        },
                        {
                          label: tr('app.me.[company].offer-page.probation', 'Probation'),
                          value: lengthOf(v.terms.probation),
                        },
                        {
                          label: tr('app.me.[company].offer-page.notice', 'Your notice'),
                          value: lengthOf(v.terms.noticeEmployee),
                        },
                        ...(setting?.contract == null || setting.contract.leave.days === 0
                          ? []
                          : [
                              {
                                label: tr('app.me.[company].offer-page.leave', 'Paid leave'),
                                value:
                                  setting.contract.leave.unit === 'working_days'
                                    ? tr(
                                        'app.me.[company].offer-page.leave_working',
                                        'At least {{days}} working days a year ({{source}})',
                                        {
                                          days: setting.contract.leave.days,
                                          source: setting.contract.leave.source,
                                        },
                                      )
                                    : tr(
                                        'app.me.[company].offer-page.leave_calendar',
                                        'At least {{days}} calendar days a year ({{source}})',
                                        {
                                          days: setting.contract.leave.days,
                                          source: setting.contract.leave.source,
                                        },
                                      ),
                              },
                            ]),
                        {
                          label: tr('app.me.[company].offer-page.start', 'You start'),
                          value: day(v.startDate),
                        },
                        {
                          label: tr('app.me.[company].offer-page.open_until', 'Open until'),
                          value: day(v.expiresOn),
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
              </div>
              <Card className="lg:sticky lg:top-0">
                <CardHeader>
                  <CardTitle level={2}>
                    {tr('app.me.[company].offer-page.ask_about_it', 'Ask about this offer')}
                  </CardTitle>
                  <CardDescription>
                    {tr(
                      'app.me.[company].offer-page.ai_note',
                      'An AI answers from this offer only. It explains a term; it cannot change one, and it does not advise you.',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {said.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {tr(
                        'app.me.[company].offer-page.try_asking',
                        'Try: “What does the probation mean for me?” or “When is the bonus paid?”',
                      )}
                    </p>
                  ) : (
                    <ChatLog
                      label={tr(
                        'app.me.[company].offer-page.questions',
                        'Questions about the offer',
                      )}
                      className="max-h-[28rem]"
                    >
                      {said.flatMap((x, i) => [
                        <ChatMessage key={`q${String(i)}`} from="self">
                          {x.q}
                        </ChatMessage>,
                        x.a === null ? (
                          <ChatTyping
                            key={`t${String(i)}`}
                            author={tr('app.me.[company].offer-page.ai', 'AI')}
                          />
                        ) : (
                          <ChatMessage
                            key={`a${String(i)}`}
                            from="other"
                            author={tr('app.me.[company].offer-page.ai', 'AI')}
                          >
                            {x.a}
                          </ChatMessage>
                        ),
                      ])}
                    </ChatLog>
                  )}
                  <ChatComposer
                    label={tr('app.me.[company].offer-page.your_question', 'Your question')}
                    placeholder={tr(
                      'app.me.[company].offer-page.ask_a_question',
                      'Ask a question about the offer',
                    )}
                    sendLabel={tr('app.me.[company].offer-page.ask', 'Ask')}
                    busy={asking}
                    onSend={question}
                  />
                </CardContent>
              </Card>
            </div>
          )}
          {declining && state === 'sent' ? (
            <div className="mx-auto mt-6 w-full max-w-6xl">
              <Field required>
                <FieldLabel>
                  {tr('app.me.[company].offer-page.why_declining', 'Why you are declining')}
                </FieldLabel>
                <FieldControl>
                  <Textarea
                    autoResize
                    value={reason}
                    placeholder={tr(
                      'app.me.[company].offer-page.reason_placeholder',
                      'The pay, the start date, another offer…',
                    )}
                    onChange={(e) => {
                      setReason(e.target.value);
                    }}
                  />
                </FieldControl>
                <FieldDescription>
                  {tr(
                    'app.me.[company].offer-page.reason_read',
                    'The recruiter reads this, and may come back with new terms.',
                  )}
                </FieldDescription>
              </Field>
            </div>
          ) : null}
        </ModalPageBody>
        <ModalPageFooter>
          {state === 'sent' ? (
            declining ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeclining(false);
                  }}
                >
                  {tr('app.me.[company].offer-page.back', 'Back')}
                </Button>
                <Button
                  variant="danger"
                  loading={pending}
                  disabled={reason.trim().length < 3}
                  onClick={() => {
                    act('/decline', { reason: reason.trim() });
                  }}
                >
                  {tr('app.me.[company].offer-page.decline_the_offer', 'Decline the offer')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeclining(true);
                  }}
                >
                  {tr('app.me.[company].offer-page.decline', 'Decline')}
                </Button>
                <Button
                  loading={pending}
                  startIcon={<icons.success aria-hidden />}
                  onClick={() => {
                    if (read !== null) act('/accept', { hash: read.hash });
                  }}
                >
                  {tr('app.me.[company].offer-page.accept_offer', 'Accept the offer')}
                </Button>
              </>
            )
          ) : (
            <Button variant="secondary" onClick={onClose}>
              {tr('app.me.[company].offer-page.close', 'Close')}
            </Button>
          )}
        </ModalPageFooter>
      </ModalPageContent>
    </ModalPage>
  );
}
