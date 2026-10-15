'use client';

import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  KeyValues,
  Spinner,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { tokenFromHash } from '../../lib/browser-api';

/**
 * O5 (ONB-011): what a new hire sees before they have an account: when and
 * where, who meets them, their buddy, the first week, and their own tasks to
 * tick. Onboarding's public route, called from the browser with the token
 * from the fragment in its header; on the start date the tenant app takes
 * over.
 */

interface Page {
  readonly name: string;
  readonly startDate: string;
  readonly location: string | null;
  readonly workMode: string;
  readonly manager: string | null;
  readonly buddy: string | null;
  readonly firstWeek: readonly {
    readonly title: string;
    readonly dueOn: string;
    readonly mine: boolean;
  }[];
  readonly tasks: readonly {
    readonly id: string;
    readonly title: string;
    readonly dueOn: string;
    readonly done: boolean;
  }[];
}

const base = () =>
  (
    process.env['NEXT_PUBLIC_ONBOARDING_PUBLIC_URL'] ??
    process.env['NEXT_PUBLIC_RECRUITING_PUBLIC_URL'] ??
    'http://localhost:4006'
  ).replace(/\/$/u, '');
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

async function call(
  token: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const r = await fetch(`${base()}/v1/onboarding${path}`, {
      method,
      headers: { 'x-welcome-token': token },
    });
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    return r.ok
      ? { ok: true, data: body }
      : { ok: false, message: body?.error?.message ?? 'That did not go through' };
  } catch {
    return { ok: false, message: 'Not reachable right now. Try again in a moment.' };
  }
}

export function Welcome(): JSX.Element {
  const [token, setToken] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = (t: string) =>
    void call(t, '/welcome').then((a) => {
      if (a.ok) setPage(a.data as Page);
      else setError(a.message);
    });
  useEffect(() => {
    const t = tokenFromHash();
    setToken(t);
    if (t === '') setError('Open this page from the link in your welcome email.');
    else load(t);
  }, []);
  if (page === null)
    return error === null ? (
      <Spinner label="Loading your welcome" />
    ) : (
      <Alert tone="warning" title="We can’t show this page">
        {error}
      </Alert>
    );
  const done = page.tasks.filter((t) => t.done).length;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6">
        <h1 className="text-4xl font-bold tracking-tight text-balance">{`Welcome, ${page.name}`}</h1>
        <p className="text-lg text-fg-muted">{`You start on ${day(page.startDate)}${page.location === null ? '' : `, in ${page.location}`}.`}</p>
        <Card padded>
          <KeyValues
            items={[
              { label: 'Meets you', value: page.manager ?? 'Your manager' },
              { label: 'Your buddy', value: page.buddy ?? 'Chosen before you start' },
            ]}
          />
        </Card>
        {page.firstWeek.length === 0 ? null : (
          <Card>
            <CardHeader>
              <CardTitle level={2}>Your first week</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValues
                items={page.firstWeek.map((w) => ({ label: day(w.dueOn), value: w.title }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Before you start</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error === null ? null : (
            <Alert tone="danger" title="That did not go through">
              {error}
            </Alert>
          )}
          <p className="text-sm text-fg-muted">{`${String(done)} of ${String(page.tasks.length)} done`}</p>
          {page.tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <Checkbox
                id={`task-${t.id}`}
                checked={t.done}
                disabled={t.done || pending}
                onCheckedChange={(on) => {
                  if (on !== true) return;
                  start(async () => {
                    const a = await call(token, `/welcome/tasks/${t.id}/complete`, 'POST');
                    if (!a.ok) setError(a.message);
                    else load(token);
                  });
                }}
              />
              <label
                htmlFor={`task-${t.id}`}
                className={t.done ? 'text-fg-muted line-through' : ''}
              >
                {t.title}
              </label>
            </div>
          ))}
          <p className="text-xs text-fg-muted">
            On your start date you’ll get your Kithena account and this moves into the app.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
