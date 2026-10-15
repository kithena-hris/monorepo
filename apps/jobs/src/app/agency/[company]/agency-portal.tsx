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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useCallback, useEffect, useState, useTransition, type JSX } from 'react';

import { asUpload, publicApi } from '../../../lib/browser-api';

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
        <h1 className="text-2xl font-bold">Agency portal</h1>
        <p className="text-fg-muted">
          For agencies the company has invited. We send a code to the address it has for you.
        </p>
        {error === null ? null : (
          <Alert tone="danger" title="That did not go through">
            {error}
          </Alert>
        )}
        <Field required>
          <FieldLabel>Your email</FieldLabel>
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
              If this address belongs to an invited agency, a code is on its way.
            </p>
            <PinInput label="The code" length={6} value={code} onChange={setCode} type="numeric" />
          </>
        ) : null}
        <Button
          type="submit"
          loading={pending}
          disabled={email === '' || (asked && code.length !== 6)}
        >
          {asked ? 'Sign in' : 'Send me a code'}
        </Button>
      </form>
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{portal.agency}</h1>
        <p className="text-fg-muted">{`Your candidates for ${portal.company}`}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Submit a candidate</CardTitle>
        </CardHeader>
        <CardContent>
          {portal.jobs.length === 0 ? (
            <EmptyState icon={<icons.work aria-hidden />} title="No open jobs for you right now" />
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
                <Alert tone="danger" title="Not submitted">
                  {error}
                </Alert>
              )}
              {sent === null ? null : <Alert tone="success" title={`${sent} is submitted`} />}
              <Field required>
                <FieldLabel>Job</FieldLabel>
                <Select value={jobId} onValueChange={setJobId}>
                  <SelectTrigger aria-label="Job">
                    <SelectValue placeholder="Choose a job" />
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
                <FieldLabel>Candidate’s name</FieldLabel>
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
                <FieldLabel>Candidate’s email</FieldLabel>
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
                label="CV (optional)"
                hint="PDF, DOCX, ODT or RTF, up to 10 MB"
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
                Submit
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Submitted</CardTitle>
        </CardHeader>
        <CardContent>
          {portal.submissions.length === 0 ? (
            <EmptyState icon={<icons.people aria-hidden />} title="Nobody submitted yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portal.submissions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.candidate}</TableCell>
                    <TableCell>{s.job}</TableCell>
                    <TableCell>
                      <Badge size="sm" tone={s.outcome === 'active' ? 'info' : 'neutral'}>
                        {s.outcome === 'active'
                          ? (s.stage ?? 'In review')
                          : s.outcome === 'hired'
                            ? 'Hired'
                            : s.outcome === 'rejected'
                              ? 'Not progressed'
                              : 'Withdrawn'}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.submittedOn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
