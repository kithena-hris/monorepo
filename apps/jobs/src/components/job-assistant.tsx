'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Textarea,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { publicApi } from '../lib/browser-api';

/**
 * J8 on a job page (PRD §10.6): an AI, and it says so; it answers from the ad,
 * the company and the process only, and hands over to the recruiter when it
 * cannot.
 */
export function JobAssistant({
  company,
  slug,
}: {
  readonly company: string;
  readonly slug: string;
}): JSX.Element {
  const [question, setQuestion] = useState('');
  const [said, setSaid] = useState<readonly { q: string; a: string }[]>([]);
  const [handOver, setHandOver] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Questions about this job</CardTitle>
        <CardDescription>
          You are asking an AI assistant. It answers from this job ad and the hiring steps only, and
          it does not assess you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {said.map((x) => (
          <div key={x.q} className="text-sm">
            <p className="font-medium">{x.q}</p>
            <p>{x.a}</p>
          </div>
        ))}
        {error === null ? null : <Alert tone="warning" title={error} />}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = question.trim();
            if (q === '') return;
            start(async () => {
              const done = await publicApi<{ answer: string; answered: boolean }>(
                company,
                `/jobs/${slug}/questions`,
                { method: 'POST', body: { question: q } },
              );
              if (!done.ok) {
                setError(done.message);
                setHandOver(true);
                return;
              }
              setSaid([...said, { q, a: done.data.answer }]);
              setQuestion('');
              if (!done.data.answered) setHandOver(true);
            });
          }}
        >
          <Input
            aria-label="Your question"
            placeholder="Is it remote? What are the steps?"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
            }}
            className="flex-1"
          />
          <Button type="submit" loading={pending}>
            Ask
          </Button>
        </form>
        {!handOver ? null : sent ? (
          <Alert tone="success" title="Sent to the recruiter" />
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const done = await publicApi(company, `/jobs/${slug}/recruiter-questions`, {
                  method: 'POST',
                  body: { email, question: said.at(-1)?.q ?? question },
                });
                if (done.ok) setSent(true);
                else setError(done.message);
              });
            }}
          >
            <p className="text-sm">Ask the recruiter instead; they reply by email.</p>
            <Field required>
              <FieldLabel>Your email</FieldLabel>
              <FieldControl>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            {said.length === 0 ? (
              <Field required>
                <FieldLabel>Your question</FieldLabel>
                <FieldControl>
                  <Textarea
                    autoResize
                    value={question}
                    onChange={(e) => {
                      setQuestion(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
            ) : null}
            <Button type="submit" variant="secondary" loading={pending} disabled={email === ''}>
              Ask the recruiter
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
