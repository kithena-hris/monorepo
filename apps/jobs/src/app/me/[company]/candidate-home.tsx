'use client';

import type { CandidatePage } from '@kithena/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  Spinner,
  Stepper,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { NoticeDialog, NoticeList, noticesOf, type Notice } from '../../../components/asks';
import { publicApi, tokenFromHash } from '../../../lib/browser-api';
import { ReadProfile } from './read-profile';
import { SelfIdForm } from './self-id';
import { t as tr } from '../../../lib/i18n';
import { locale } from '@reach/ui/intl';

interface Offer {
  readonly offer: {
    readonly id: string;
    readonly state: string;
    readonly versions: readonly {
      readonly version: number;
      readonly startDate: string;
      readonly expiresOn: string;
      readonly pay: {
        readonly baseMinor: number;
        readonly currency: string;
        readonly frequency: string;
        readonly variableTargetMinor: number;
        readonly signOnMinor: number;
      };
      readonly terms: {
        readonly contractType?: string;
        readonly weeklyMinutes?: number;
        readonly probation?: { count: number; unit: string } | null;
        readonly noticeEmployee?: { count: number; unit: string };
        readonly workMode?: string;
      };
    }[];
  };
  readonly hash: string;
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );
const length = (l: { count: number; unit: string } | null | undefined) =>
  l == null ? 'None' : `${String(l.count)} ${l.count === 1 ? l.unit.replace(/s$/u, '') : l.unit}`;
const words = (k: string) => k.replaceAll('_', ' ').replace(/^./u, (c) => c.toUpperCase());
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

