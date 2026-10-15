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
  FieldLabel,
  Input,
  KeyValues,
  Spinner,
  Stepper,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';

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
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );
const length = (l: { count: number; unit: string } | null | undefined) =>
  l == null ? 'None' : `${String(l.count)} ${l.count === 1 ? l.unit.replace(/s$/u, '') : l.unit}`;
const words = (k: string) => k.replaceAll('_', ' ').replace(/^./u, (c) => c.toUpperCase());
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
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
    void publicApi<Offer>(company, `/me/offers/${offerId}`, { token }).then((a) =>
      a.ok ? setOffer(a.data) : setError(a.message),
    );
  }, [company, offerId, token]);
  const v = offer?.offer.versions.at(-1);
  const act = (path: string, body: unknown) =>
    start(async () => {
      const done = await publicApi(company, `/me/offers/${offerId}${path}`, {
        method: 'POST',
        body,
        token,
      });
      if (!done.ok) setError(done.message);
      else onDone();
    });
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your offer</DialogTitle>
          <DialogDescription>
            {v === undefined ? '' : `Version ${String(v.version)} · expires ${day(v.expiresOn)}`}
          </DialogDescription>
        </DialogHeader>
        {error === null ? null : (
          <Alert tone="danger" title="That did not go through">
            {error}
          </Alert>
        )}
        {v === undefined ? (
          error === null ? (
            <Spinner label="Loading the offer" />
          ) : null
        ) : (
          <KeyValues
            items={[
              {
                label: 'Contract',
                value: v.terms.contractType === undefined ? '—' : words(v.terms.contractType),
              },
              {
                label: 'Hours',
                value:
                  v.terms.weeklyMinutes === undefined
                    ? '—'
                    : `${String(v.terms.weeklyMinutes / 60)} hours a week`,
              },
              { label: 'Probation', value: length(v.terms.probation) },
              { label: 'Notice', value: length(v.terms.noticeEmployee) },
              {
                label: 'Pay',
                value: `${money(v.pay.baseMinor, v.pay.currency)} a ${v.pay.frequency}`,
              },
              ...(v.pay.variableTargetMinor > 0
                ? [
                    {
                      label: 'Bonus at target',
                      value: money(v.pay.variableTargetMinor, v.pay.currency),
                    },
                  ]
                : []),
              ...(v.pay.signOnMinor > 0
                ? [{ label: 'When you join', value: money(v.pay.signOnMinor, v.pay.currency) }]
                : []),
              { label: 'Start', value: day(v.startDate) },
            ]}
          />
        )}
        {declining ? (
          <Field>
            <FieldLabel>Why, if you’d like to say</FieldLabel>
            <FieldControl>
              <Textarea autoResize value={reason} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
          </Field>
        ) : null}
        <DialogFooter>
          {offer?.offer.state === 'sent' ? (
            declining ? (
              <Button
                variant="secondary"
                loading={pending}
                onClick={() => act('/decline', { reason: reason === '' ? null : reason })}
              >
                Decline the offer
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setDeclining(true)}>
                  Decline
                </Button>
                <Button loading={pending} onClick={() => act('/accept', { hash: offer.hash })}>
                  Accept offer
                </Button>
              </>
            )
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Close
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
  const [pending, start] = useTransition();
  const load = (t: string) =>
    void publicApi<CandidatePage>(company, '/me', { token: t }).then((a) =>
      a.ok ? setPage(a.data) : setError(a.message),
    );
  useEffect(() => {
    const t = tokenFromHash();
    setToken(t);
    if (t === '') setError('Open this page from the link in one of our emails.');
    else load(t);
  }, []);
  const post = (path: string, body: unknown, done: string) =>
    start(async () => {
      const answer = await publicApi(company, path, { method: 'POST', body, token });
      if (!answer.ok) setError(answer.message);
      else {
        setNotice(done);
        load(token);
      }
    });
  if (error !== null && page === null)
    return (
      <Alert tone="warning" title="We can’t show your applications">
        {error}
      </Alert>
    );
  if (page === null) return <Spinner label="Loading your applications" />;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Your applications</h1>
      {notice === null ? null : <Alert tone="success" title={notice} />}
      {error === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {error}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          {page.applications.length === 0 ? (
            <EmptyState icon={<icons.work aria-hidden />} title="No applications" />
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
                  {a.outcome === 'active' ? (a.stage ?? 'In progress') : words(a.outcome)}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-fg-muted">{a.job.company}</p>
                {a.outcome === 'active' && a.steps.length > 0 ? (
                  <Stepper
                    label="Where it stands"
                    size="sm"
                    orientation="auto"
                    steps={a.steps.map((s, i) => ({ id: String(i), label: s.name }))}
                    current={Math.max(
                      0,
                      a.steps.findIndex((s) => s.state === 'current'),
                    )}
                  />
                ) : null}
                {a.interviews.map((i) => (
                  <Alert
                    key={i.id}
                    tone="info"
                    title={`${i.title} · ${new Date(i.startsAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  >
                    {i.where ?? ''}
                  </Alert>
                ))}
                {a.requests.map((r) => (
                  <Alert key={r.id} tone="warning" title={r.label} />
                ))}
                <div className="flex flex-wrap gap-2">
                  {a.offer === null ? null : (
                    <Button size="sm" onClick={() => setOffer(a.offer?.offerId ?? null)}>
                      {a.offer.state === 'sent' ? 'Read your offer' : 'Your offer'}
                    </Button>
                  )}
                  {a.outcome === 'active' ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setReferee(a.applicationId)}
                      >
                        Name a referee
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={pending}
                        onClick={() =>
                          post(
                            `/me/applications/${a.applicationId}/withdraw`,
                            {},
                            'Application withdrawn',
                          )
                        }
                      >
                        Withdraw
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
            <CardTitle level={2}>Your data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              variant="secondary"
              loading={pending}
              onClick={() =>
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
                })
              }
            >
              Download my data
            </Button>
            <Button
              variant="ghost"
              loading={pending}
              onClick={() => post('/me/pool', { agree: false }, 'You have left the talent pool')}
            >
              Leave the talent pool
            </Button>
            <Button
              variant="ghost"
              loading={pending}
              onClick={() =>
                post(
                  '/me/delete',
                  {},
                  'Your data is deleted, except where the law says it must be kept',
                )
              }
            >
              Delete my data
            </Button>
            <p className="text-xs text-fg-muted">
              Deleting is immediate, except where a company must keep it by law.
            </p>
          </CardContent>
        </Card>
      </div>
      {offer === null ? null : (
        <OfferDialog
          company={company}
          token={token}
          offerId={offer}
          onClose={() => setOffer(null)}
          onDone={() => {
            setOffer(null);
            setNotice('Done. The company has been told.');
            load(token);
          }}
        />
      )}
      <Dialog open={referee !== null} onOpenChange={(open) => (open ? null : setReferee(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name a referee</DialogTitle>
            <DialogDescription>Nobody is contacted until you name them here.</DialogDescription>
          </DialogHeader>
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input value={refName} onChange={(e) => setRefName(e.target.value)} />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>Email</FieldLabel>
            <FieldControl>
              <Input type="email" value={refEmail} onChange={(e) => setRefEmail(e.target.value)} />
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
                  'Referee added',
                );
                setReferee(null);
                setRefName('');
                setRefEmail('');
              }}
            >
              Add referee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
