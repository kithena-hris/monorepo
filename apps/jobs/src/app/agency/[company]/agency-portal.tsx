'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dropzone,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  PinInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DataTable,
  type DataColumn,
  icons,
} from '@reach/ui';
import { useCallback, useEffect, useState, useTransition, type JSX } from 'react';

import { asUpload, publicApi } from '../../../lib/browser-api';
import { t } from '../../../lib/i18n';

interface Portal {
  readonly agency: string;
  readonly company: string;
  readonly jobs: readonly { readonly id: string; readonly title: string }[];
  readonly submissions: readonly {
    readonly id: string;
    readonly job: string;
    readonly candidate: string;
    readonly stage: string | null;
    readonly outcome: string;
    readonly submittedOn: string;
  }[];
}

const KEY = 'kithena-agency-session';

/** The session lives in this tab only, and goes when the tab does. */
const remembered = (company: string): string => {
  try {
    return sessionStorage.getItem(`${KEY}:${company}`) ?? '';
  } catch {
    return '';
  }
};

type Submission = Portal['submissions'][number];
const submissionId = (s: Submission): string => s.id;
const submissionName = (s: Submission): string => s.candidate;

const SUBMISSION_COLUMNS = (): readonly DataColumn<Submission>[] => [
  {
    id: 'candidate',
    header: t('app.agency.[company].agency-portal.candidate', 'Candidate'),
    sortBy: (s) => s.candidate,
    cell: (s) => s.candidate,
  },
  {
    id: 'job',
    header: t('app.agency.[company].agency-portal.job', 'Job'),
    sortBy: (s) => s.job,
    cell: (s) => s.job,
  },
  {
    id: 'stage',
    header: t('app.agency.[company].agency-portal.stage', 'Stage'),
    cardTrailing: true,
    sortBy: (s) => s.outcome,
    cell: (s) => (
      <Badge size="sm" tone={s.outcome === 'active' ? 'info' : 'neutral'}>
        {s.outcome === 'active'
          ? (s.stage ?? t('app.agency.[company].agency-portal.in_review', 'In review'))
          : s.outcome === 'hired'
            ? t('app.agency.[company].agency-portal.hired', 'Hired')
            : s.outcome === 'rejected'
              ? t('app.agency.[company].agency-portal.not_progressed', 'Not progressed')
              : t('app.agency.[company].agency-portal.withdrawn', 'Withdrawn')}
      </Badge>
    ),
  },
  {
    id: 'submitted',
    header: t('app.agency.[company].agency-portal.submitted', 'Submitted'),
    sortBy: (s) => s.submittedOn,
    cell: (s) => s.submittedOn,
  },
];

