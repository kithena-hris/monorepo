'use client';

import {
  Alert,
  Button,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';

/** About five minutes; the answers go to the hiring team only. */
export function RefereeForm({ company }: { readonly company: string }): JSX.Element {
  const [token, setToken] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({ hire_again: 'yes' });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    setToken(tokenFromHash());
  }, []);
  const set = (k: string, v: string) => {
    setAnswers({ ...answers, [k]: v });
  };
  if (sent)
    return (
      <EmptyState
        icon={<icons.success aria-hidden />}
        title="Thank you"
        description="Your answers are with the hiring team."
      />
    );
  return (
    <form
      className="mx-auto flex w-full max-w-xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const done = await publicApi(company, '/references', {
            method: 'POST',
            body: { answers },
            token,
          });
          if (!done.ok) setError(done.message);
          else setSent(true);
        });
      }}
    >
      <h1 className="text-2xl font-bold">A reference</h1>
      <p className="text-fg-muted">You were named as a referee. No account needed.</p>
      {token === '' ? (
        <Alert tone="warning" title="Open this page from the link in the email" />
      ) : null}
      {error === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {error}
        </Alert>
      )}
      <Field required>
        <FieldLabel>How do you know them?</FieldLabel>
        <FieldControl>
          <Input
            value={answers['relationship'] ?? ''}
            onChange={(e) => {
              set('relationship', e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Would you hire them again?</FieldLabel>
        <SegmentedControl
          aria-label="Would you hire them again?"
          value={answers['hire_again'] ?? 'yes'}
          onValueChange={(v) => {
            set('hire_again', v);
          }}
        >
          <SegmentedControlItem value="yes">Yes</SegmentedControlItem>
          <SegmentedControlItem value="maybe">Maybe</SegmentedControlItem>
          <SegmentedControlItem value="no">No</SegmentedControlItem>
        </SegmentedControl>
      </Field>
      <Field required>
        <FieldLabel>Strengths</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={answers['strengths'] ?? ''}
            onChange={(e) => {
              set('strengths', e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Something to develop</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={answers['develop'] ?? ''}
            onChange={(e) => {
              set('develop', e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Button
        type="submit"
        disabled={
          token === '' ||
          (answers['relationship'] ?? '') === '' ||
          (answers['strengths'] ?? '') === ''
        }
        loading={pending}
      >
        Send reference
      </Button>
    </form>
  );
}
