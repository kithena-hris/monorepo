'use client';

import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  Stepper,
  Textarea,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

import { accountApi } from '../../../lib/browser-api';
import { t } from '../../../lib/i18n';

/**
 * The CV writer, in three steps: say what you have done in your own words,
 * read the draft the AI laid out and change any line, keep it as a PDF in
 * your library. The AI sees only what is typed here. It assesses nobody.
 */

interface Entry {
  readonly title: string;
  readonly organisation: string;
  readonly from: string;
  readonly to: string;
  readonly bullets: readonly string[];
}
interface Draft {
  readonly name: string;
  readonly headline: string;
  readonly location: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly summary: string;
  readonly experience: readonly Entry[];
  readonly education: readonly Entry[];
  readonly skills: readonly string[];
  readonly languages: readonly string[];
}

const STEPS = () => [
  { id: 'say', label: t('app.me.cv.cv-writer.what_you_have_done', 'What you have done') },
  { id: 'edit', label: t('app.me.cv.cv-writer.read_the_draft', 'Read the draft') },
  { id: 'keep', label: t('app.me.cv.cv-writer.in_your_library', 'In your library') },
];

const empty: Entry = { title: '', organisation: '', from: '', to: '', bullets: [] };

function EntryFields({
  label,
  list,
  onChange,
}: {
  readonly label: string;
  readonly list: readonly Entry[];
  readonly onChange: (next: readonly Entry[]) => void;
}): JSX.Element {
  const set = (i: number, patch: Partial<Entry>): void => {
    onChange(list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{label}</h2>
      {list.map((e, i) => (
        <div key={String(i)} className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field required>
              <FieldLabel>{t('app.me.cv.cv-writer.title', 'Title')}</FieldLabel>
              <FieldControl>
                <Input
                  value={e.title}
                  onChange={(ev) => {
                    set(i, { title: ev.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.where', 'Where')}</FieldLabel>
              <FieldControl>
                <Input
                  value={e.organisation}
                  onChange={(ev) => {
                    set(i, { organisation: ev.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.from', 'From')}</FieldLabel>
              <FieldControl>
                <Input
                  value={e.from}
                  placeholder="2021"
                  onChange={(ev) => {
                    set(i, { from: ev.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.to', 'To')}</FieldLabel>
              <FieldControl>
                <Input
                  value={e.to}
                  placeholder={t('app.me.cv.cv-writer.now', 'now')}
                  onChange={(ev) => {
                    set(i, { to: ev.target.value });
                  }}
                />
              </FieldControl>
            </Field>
          </div>
          <Field>
            <FieldLabel>
              {t('app.me.cv.cv-writer.what_you_did_one_line_each', 'What you did, one line each')}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={e.bullets.join('\n')}
                onChange={(ev) => {
                  set(i, { bullets: ev.target.value.split('\n') });
                }}
              />
            </FieldControl>
          </Field>
          <div>
            <Button
              size="xs"
              variant="ghost"
              startIcon={<icons.remove aria-hidden />}
              onClick={() => {
                onChange(list.filter((_, j) => j !== i));
              }}
            >
              {t('app.me.cv.cv-writer.remove', 'Remove')}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="secondary"
          startIcon={<icons.add aria-hidden />}
          onClick={() => {
            onChange([...list, empty]);
          }}
        >
          {t('app.me.cv.cv-writer.add_one', 'Add one')}
        </Button>
      </div>
    </section>
  );
}

export function CvWriter({
  name,
  email,
}: {
  readonly name: string;
  readonly email: string;
}): JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({
    targetRole: '',
    about: '',
    experience: '',
    education: '',
    skills: '',
    languages: '',
    location: '',
    phone: '',
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ask = (key: keyof typeof answers) => (ev: { target: { value: string } }) => {
    setAnswers({ ...answers, [key]: ev.target.value });
  };
  const write = (): void => {
    start(async () => {
      setError(null);
      const answer = await accountApi<Draft>('/cv-draft', { method: 'POST', body: answers });
      if (!answer.ok) setError(answer.message);
      else {
        setDraft(answer.data);
        setStep(1);
      }
    });
  };
  const keep = (): void => {
    if (draft === null) return;
    start(async () => {
      setError(null);
      const cleaned: Draft = {
        ...draft,
        experience: draft.experience.map((e) => ({
          ...e,
          bullets: e.bullets.map((b) => b.trim()).filter(Boolean),
        })),
        education: draft.education.map((e) => ({
          ...e,
          bullets: e.bullets.map((b) => b.trim()).filter(Boolean),
        })),
        skills: draft.skills.map((s) => s.trim()).filter(Boolean),
        languages: draft.languages.map((s) => s.trim()).filter(Boolean),
      };
      const answer = await accountApi('/cvs/from-draft', { method: 'POST', body: cleaned });
      if (!answer.ok) setError(answer.message);
      else {
        setStep(2);
        router.refresh();
      }
    });
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">
          {t('app.me.cv.cv-writer.write_your_cv', 'Write your CV')}
        </h1>
        <p className="text-fg-muted">
          {t('app.me.cv.cv-writer.for', 'For {{name}}, {{email}}.', { name, email })}{' '}
          {t(
            'app.me.cv.cv-writer.say_what_you_have_done_in',
            'Say what you have done, in your own words. An AI lays it out as a CV from what you said and nothing else; you change any line before it is kept.',
          )}
        </p>
      </div>
      <Stepper
        label={t('app.me.cv.cv-writer.writing_your_cv', 'Writing your CV')}
        steps={STEPS()}
        current={step}
        orientation="horizontal"
        size="sm"
      />
      {error === null ? null : (
        <Alert
          tone="danger"
          title={t('app.me.cv.cv-writer.that_did_not_go_through', 'That did not go through')}
        >
          {error}
        </Alert>
      )}
      {step === 0 ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            write();
          }}
        >
          <Field required>
            <FieldLabel>
              {t('app.me.cv.cv-writer.the_kind_of_role_you_want', 'The kind of role you want')}
            </FieldLabel>
            <FieldControl>
              <Input
                value={answers.targetRole}
                placeholder={t(
                  'app.me.cv.cv-writer.backend_engineer_berlin_or_remote',
                  'Backend engineer, Berlin or remote',
                )}
                onChange={ask('targetRole')}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t('app.me.cv.cv-writer.about_you', 'About you')}</FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={answers.about}
                placeholder={t(
                  'app.me.cv.cv-writer.who_you_are_at_work_what',
                  'Who you are at work, what you care about, what you are good at.',
                )}
                onChange={ask('about')}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>
              {t('app.me.cv.cv-writer.where_you_have_worked', 'Where you have worked')}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={answers.experience}
                placeholder={t(
                  'app.me.cv.cv-writer.one_job_per_paragraph_the_title',
                  'One job per paragraph: the title, the company, the years, and what you did there. Numbers help: "cut deploy time from 40 to 8 minutes".',
                )}
                onChange={ask('experience')}
              />
            </FieldControl>
            <FieldDescription>
              {t(
                'app.me.cv.cv-writer.only_what_you_write_here_goes',
                'Only what you write here goes into the CV. Nothing is invented.',
              )}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>
              {t('app.me.cv.cv-writer.education_and_training', 'Education and training')}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={answers.education}
                placeholder={t(
                  'app.me.cv.cv-writer.degrees_courses_certificates_with_the_years',
                  'Degrees, courses, certificates, with the years.',
                )}
                onChange={ask('education')}
              />
            </FieldControl>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.skills', 'Skills')}</FieldLabel>
              <FieldControl>
                <Input
                  value={answers.skills}
                  placeholder={t(
                    'app.me.cv.cv-writer.go_postgres_kubernetes_on_call',
                    'Go, Postgres, Kubernetes, on call',
                  )}
                  onChange={ask('skills')}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>
                {t('app.me.cv.cv-writer.languages_you_speak', 'Languages you speak')}
              </FieldLabel>
              <FieldControl>
                <Input
                  value={answers.languages}
                  placeholder={t('app.me.cv.cv-writer.english_spanish', 'English, Spanish')}
                  onChange={ask('languages')}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.where_you_live', 'Where you live')}</FieldLabel>
              <FieldControl>
                <Input
                  value={answers.location}
                  placeholder={t('app.me.cv.cv-writer.madrid', 'Madrid')}
                  onChange={ask('location')}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.phone', 'Phone')}</FieldLabel>
              <FieldControl>
                <Input type="tel" value={answers.phone} onChange={ask('phone')} />
              </FieldControl>
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <Button asChild variant="ghost">
              <Link href="/me">{t('app.me.cv.cv-writer.back', 'Back')}</Link>
            </Button>
            <Button
              type="submit"
              startIcon={<icons.assistant aria-hidden />}
              disabled={answers.targetRole.trim() === '' || answers.experience.trim().length < 20}
              loading={pending}
            >
              {t('app.me.cv.cv-writer.write_the_draft', 'Write the draft')}
            </Button>
          </div>
        </form>
      ) : null}
      {step === 1 && draft !== null ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field required>
              <FieldLabel>{t('app.me.cv.cv-writer.name', 'Name')}</FieldLabel>
              <FieldControl>
                <Input
                  value={draft.name}
                  onChange={(e) => {
                    setDraft({ ...draft, name: e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.headline', 'Headline')}</FieldLabel>
              <FieldControl>
                <Input
                  value={draft.headline}
                  onChange={(e) => {
                    setDraft({ ...draft, headline: e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.email', 'Email')}</FieldLabel>
              <FieldControl>
                <Input
                  value={draft.email}
                  onChange={(e) => {
                    setDraft({ ...draft, email: e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.phone', 'Phone')}</FieldLabel>
              <FieldControl>
                <Input
                  value={draft.phone ?? ''}
                  onChange={(e) => {
                    setDraft({ ...draft, phone: e.target.value === '' ? null : e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t('app.me.cv.cv-writer.location', 'Location')}</FieldLabel>
              <FieldControl>
                <Input
                  value={draft.location ?? ''}
                  onChange={(e) => {
                    setDraft({ ...draft, location: e.target.value === '' ? null : e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t('app.me.cv.cv-writer.profile', 'Profile')}</FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                value={draft.summary}
                onChange={(e) => {
                  setDraft({ ...draft, summary: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <EntryFields
            label={t('app.me.cv.cv-writer.experience', 'Experience')}
            list={draft.experience}
            onChange={(experience) => {
              setDraft({ ...draft, experience });
            }}
          />
          <EntryFields
            label={t('app.me.cv.cv-writer.education', 'Education')}
            list={draft.education}
            onChange={(education) => {
              setDraft({ ...draft, education });
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>
                {t('app.me.cv.cv-writer.skills_comma_separated', 'Skills, comma separated')}
              </FieldLabel>
              <FieldControl>
                <Input
                  value={draft.skills.join(', ')}
                  onChange={(e) => {
                    setDraft({ ...draft, skills: e.target.value.split(',').map((s) => s.trim()) });
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>
                {t('app.me.cv.cv-writer.languages_comma_separated', 'Languages, comma separated')}
              </FieldLabel>
              <FieldControl>
                <Input
                  value={draft.languages.join(', ')}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      languages: e.target.value.split(',').map((s) => s.trim()),
                    });
                  }}
                />
              </FieldControl>
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                setStep(0);
              }}
            >
              {t('app.me.cv.cv-writer.say_it_differently', 'Say it differently')}
            </Button>
            <Button
              disabled={draft.name.trim() === '' || draft.experience.length === 0}
              loading={pending}
              onClick={keep}
            >
              {t('app.me.cv.cv-writer.keep_it_as_a_pdf', 'Keep it as a PDF')}
            </Button>
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <Alert
          tone="success"
          title={t('app.me.cv.cv-writer.your_cv_is_in_your_library', 'Your CV is in your library')}
        >
          {t(
            'app.me.cv.cv-writer.it_goes_with_your_applications_when',
            'It goes with your applications when you attach none, once you make it the default.',
          )}
          <div className="mt-3 flex gap-2">
            <Button asChild size="sm">
              <Link href="/me">
                {t('app.me.cv.cv-writer.your_applications_and_cvs', 'Your applications and CVs')}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/">{t('app.me.cv.cv-writer.find_a_job', 'Find a job')}</Link>
            </Button>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
