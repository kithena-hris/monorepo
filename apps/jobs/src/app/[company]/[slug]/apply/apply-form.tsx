'use client';

import type { PublicJob } from '@kithena/contracts';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dropzone,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  PinInput,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  Textarea,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { asUpload, publicApi } from '../../../../lib/browser-api';

type FormField = PublicJob['form'][number];

/** What goes in a box, by the field's key first and its kind after: a shape, never an instruction. */
const PLACEHOLDER: Readonly<Record<string, string>> = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+44 7700 900123',
  url: 'https://',
  linkedin: 'https://www.linkedin.com/in/…',
  portfolio: 'https://',
  number: '0',
};
type Value = string | boolean | readonly string[];

const STEPS = [
  { id: 'cv', label: 'Your CV' },
  { id: 'details', label: 'Your details' },
  { id: 'consent', label: 'Before you send' },
  { id: 'code', label: 'Check your email' },
];

/** One answer, drawn as its kind asks. */
function Answer({
  field,
  value,
  onChange,
}: {
  readonly field: FormField;
  readonly value: Value | undefined;
  readonly onChange: (v: Value) => void;
}): JSX.Element {
  const id = `answer-${field.key}`;
  if (field.kind === 'yes_no')
    return (
      <Field required={field.required}>
        <FieldLabel>{field.label}</FieldLabel>
        <SegmentedControl
          aria-label={field.label}
          value={value === undefined ? '' : value === true ? 'yes' : 'no'}
          onValueChange={(v) => {
            onChange(v === 'yes');
          }}
        >
          <SegmentedControlItem value="yes">Yes</SegmentedControlItem>
          <SegmentedControlItem value="no">No</SegmentedControlItem>
        </SegmentedControl>
      </Field>
    );
  if (field.kind === 'choice')
    return (
      <Field required={field.required}>
        <FieldLabel>{field.label}</FieldLabel>
        <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  if (field.kind === 'choices') {
    const chosen = Array.isArray(value) ? (value as readonly string[]) : [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{field.label}</legend>
        {field.options.map((o, i) => (
          <div key={o} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${String(i)}`}
              checked={chosen.includes(o)}
              onCheckedChange={(on) => {
                onChange(on === true ? [...chosen, o] : chosen.filter((x) => x !== o));
              }}
            />
            <label htmlFor={`${id}-${String(i)}`}>{o}</label>
          </div>
        ))}
      </fieldset>
    );
  }
  const text = typeof value === 'string' ? value : '';
  if (field.kind === 'date')
    return (
      <Field required={field.required}>
        <FieldLabel>{field.label}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={field.label}
            value={text === '' ? null : text}
            onChange={(d) => {
              onChange(d ?? '');
            }}
          />
        </FieldControl>
      </Field>
    );
  return (
    <Field required={field.required}>
      <FieldLabel>{field.label}</FieldLabel>
      <FieldControl>
        {field.kind === 'long_text' ? (
          <Textarea
            autoResize
            value={text}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
        ) : (
          <Input
            type={
              field.kind === 'email'
                ? 'email'
                : field.kind === 'phone'
                  ? 'tel'
                  : field.kind === 'url'
                    ? 'url'
                    : field.kind === 'number'
                      ? 'number'
                      : 'text'
            }
            placeholder={PLACEHOLDER[field.key] ?? PLACEHOLDER[field.kind]}
            autoComplete={
              field.key === 'name'
                ? 'name'
                : field.key === 'email'
                  ? 'email'
                  : field.key === 'phone'
                    ? 'tel'
                    : undefined
            }
            value={text}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
        )}
      </FieldControl>
    </Field>
  );
}

const missing = (fields: readonly FormField[], answers: Readonly<Record<string, Value>>) =>
  fields.filter((f) => {
    const v = answers[f.key];
    return f.required && (v === undefined || v === '' || (Array.isArray(v) && v.length === 0));
  });

/** The signed-in account, when there is one: its address is proven, so no code; its default CV stands in for one not attached. */
export interface ApplyingAccount {
  readonly name: string;
  readonly email: string;
  readonly defaultCv: string | null;
}

/** J4, J5: apply on a phone; CV first, then the fields, then consent, then the emailed code, or none when signed in. */
export function ApplyForm({
  job,
  source,
  account = null,
}: {
  readonly job: PublicJob;
  readonly source: string | null;
  readonly account?: ApplyingAccount | null;
}): JSX.Element {
  const company = job.company.slug;
  const fileFields = job.form.filter((f) => f.kind === 'file');
  const answerFields = job.form.filter((f) => f.kind !== 'file');
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<Readonly<Record<string, File>>>({});
  const [answers, setAnswers] = useState<Readonly<Record<string, Value>>>(
    account === null ? {} : { name: account.name, email: account.email },
  );
  const [adjustments, setAdjustments] = useState('');
  const [consent, setConsent] = useState(false);
  const [pool, setPool] = useState(false);
  // NYC Local Law 144 (PRD §22.8): the notice is given here, when they apply.
  const [aedt, setAedt] = useState<readonly string[] | null>(null);
  useEffect(() => {
    void publicApi<{ automatedTool: boolean; criteria: string[] }>(
      company,
      `/jobs/${job.slug}/notices`,
    ).then((answer) => {
      if (answer.ok && answer.data.automatedTool) setAedt(answer.data.criteria);
    });
  }, [company, job.slug]);
  const [nyc, setNyc] = useState(false);
  const [code, setCode] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  const name = typeof answers['name'] === 'string' ? answers['name'] : '';
  const email = typeof answers['email'] === 'string' ? answers['email'] : '';
  // A required CV is met by the library's default when signed in.
  const filesMissing = fileFields.filter(
    (f) =>
      f.required && files[f.key] === undefined && !(f.key === 'cv' && account?.defaultCv != null),
  );
  const answersMissing = missing(answerFields, answers);

  const askCode = () => {
    start(async () => {
      setError(null);
      const done = await publicApi(company, '/codes', {
        method: 'POST',
        body: { jobSlug: job.slug, email, name },
      });
      if (!done.ok) setError(done.message);
      else setStep(3);
    });
  };

  const send = () => {
    start(async () => {
      setError(null);
      const uploads = await Promise.all(
        Object.entries(files).map(([field, file]) => asUpload(field, file)),
      );
      const typed = Object.fromEntries(
        Object.entries(answers)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [
            k,
            answerFields.find((f) => f.key === k)?.kind === 'number' ? Number(v) : v,
          ]),
      );
      const done = await publicApi(company, '/applications', {
        method: 'POST',
        body: {
          payload: {
            jobId: job.jobId,
            language: job.language,
            answers: typed,
            consent: {
              application: true,
              talentPool: pool,
              ...(job.nycNotice ? { nycNotice: nyc } : {}),
            },
            adjustments: adjustments.trim() === '' ? null : adjustments,
            source: source === null ? { target: 'kithena_jobs' } : { link: source.slice(0, 80) },
            code: account === null ? code : '000000',
            ...(website === '' ? {} : { website }),
          },
          files: uploads,
        },
      });
      if (!done.ok) setError(done.message);
      else setSent(true);
    });
  };

  if (sent)
    return (
      <Card padded>
        <EmptyState
          icon={<icons.success aria-hidden />}
          title="Application sent"
          description={`${job.company.name} will be in touch. Every email has a link to follow your application.`}
          action={
            <Button asChild variant="secondary">
              <Link href="/search">See more jobs</Link>
            </Button>
          }
        />
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        label="Applying"
        steps={account === null ? STEPS : STEPS.slice(0, 3)}
        current={step}
        orientation="horizontal"
        size="sm"
      />
      {error === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {error}
        </Alert>
      )}
      {/* A field no person sees and a bot fills in. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
        value={website}
        onChange={(e) => {
          setWebsite(e.target.value);
        }}
      />
      {step === 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">
            {fileFields.length === 0 ? 'Nothing to upload' : 'Start with your CV'}
          </h2>
          {fileFields.map((f) => (
            <div key={f.key} className="flex flex-col gap-2">
              <Dropzone
                label={`${f.label}${f.required ? '' : ' (optional)'}`}
                hint="PDF, DOCX, ODT or RTF, up to 10 MB"
                accept=".pdf,.docx,.odt,.rtf,application/pdf"
                onFiles={(picked) => {
                  const file = picked[0];
                  if (file === undefined) return;
                  if (file.size > 10 * 1024 * 1024) {
                    setError(`${file.name} is over 10 MB.`);
                    return;
                  }
                  setError(null);
                  setFiles({ ...files, [f.key]: file });
                }}
              />
              {files[f.key] === undefined ? (
                f.key === 'cv' && account?.defaultCv != null ? (
                  <p className="text-sm text-fg-muted">{`Nothing attached: ${account.defaultCv}, your default CV, goes with this application.`}</p>
                ) : null
              ) : (
                <p className="text-sm">{`${files[f.key]?.name ?? ''} · ${String(Math.ceil((files[f.key]?.size ?? 0) / 1024))} KB`}</p>
              )}
            </div>
          ))}
          <Button
            className="self-end"
            disabled={filesMissing.length > 0}
            onClick={() => {
              setStep(1);
            }}
          >
            Next
          </Button>
        </section>
      ) : null}
      {step === 1 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Your details</h2>
          {answerFields.map((f) => (
            <Answer
              key={f.key}
              field={f}
              value={answers[f.key]}
              onChange={(v) => {
                setAnswers({ ...answers, [f.key]: v });
              }}
            />
          ))}
          <Field>
            <FieldLabel>Anything we can adjust for you?</FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={adjustments}
                onChange={(e) => {
                  setAdjustments(e.target.value);
                }}
                placeholder="Step-free access, extra time, another format…"
              />
            </FieldControl>
            <FieldDescription>Goes to the recruiter, never into anyone’s score.</FieldDescription>
          </Field>
          <div className="flex justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(0);
              }}
            >
              Back
            </Button>
            <Button
              disabled={answersMissing.length > 0}
              onClick={() => {
                setStep(2);
              }}
            >
              Next
            </Button>
          </div>
        </section>
      ) : null}
      {step === 2 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Before you send</h2>
          <Card padded className="flex flex-col gap-2">
            <h3 className="font-semibold">Processing for this application</h3>
            <p className="text-sm text-fg-muted">
              {`${job.company.name} processes your data to consider you for this job, as a step before a contract, and deletes it on the schedule the law in its country sets after a decision.`}
            </p>
          </Card>
          {aedt === null ? null : (
            <Card padded className="flex flex-col gap-2">
              <h3 className="font-semibold">An automated tool reads applications for this job</h3>
              <p className="text-sm text-fg-muted">
                {`${job.company.name} may use an automated employment decision tool, at the earliest ten business days from today, to compare what you send with the job’s criteria. A person decides. You may ask the recruiter for another way to be assessed, or for an accommodation, and what data it uses and how long it is kept. A summary of its latest bias audit is published by ${job.company.name}.`}
              </p>
              {aedt.length === 0 ? null : (
                <ul className="list-disc ps-5 text-sm">
                  {aedt.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <div className="flex items-start gap-3">
            <Checkbox
              id="consent"
              checked={consent}
              onCheckedChange={(on) => {
                setConsent(on === true);
              }}
            />
            <label htmlFor="consent">{`I agree to ${job.company.name} processing my application.`}</label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="pool"
              checked={pool}
              onCheckedChange={(on) => {
                setPool(on === true);
              }}
            />
            <label htmlFor="pool">{`Keep me in ${job.company.name}’s talent pool for other jobs for 12 months (optional)`}</label>
          </div>
          {job.nycNotice ? (
            <div className="flex items-start gap-3">
              <Checkbox
                id="nyc"
                checked={nyc}
                onCheckedChange={(on) => {
                  setNyc(on === true);
                }}
              />
              <label htmlFor="nyc">
                I have read the notice that an automated tool helps review applications for this New
                York City job.
              </label>
            </div>
          ) : null}
          <div className="flex justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(1);
              }}
            >
              Back
            </Button>
            {account === null ? (
              <Button
                disabled={
                  !consent || name === '' || !email.includes('@') || (job.nycNotice && !nyc)
                }
                loading={pending}
                onClick={askCode}
              >
                Email me a code
              </Button>
            ) : (
              <Button
                disabled={
                  !consent || name === '' || !email.includes('@') || (job.nycNotice && !nyc)
                }
                loading={pending}
                onClick={send}
              >
                Send application
              </Button>
            )}
          </div>
        </section>
      ) : null}
      {step === 3 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Check your email</h2>
          <p className="text-fg-muted">{`We sent a six-digit code to ${email}. It confirms it’s you and keeps spam out.`}</p>
          <PinInput label="The code" length={6} value={code} onChange={setCode} type="numeric" />
          <div className="flex justify-between">
            <Button variant="ghost" loading={pending} onClick={askCode}>
              Send a new code
            </Button>
            <Button disabled={code.length !== 6} loading={pending} onClick={send}>
              Send application
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
