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
import { t as tr } from '../../lib/i18n';
import { locale } from '@reach/ui/intl';

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
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), {
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
      : {
          ok: false,
          message:
            body?.error?.message ??
            tr('app.welcome.welcome.that_did_not_go_through', 'That did not go through'),
        };
  } catch {
    return {
      ok: false,
      message: tr(
        'app.welcome.welcome.not_reachable_right_now_try_again',
        'Not reachable right now. Try again in a moment.',
      ),
    };
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
    if (t === '')
      setError(
        tr(
          'app.welcome.welcome.open_this_page_from_the_link',
          'Open this page from the link in your welcome email.',
        ),
      );
    else load(t);
  }, []);
  if (page === null)
    return error === null ? (
      <Spinner label={tr('app.welcome.welcome.loading_your_welcome', 'Loading your welcome')} />
    ) : (
      <Alert
        tone="warning"
        title={tr('app.welcome.welcome.we_cant_show_this_page', 'We can’t show this page')}
      >
        {error}
      </Alert>
    );
  const done = page.tasks.filter((t) => t.done).length;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6">
        <h1 className="text-4xl font-bold tracking-tight text-balance">
          {tr('app.welcome.welcome.welcome', 'Welcome, {{name}}', { name: page.name })}
        </h1>
        <p className="text-lg text-fg-muted">
          {page.location === null
            ? tr('app.welcome.welcome.you_start_on', 'You start on {{day}}.', {
                day: day(page.startDate),
              })
            : tr('app.welcome.welcome.you_start_on_in', 'You start on {{day}}, in {{location}}.', {
                day: day(page.startDate),
                location: page.location,
              })}
        </p>
        <Card padded>
          <KeyValues
            items={[
              {
                label: tr('app.welcome.welcome.meets_you', 'Meets you'),
                value: page.manager ?? tr('app.welcome.welcome.your_manager', 'Your manager'),
              },
              {
                label: tr('app.welcome.welcome.your_buddy', 'Your buddy'),
                value:
                  page.buddy ??
                  tr('app.welcome.welcome.chosen_before_you_start', 'Chosen before you start'),
              },
            ]}
          />
        </Card>
        {page.firstWeek.length === 0 ? null : (
          <Card>
            <CardHeader>
              <CardTitle level={2}>
                {tr('app.welcome.welcome.your_first_week', 'Your first week')}
              </CardTitle>
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
          <CardTitle level={2}>
            {tr('app.welcome.welcome.before_you_start', 'Before you start')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error === null ? null : (
            <Alert
              tone="danger"
              title={tr('app.welcome.welcome.that_did_not_go_through', 'That did not go through')}
            >
              {error}
            </Alert>
          )}
          <p className="text-sm text-fg-muted">
            {tr('app.welcome.welcome.of_done', '{{String}} of {{String2}} done', {
              String: String(done),
              String2: String(page.tasks.length),
            })}
          </p>
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
            {tr(
              'app.welcome.welcome.on_your_start_date_youll_get',
              'On your start date you’ll get your Kithena account and this moves into the app.',
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
