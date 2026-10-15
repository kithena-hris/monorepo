'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  SegmentedControl,
  SegmentedControlItem,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { publicApi } from '../lib/browser-api';

/** J11: "Email me jobs like this", sent only once the address confirms. */
export function JobAlert({
  company,
  name,
}: {
  readonly company: string;
  readonly name: string;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  // 'idle', 'sent', or what went wrong.
  const [state, setState] = useState('idle');
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{`Email me new jobs at ${name}`}</CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'sent' ? (
          <Alert tone="success" title="Check your inbox">
            We sent a link to confirm. Nothing is sent until you do.
          </Alert>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const done = await publicApi(company, '/alerts', {
                  method: 'POST',
                  body: { email, query, frequency },
                });
                setState(done.ok ? 'sent' : done.message);
              });
            }}
          >
            {state === 'idle' ? null : (
              <Alert tone="danger" title="That did not go through">
                {state}
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field required>
                <FieldLabel>Your email</FieldLabel>
                <FieldControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>Jobs matching (optional)</FieldLabel>
                <FieldControl>
                  <Input
                    value={query}
                    placeholder="designer"
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
            </div>
            <SegmentedControl
              aria-label="How often"
              value={frequency}
              onValueChange={(v) => {
                setFrequency(v === 'daily' ? 'daily' : 'weekly');
              }}
            >
              <SegmentedControlItem value="weekly">Weekly</SegmentedControlItem>
              <SegmentedControlItem value="daily">Daily</SegmentedControlItem>
            </SegmentedControl>
            <Button type="submit" loading={pending} disabled={email === ''}>
              Email me
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
