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
import { t } from '../../../../lib/i18n';

type FormField = PublicJob['form'][number];

/** What goes in a box, by the field's key first and its kind after: a shape, never an instruction. */
const PLACEHOLDER = (): Readonly<Record<string, string>> => ({
  name: t('app.[company].[slug].apply.apply-form.ada_lovelace', 'Ada Lovelace'),
  email: 'ada@example.com',
  phone: '+44 7700 900123',
  url: 'https://',
  linkedin: 'https://www.linkedin.com/in/…',
  portfolio: 'https://',
  number: '0',
});
type Value = string | boolean | readonly string[];

const STEPS = () => [
  { id: 'cv', label: t('app.[company].[slug].apply.apply-form.your_cv', 'Your CV') },
  { id: 'details', label: t('app.[company].[slug].apply.apply-form.your_details', 'Your details') },
  {
    id: 'consent',
    label: t('app.[company].[slug].apply.apply-form.before_you_send', 'Before you send'),
  },
  {
    id: 'code',
    label: t('app.[company].[slug].apply.apply-form.check_your_email', 'Check your email'),
  },
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
          <SegmentedControlItem value="yes">
            {t('app.[company].[slug].apply.apply-form.yes', 'Yes')}
          </SegmentedControlItem>
          <SegmentedControlItem value="no">
            {t('app.[company].[slug].apply.apply-form.no', 'No')}
          </SegmentedControlItem>
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
              <SelectValue
                placeholder={t('app.[company].[slug].apply.apply-form.choose', 'Choose…')}
              />
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
          <Field key={o} orientation="horizontal" className="justify-start">
            <FieldControl>
              <Checkbox
                checked={chosen.includes(o)}
                onCheckedChange={(on) => {
                  onChange(on === true ? [...chosen, o] : chosen.filter((x) => x !== o));
                }}
              />
            </FieldControl>
            <FieldLabel>{o}</FieldLabel>
          </Field>
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
            placeholder={PLACEHOLDER()[field.key] ?? PLACEHOLDER()[field.kind]}
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
          title={t('app.[company].[slug].apply.apply-form.application_sent', 'Application sent')}
          description={t(
            'app.[company].[slug].apply.apply-form.will_be_in_touch_every_email',
            '{{name}} will be in touch. Every email has a link to follow your application.',
            { name: job.company.name },
          )}
          action={
            <Button asChild variant="secondary">
              <Link href="/search">
                {t('app.[company].[slug].apply.apply-form.see_more_jobs', 'See more jobs')}
              </Link>
            </Button>
          }
        />
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        label={t('app.[company].[slug].apply.apply-form.applying', 'Applying')}
        steps={account === null ? STEPS() : STEPS().slice(0, 3)}
        current={step}
        orientation="horizontal"
        size="sm"
      />
      {error === null ? null : (
        <Alert
          tone="danger"
          title={t(
            'app.[company].[slug].apply.apply-form.that_did_not_go_through',
            'That did not go through',
          )}
        >
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
            {fileFields.length === 0
              ? t('app.[company].[slug].apply.apply-form.nothing_to_upload', 'Nothing to upload')
              : t('app.[company].[slug].apply.apply-form.start_with_your_cv', 'Start with your CV')}
          </h2>
          {fileFields.map((f) => (
            <div key={f.key} className="flex flex-col gap-2">
              <Dropzone
                label={`${f.label}${f.required ? '' : ' (optional)'}`}
                hint={t(
                  'app.[company].[slug].apply.apply-form.pdf_docx_odt_or_rtf_up',
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
                  setError(null);
                  setFiles({ ...files, [f.key]: file });
                }}
              />
              {files[f.key] === undefined ? (
                f.key === 'cv' && account?.defaultCv != null ? (
                  <p className="text-sm text-fg-muted">
                    {t(
                      'app.[company].[slug].apply.apply-form.nothing_attached_your_default_cv_goes',
                      'Nothing attached: {{defaultCv}}, your default CV, goes with this application.',
                      { defaultCv: account.defaultCv },
                    )}
                  </p>
                ) : null
              ) : (
                <p className="text-sm">
                  {t('app.[company].[slug].apply.apply-form.kb', '{{value}} · {{String}} KB', {
                    value: files[f.key]?.name ?? '',
                    String: String(Math.ceil((files[f.key]?.size ?? 0) / 1024)),
                  })}
                </p>
              )}
            </div>
          ))}
          <Button
            variant="primary"
            className="self-end"
            disabled={filesMissing.length > 0}
            onClick={() => {
              setStep(1);
            }}
          >
            {t('app.[company].[slug].apply.apply-form.next', 'Next')}
          </Button>
        </section>
      ) : null}
      {step === 1 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">
            {t('app.[company].[slug].apply.apply-form.your_details', 'Your details')}
          </h2>
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
            <FieldLabel>
              {t(
                'app.[company].[slug].apply.apply-form.anything_we_can_adjust_for_you',
                'Anything we can adjust for you?',
              )}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={adjustments}
                onChange={(e) => {
                  setAdjustments(e.target.value);
                }}
                placeholder={t(
                  'app.[company].[slug].apply.apply-form.step_free_access_extra_time_another',
                  'Step-free access, extra time, another format…',
                )}
              />
            </FieldControl>
            <FieldDescription>
              {t(
                'app.[company].[slug].apply.apply-form.goes_to_the_recruiter_never_into',
                'Goes to the recruiter, never into anyone’s score.',
              )}
            </FieldDescription>
          </Field>
          <div className="flex justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(0);
              }}
            >
              {t('app.[company].[slug].apply.apply-form.back', 'Back')}
            </Button>
            <Button
              variant="primary"
              disabled={answersMissing.length > 0}
              onClick={() => {
                setStep(2);
              }}
            >
              {t('app.[company].[slug].apply.apply-form.next', 'Next')}
            </Button>
          </div>
        </section>
      ) : null}
      {step === 2 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">
            {t('app.[company].[slug].apply.apply-form.before_you_send', 'Before you send')}
          </h2>
          <Card padded className="flex flex-col gap-2">
            <h3 className="font-semibold">
              {t(
                'app.[company].[slug].apply.apply-form.processing_for_this_application',
                'Processing for this application',
              )}
            </h3>
            <p className="text-sm text-fg-muted">
              {t(
                'app.[company].[slug].apply.apply-form.processes_your_data_to_consider_you',
                '{{name}} processes your data to consider you for this job, as a step before a contract, and deletes it on the schedule the law in its country sets after a decision.',
                { name: job.company.name },
              )}
            </p>
          </Card>
          {aedt === null ? null : (
            <Card padded className="flex flex-col gap-2">
              <h3 className="font-semibold">
                {t(
                  'app.[company].[slug].apply.apply-form.an_automated_tool_reads_applications_for',
                  'An automated tool reads applications for this job',
                )}
              </h3>
              <p className="text-sm text-fg-muted">
                {t(
                  'app.[company].[slug].apply.apply-form.may_use_an_automated_employment_decision',
                  '{{name}} may use an automated employment decision tool, at the earliest ten business days from today, to compare what you send with the job’s criteria. A person decides. You may ask the recruiter for another way to be assessed, or for an accommodation, and what data it uses and how long it is kept. A summary of its latest bias audit is published by {{name}}.',
                  { name: job.company.name },
                )}
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
          <Field orientation="horizontal" className="items-start justify-start">
            <FieldControl>
              <Checkbox
                checked={consent}
                onCheckedChange={(on) => {
                  setConsent(on === true);
                }}
              />
            </FieldControl>
            <FieldLabel>
              {t(
                'app.[company].[slug].apply.apply-form.i_agree_to_processing_my_application',
                'I agree to {{name}} processing my application.',
                { name: job.company.name },
              )}
            </FieldLabel>
          </Field>
          <Field orientation="horizontal" className="items-start justify-start">
            <FieldControl>
              <Checkbox
                checked={pool}
                onCheckedChange={(on) => {
                  setPool(on === true);
                }}
              />
            </FieldControl>
            <FieldLabel>
              {t(
                'app.[company].[slug].apply.apply-form.keep_me_in_s_talent_pool',
                'Keep me in {{name}}’s talent pool for other jobs for 12 months (optional)',
                { name: job.company.name },
              )}
            </FieldLabel>
          </Field>
          {job.nycNotice ? (
            <Field orientation="horizontal" className="items-start justify-start">
              <FieldControl>
                <Checkbox
                  checked={nyc}
                  onCheckedChange={(on) => {
                    setNyc(on === true);
                  }}
                />
              </FieldControl>
              <FieldLabel>
                {t(
                  'app.[company].[slug].apply.apply-form.i_have_read_the_notice_that',
                  'I have read the notice that an automated tool helps review applications for this New York City job.',
                )}
              </FieldLabel>
            </Field>
          ) : null}
          <div className="flex justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(1);
              }}
            >
              {t('app.[company].[slug].apply.apply-form.back', 'Back')}
            </Button>
            {account === null ? (
              <Button
                variant="primary"
                disabled={
                  !consent || name === '' || !email.includes('@') || (job.nycNotice && !nyc)
                }
                loading={pending}
                onClick={askCode}
              >
                {t('app.[company].[slug].apply.apply-form.email_me_a_code', 'Email me a code')}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={
                  !consent || name === '' || !email.includes('@') || (job.nycNotice && !nyc)
                }
                loading={pending}
                onClick={send}
              >
                {t('app.[company].[slug].apply.apply-form.send_application', 'Send application')}
              </Button>
            )}
          </div>
        </section>
      ) : null}
      {step === 3 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">
            {t('app.[company].[slug].apply.apply-form.check_your_email', 'Check your email')}
          </h2>
          <p className="text-fg-muted">
            {t(
              'app.[company].[slug].apply.apply-form.we_sent_a_six_digit_code',
              'We sent a six-digit code to {{email}}. It confirms it’s you and keeps spam out.',
              { email },
            )}
          </p>
          <PinInput
            label={t('app.[company].[slug].apply.apply-form.the_code', 'The code')}
            length={6}
            value={code}
            onChange={setCode}
            type="numeric"
          />
          <div className="flex justify-between">
            <Button variant="ghost" loading={pending} onClick={askCode}>
              {t('app.[company].[slug].apply.apply-form.send_a_new_code', 'Send a new code')}
            </Button>
            <Button variant="primary" disabled={code.length !== 6} loading={pending} onClick={send}>
              {t('app.[company].[slug].apply.apply-form.send_application', 'Send application')}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