function OfferDialog({
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
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    void publicApi<Offer>(company, `/me/offers/${offerId}`, { token }).then((a) => {
      if (a.ok) setOffer(a.data);
      else setError(a.message);
    });
  }, [company, offerId, token]);
  const v = offer?.offer.versions.at(-1);
  const act = (path: string, body: unknown) => {
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('app.me.[company].candidate-home.your_offer', 'Your offer')}
          </DialogTitle>
          <DialogDescription>
            {v === undefined
              ? ''
              : tr(
                  'app.me.[company].candidate-home.version_expires',
                  'Version {{String}} · expires {{day}}',
                  { String: String(v.version), day: day(v.expiresOn) },
                )}
          </DialogDescription>
        </DialogHeader>
        {error === null ? null : (
          <Alert
            tone="danger"
            title={tr(
              'app.me.[company].candidate-home.that_did_not_go_through',
              'That did not go through',
            )}
          >
            {error}
          </Alert>
        )}
        {v === undefined ? (
          error === null ? (
            <Spinner
              label={tr('app.me.[company].candidate-home.loading_the_offer', 'Loading the offer')}
            />
          ) : null
        ) : (
          <KeyValues
            items={[
              {
                label: tr('app.me.[company].candidate-home.contract', 'Contract'),
                value: v.terms.contractType === undefined ? '—' : words(v.terms.contractType),
              },
              {
                label: tr('app.me.[company].candidate-home.hours', 'Hours'),
                value:
                  v.terms.weeklyMinutes === undefined
                    ? '—'
                    : `${String(v.terms.weeklyMinutes / 60)} hours a week`,
              },
              {
                label: tr('app.me.[company].candidate-home.probation', 'Probation'),
                value: length(v.terms.probation),
              },
              {
                label: tr('app.me.[company].candidate-home.notice', 'Notice'),
                value: length(v.terms.noticeEmployee),
              },
              {
                label: tr('app.me.[company].candidate-home.pay', 'Pay'),
                value: `${money(v.pay.baseMinor, v.pay.currency)} a ${v.pay.frequency}`,
              },
              ...(v.pay.variableTargetMinor > 0
                ? [
                    {
                      label: tr(
                        'app.me.[company].candidate-home.bonus_at_target',
                        'Bonus at target',
                      ),
                      value: money(v.pay.variableTargetMinor, v.pay.currency),
                    },
                  ]
                : []),
              ...(v.pay.signOnMinor > 0
                ? [
                    {
                      label: tr('app.me.[company].candidate-home.when_you_join', 'When you join'),
                      value: money(v.pay.signOnMinor, v.pay.currency),
                    },
                  ]
                : []),
              {
                label: tr('app.me.[company].candidate-home.start', 'Start'),
                value: day(v.startDate),
              },
            ]}
          />
        )}
        {declining ? (
          <Field required>
            <FieldLabel>
              {tr('app.me.[company].candidate-home.why_you_are_declining', 'Why you are declining')}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={reason}
                placeholder={tr(
                  'app.me.[company].candidate-home.the_pay_the_start_date_another',
                  'The pay, the start date, another offer…',
                )}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {tr(
                'app.me.[company].candidate-home.the_recruiter_reads_this_they_may',
                'The recruiter reads this. They may come back with an updated offer.',
              )}
            </FieldDescription>
          </Field>
        ) : null}
        <DialogFooter>
          {offer?.offer.state === 'sent' ? (
            declining ? (
              <Button
                variant="secondary"
                loading={pending}
                disabled={reason.trim().length < 3}
                onClick={() => {
                  act('/decline', { reason: reason.trim() });
                }}
              >
                {tr('app.me.[company].candidate-home.decline_the_offer', 'Decline the offer')}
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeclining(true);
                  }}
                >
                  {tr('app.me.[company].candidate-home.decline', 'Decline')}
                </Button>
                <Button
                  loading={pending}
                  onClick={() => {
                    act('/accept', { hash: offer.hash });
                  }}
                >
                  {tr('app.me.[company].candidate-home.accept_offer', 'Accept offer')}
                </Button>
              </>
            )
          ) : (
            <Button variant="secondary" onClick={onClose}>
              {tr('app.me.[company].candidate-home.close', 'Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** J6: each application under the candidate-facing stage names, with what is asked of them. */
export function CandidateHome({ company }: { readonly company: string }): JSX.Element {
  const [token, setToken] = useState('');
  const [page, setPage] = useState<CandidatePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<string | null>(null);
  const [referee, setReferee] = useState<string | null>(null);
  const [refName, setRefName] = useState('');
  const [refEmail, setRefEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<Notice | null>(null);
  const [pending, start] = useTransition();
  const load = (t: string) =>
    void publicApi<CandidatePage>(company, '/me', { token: t }).then((a) => {
      if (a.ok) setPage(a.data);
      else setError(a.message);
    });
  useEffect(() => {
    const t = tokenFromHash();
    setToken(t);
    if (t === '')
      setError(
        tr(
          'app.me.[company].candidate-home.open_this_page_from_the_link',
          'Open this page from the link in one of our emails.',
        ),
      );
    else load(t);
  }, []);
  const post = (path: string, body: unknown, done: string) => {
    start(async () => {
      const answer = await publicApi(company, path, { method: 'POST', body, token });
      if (!answer.ok) setError(answer.message);
      else {
        setNotice(done);
        load(token);
      }
    });
  };
  if (error !== null && page === null)
    return (
      <Alert
        tone="warning"
        title={tr(
          'app.me.[company].candidate-home.we_cant_show_your_applications',
          'We can’t show your applications',
        )}
      >
        {error}
      </Alert>
    );
  if (page === null)
    return (
      <Spinner
        label={tr(
          'app.me.[company].candidate-home.loading_your_applications',
          'Loading your applications',
        )}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">
        {tr('app.me.[company].candidate-home.your_applications', 'Your applications')}
      </h1>
      {notice === null ? null : <Alert tone="success" title={notice} />}
      {error === null ? null : (
        <Alert
          tone="danger"
          title={tr(
            'app.me.[company].candidate-home.that_did_not_go_through',
            'That did not go through',
          )}
        >
          {error}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          {page.applications.length === 0 ? (
            <EmptyState
              icon={<icons.work aria-hidden />}
              title={tr('app.me.[company].candidate-home.no_applications', 'No applications')}
            />
          ) : null}
          {page.applications.map((a) => (
            <Card key={a.applicationId}>
              <CardHeader>
                <CardTitle level={2}>{a.job.title}</CardTitle>
                <Badge
                  size="sm"
                  tone={
                    a.outcome === 'active'
                      ? 'accent'
                      : a.outcome === 'hired'
                        ? 'success'
                        : 'neutral'
                  }
                >
                  {a.outcome === 'active'
                    ? (a.stage ?? tr('app.me.[company].candidate-home.in_progress', 'In progress'))
                    : words(a.outcome)}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-fg-muted">{a.job.company}</p>
                {a.outcome === 'active' && a.steps.length > 0 ? (
                  <Stepper
                    label={tr('app.me.[company].candidate-home.where_it_stands', 'Where it stands')}
                    size="sm"
                    orientation="auto"
                    steps={a.steps.map((s, i) => ({ id: String(i), label: s.name }))}
                    current={Math.max(
                      0,
                      a.steps.findIndex((s) => s.state === 'current'),
                    )}
                  />
                ) : null}
                {a.interviews.length === 0 && a.requests.length === 0 ? null : (
                  <NoticeList
                    notices={noticesOf([
                      {
                        company: { slug: company, name: a.job.company, token },
                        page: { name: page.name, applications: [a] },
                      },
                    ])}
                    onOpen={setOpened}
                    onOffer={() => {
                      setOffer(a.offer?.offerId ?? null);
                    }}
                  />
                )}
                {a.contract === null ? null : a.contract.signedOn !== null ? (
                  <Alert
                    tone="success"
                    title={tr(
                      'app.me.[company].candidate-home.contract_signed_on',
                      'Contract signed on {{day}}',
                      { day: day(a.contract.signedOn) },
                    )}
                  >
                    {a.outcome === 'hired'
                      ? tr(
                          'app.me.[company].candidate-home.you_are_hired_will_be_in',
                          'You are hired. {{company}} will be in touch about your first day.',
                          { company: a.job.company },
                        )
                      : tr(
                          'app.me.[company].candidate-home.your_start_is_being_arranged',
                          'Your start is being arranged.',
                        )}
                  </Alert>
                ) : a.contract.state === 'out_for_signature' ? (
                  <Alert
                    tone="info"
                    title={
                      a.contract.route === 'documents'
                        ? tr(
                            'app.me.[company].candidate-home.your_contract_is_ready_to_sign',
                            'Your contract is ready to sign',
                          )
                        : a.contract.route === 'wet_ink'
                          ? tr(
                              'app.me.[company].candidate-home.your_contract_is_on_paper',
                              'Your contract is on paper',
                            )
                          : tr(
                              'app.me.[company].candidate-home.your_contract_is_on_its_way',
                              'Your contract is on its way',
                            )
                    }
                  >
                    {a.contract.route === 'documents'
                      ? tr(
                          'app.me.[company].candidate-home.you_have_an_email_with_a',
                          'You have an email with a link and a code to sign it online. Once you sign, you are hired.',
                        )
                      : a.contract.route === 'wet_ink'
                        ? tr(
                            'app.me.[company].candidate-home.this_contract_is_signed_by_hand',
                            'This contract is signed by hand, by both sides, before you start. The company will send it.',
                          )
                        : tr(
                            'app.me.[company].candidate-home.the_company_will_send_it_to',
                            'The company will send it to you to sign and return.',
                          )}
                  </Alert>
                ) : (
                  <Alert
                    tone="neutral"
                    title={tr(
                      'app.me.[company].candidate-home.your_contract_is_being_prepared',
                      'Your contract is being prepared',
                    )}
                  />
                )}
                <ReadProfile company={company} token={token} applicationId={a.applicationId} />
                <SelfIdForm company={company} token={token} applicationId={a.applicationId} />
                <div className="flex flex-wrap gap-2">
                  {a.offer === null ? null : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setOffer(a.offer?.offerId ?? null);
                      }}
                    >
                      {a.offer.state === 'sent'
                        ? tr('app.me.[company].candidate-home.read_your_offer', 'Read your offer')
                        : tr('app.me.[company].candidate-home.your_offer', 'Your offer')}
                    </Button>
                  )}
                  {a.outcome === 'active' ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setReferee(a.applicationId);
                        }}
                      >
                        {tr('app.me.[company].candidate-home.name_a_referee', 'Name a referee')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={pending}
                        onClick={() => {
                          post(
                            `/me/applications/${a.applicationId}/withdraw`,
                            {},
                            tr(
                              'app.me.[company].candidate-home.application_withdrawn',
                              'Application withdrawn',
                            ),
                          );
                        }}
                      >
                        {tr('app.me.[company].candidate-home.withdraw', 'Withdraw')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('app.me.[company].candidate-home.your_data', 'Your data')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              variant="secondary"
              loading={pending}
              onClick={() => {
                start(async () => {
                  const data = await publicApi<unknown>(company, '/me/export', { token });
                  if (!data.ok) {
                    setError(data.message);
                    return;
                  }
                  const link = document.createElement('a');
                  link.href = URL.createObjectURL(
                    new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' }),
                  );
                  link.download = 'my-applications.json';
                  link.click();
                });
              }}
            >
              {tr('app.me.[company].candidate-home.download_my_data', 'Download my data')}
            </Button>
            <Button
              variant="ghost"
              loading={pending}
              onClick={() => {
                post(
                  '/me/pool',
                  { agree: false },
                  tr(
                    'app.me.[company].candidate-home.you_have_left_the_talent_pool',
                    'You have left the talent pool',
                  ),
                );
              }}
            >
              {tr('app.me.[company].candidate-home.leave_the_talent_pool', 'Leave the talent pool')}
            </Button>
            <Button
              variant="ghost"
              loading={pending}
              onClick={() => {
                post(
                  '/me/delete',
                  {},
                  tr(
                    'app.me.[company].candidate-home.your_data_is_deleted_except_where',
                    'Your data is deleted, except where the law says it must be kept',
                  ),
                );
              }}
            >
              {tr('app.me.[company].candidate-home.delete_my_data', 'Delete my data')}
            </Button>
            <p className="text-xs text-fg-muted">
              {tr(
                'app.me.[company].candidate-home.deleting_is_immediate_except_where_a',
                'Deleting is immediate, except where a company must keep it by law.',
              )}
            </p>
          </CardContent>
        </Card>
      </div>
      {offer === null ? null : (
        <OfferDialog
          company={company}
          token={token}
          offerId={offer}
          onClose={() => {
            setOffer(null);
          }}
          onDone={() => {
            setOffer(null);
            setNotice(
              tr(
                'app.me.[company].candidate-home.done_the_company_has_been_told',
                'Done. The company has been told.',
              ),
            );
            load(token);
          }}
        />
      )}
      <Dialog
        open={referee !== null}
        onOpenChange={(open) => {
          if (!open) setReferee(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('app.me.[company].candidate-home.name_a_referee', 'Name a referee')}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'app.me.[company].candidate-home.nobody_is_contacted_until_you_name',
                'Nobody is contacted until you name them here.',
              )}
            </DialogDescription>
          </DialogHeader>
          <Field required>
            <FieldLabel>{tr('app.me.[company].candidate-home.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={refName}
                onChange={(e) => {
                  setRefName(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('app.me.[company].candidate-home.email', 'Email')}</FieldLabel>
            <FieldControl>
              <Input
                type="email"
                value={refEmail}
                onChange={(e) => {
                  setRefEmail(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button
              disabled={refName === '' || !refEmail.includes('@')}
              loading={pending}
              onClick={() => {
                post(
                  `/me/applications/${referee ?? ''}/referees`,
                  { name: refName, email: refEmail, relationship: null },
                  tr('app.me.[company].candidate-home.referee_added', 'Referee added'),
                );
                setReferee(null);
                setRefName('');
                setRefEmail('');
              }}
            >
              {tr('app.me.[company].candidate-home.add_referee', 'Add referee')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NoticeDialog
        notice={opened}
        onClose={() => {
          setOpened(null);
        }}
        onDone={(said) => {
          setOpened(null);
          setNotice(said);
          load(token);
        }}
      />
    </div>
  );
}