export function AgencyPortal({ company }: { readonly company: string }): JSX.Element {
  const [token, setToken] = useState('');
  const [portal, setPortal] = useState<Portal | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [jobId, setJobId] = useState('');
  const [name, setName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [cv, setCv] = useState<File | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(
    async (session: string) => {
      const done = await publicApi<Portal>(company, '/agency', { token: session });
      if (done.ok) setPortal(done.data);
      else {
        setToken('');
        setPortal(null);
      }
    },
    [company],
  );
  useEffect(() => {
    const session = remembered(company);
    if (session === '') return;
    setToken(session);
    void load(session);
  }, [company, load]);

  if (token === '' || portal === null)
    return (
      <form
        className="mx-auto flex w-full max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            if (!asked) {
              const done = await publicApi(company, '/agency/codes', {
                method: 'POST',
                body: { email },
              });
              if (done.ok) setAsked(true);
              else setError(done.message);
              return;
            }
            const done = await publicApi<{ token: string }>(company, '/agency/sessions', {
              method: 'POST',
              body: { email, code },
            });
            if (!done.ok) {
              setError(done.message);
              return;
            }
            try {
              sessionStorage.setItem(`${KEY}:${company}`, done.data.token);
            } catch {
              // Private windows: the session lasts until the page is left.
            }
            setToken(done.data.token);
            await load(done.data.token);
          });
        }}
      >
        <h1 className="text-2xl font-bold">
          {t('app.agency.[company].agency-portal.agency_portal', 'Agency portal')}
        </h1>
        <p className="text-fg-muted">
          {t(
            'app.agency.[company].agency-portal.for_agencies_the_company_has_invited',
            'For agencies the company has invited. We send a code to the address it has for you.',
          )}
        </p>
        {error === null ? null : (
          <Alert
            tone="danger"
            title={t(
              'app.agency.[company].agency-portal.that_did_not_go_through',
              'That did not go through',
            )}
          >
            {error}
          </Alert>
        )}
        <Field required>
          <FieldLabel>
            {t('app.agency.[company].agency-portal.your_email', 'Your email')}
          </FieldLabel>
          <FieldControl>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              disabled={asked}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </FieldControl>
        </Field>
        {asked ? (
          <>
            <p className="text-sm text-fg-muted">
              {t(
                'app.agency.[company].agency-portal.if_this_address_belongs_to_an',
                'If this address belongs to an invited agency, a code is on its way.',
              )}
            </p>
            <PinInput
              label={t('app.agency.[company].agency-portal.the_code', 'The code')}
              length={6}
              value={code}
              onChange={setCode}
              type="numeric"
            />
          </>
        ) : null}
        <Button
          type="submit"
          loading={pending}
          disabled={email === '' || (asked && code.length !== 6)}
        >
          {asked
            ? t('app.agency.[company].agency-portal.sign_in', 'Sign in')
            : t('app.agency.[company].agency-portal.send_me_a_code', 'Send me a code')}
        </Button>
      </form>
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{portal.agency}</h1>
        <p className="text-fg-muted">
          {t(
            'app.agency.[company].agency-portal.your_candidates_for',
            'Your candidates for {{company}}',
            { company: portal.company },
          )}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle level={2}>
            {t('app.agency.[company].agency-portal.submit_a_candidate', 'Submit a candidate')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {portal.jobs.length === 0 ? (
            <EmptyState
              icon={<icons.work aria-hidden />}
              title={t(
                'app.agency.[company].agency-portal.no_open_jobs_for_you_right',
                'No open jobs for you right now',
              )}
            />
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                setSent(null);
                start(async () => {
                  const files = cv === null ? [] : [await asUpload('cv', cv)];
                  const done = await publicApi(company, '/agency/submissions', {
                    method: 'POST',
                    body: { jobId, name, email: candidateEmail, files },
                    token,
                  });
                  if (!done.ok) {
                    setError(done.message);
                    return;
                  }
                  setSent(name);
                  setName('');
                  setCandidateEmail('');
                  setCv(null);
                  await load(token);
                });
              }}
            >
              {error === null ? null : (
                <Alert
                  tone="danger"
                  title={t('app.agency.[company].agency-portal.not_submitted', 'Not submitted')}
                >
                  {error}
                </Alert>
              )}
              {sent === null ? null : (
                <Alert
                  tone="success"
                  title={t(
                    'app.agency.[company].agency-portal.is_submitted',
                    '{{sent}} is submitted',
                    { sent },
                  )}
                />
              )}
              <Field required>
                <FieldLabel>{t('app.agency.[company].agency-portal.job', 'Job')}</FieldLabel>
                <Select value={jobId} onValueChange={setJobId}>
                  <SelectTrigger aria-label={t('app.agency.[company].agency-portal.job', 'Job')}>
                    <SelectValue
                      placeholder={t(
                        'app.agency.[company].agency-portal.choose_a_job',
                        'Choose a job',
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {portal.jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field required>
                <FieldLabel>
                  {t('app.agency.[company].agency-portal.candidates_name', 'Candidate’s name')}
                </FieldLabel>
                <FieldControl>
                  <Input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <Field required>
                <FieldLabel>
                  {t('app.agency.[company].agency-portal.candidates_email', 'Candidate’s email')}
                </FieldLabel>
                <FieldControl>
                  <Input
                    type="email"
                    value={candidateEmail}
                    onChange={(e) => {
                      setCandidateEmail(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <Dropzone
                label={t('app.agency.[company].agency-portal.cv_optional', 'CV (optional)')}
                hint={t(
                  'app.agency.[company].agency-portal.pdf_docx_odt_or_rtf_up',
                  'PDF, DOCX, ODT or RTF, up to 10 MB',
                )}
                accept=".pdf,.docx,.odt,.rtf,application/pdf"
                onFiles={(picked) => {
                  const file = picked[0];
                  if (file === undefined) return;
                  if (file.size > 10 * 1024 * 1024) {
                    setError(`${file.name} is over 10 MB.`);
                    return;
                  }
                  setCv(file);
                }}
              />
              {cv === null ? null : <p className="text-sm">{cv.name}</p>}
              <Button
                type="submit"
                loading={pending}
                disabled={jobId === '' || name === '' || candidateEmail === ''}
              >
                {t('app.agency.[company].agency-portal.submit', 'Submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>
            {t('app.agency.[company].agency-portal.submitted', 'Submitted')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {portal.submissions.length === 0 ? (
            <EmptyState
              icon={<icons.people aria-hidden />}
              title={t(
                'app.agency.[company].agency-portal.nobody_submitted_yet',
                'Nobody submitted yet',
              )}
            />
          ) : (
            <DataTable<Submission>
              label={t(
                'app.agency.[company].agency-portal.submitted_candidates',
                'Submitted candidates',
              )}
              rows={portal.submissions}
              rowId={submissionId}
              describeRow={submissionName}
              stickyHeader
              containerClassName="max-h-[70dvh] min-h-64"
              columns={SUBMISSION_COLUMNS()}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
