'use client';

import {
  Alert,
  Button,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi } from '../../../lib/browser-api';

const words = (s: string) => s.replaceAll('_', ' ').replace(/^./u, (c) => c.toUpperCase());

/**
 * PRD §24.4: voluntary self-ID, asked only after applying. Sealed; never seen
 * by the hiring team or a model; counted only in groups of five or more.
 */
export function SelfIdForm({
  company,
  token,
  applicationId,
}: {
  readonly company: string;
  readonly token: string;
  readonly applicationId: string;
}): JSX.Element | null {
  const [asked, setAsked] = useState<{
    gender: readonly string[] | null;
    ethnicity: readonly string[] | null;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const path = `/me/applications/${applicationId}/self-id`;
  useEffect(() => {
    void publicApi<{ gender: string[] | null; ethnicity: string[] | null }>(company, path, {
      token,
    }).then((answer) => {
      if (answer.ok) setAsked(answer.data);
    });
  }, [company, token, path]);
  if (asked === null || (asked.gender === null && asked.ethnicity === null)) return null;
  if (done) return <Alert tone="success" title="Thank you. Your answers are sealed." />;
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--reach-line)] pt-3">
      <p className="font-medium">Optional: help us check we hire fairly</p>
      <p className="text-sm text-fg-muted">
        Your answers are sealed and kept apart from your application. Nobody deciding on it sees
        them, and they are only ever counted in groups of five or more people.
      </p>
      {(['gender', 'ethnicity'] as const).map((k) =>
        asked[k] === null ? null : (
          <Field key={k}>
            <FieldLabel>{k === 'gender' ? 'Gender' : 'Race or ethnicity'}</FieldLabel>
            <Select
              value={answers[k] ?? ''}
              onValueChange={(v) => {
                setAnswers({ ...answers, [k]: v });
              }}
            >
              <SelectTrigger aria-label={k === 'gender' ? 'Gender' : 'Race or ethnicity'}>
                <SelectValue placeholder="Prefer not to say" />
              </SelectTrigger>
              <SelectContent>
                {(asked[k] ?? []).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o === 'undisclosed' ? 'Prefer not to say' : words(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ),
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={() => {
            start(async () => {
              const answer = await publicApi(company, path, {
                method: 'POST',
                body: answers,
                token,
              });
              if (answer.ok) setDone(true);
            });
          }}
        >
          Send
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDone(true);
          }}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}
