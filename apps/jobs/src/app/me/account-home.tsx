'use client';

import type { CandidatePage } from '@kithena/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Dropzone,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  List,
  ListItem,
  RowMenu,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  Switch,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type JSX } from 'react';

import type { AccountHome as Home } from '../../lib/account';
import { accountApi, asUpload, publicApi } from '../../lib/browser-api';
import { NoticeDialog, NoticeList, noticesOf, type Notice } from '../../components/asks';
import { t } from '../../lib/i18n';
import { locale } from '@reach/ui/intl';

/**
 * Every application, across every company, in one place: searched, filtered
 * by where it stands, grouped by company or by state, each with its steps
 * and a way to withdraw. An offer or a contract opens the company's own page,
 * where the company's rules decide what can be done. The CV library and the
 * account sit beside them.
 */

type Row = {
  readonly company: Home['companies'][number];
  readonly application: CandidatePage['applications'][number];
};

const OUTCOME = (): Readonly<Record<string, string>> => ({
  active: t('app.me.account-home.in_progress', 'In progress'),
  hired: t('app.me.account-home.hired', 'Hired'),
  rejected: t('app.me.account-home.not_this_time', 'Not this time'),
  withdrawn: t('app.me.account-home.withdrawn', 'Withdrawn'),
});
const TONE: Readonly<Record<string, 'accent' | 'success' | 'neutral' | 'warning'>> = {
  active: 'accent',
  hired: 'success',
  rejected: 'neutral',
  withdrawn: 'neutral',
};

const kb = (n: number): string =>
  t('app.me.account-home.kb', '{{size}} KB', { size: Math.ceil(n / 1024) });
const CONSENT_NOTICE = (): string =>
  t(
    'app.me.account-home.consent_notice',
    'Kithena Jobs keeps your name, address and the CVs you upload so you can apply to any company here without typing them again. You can take this back any time; what you already sent to a company stays with that company.',
  );

export function AccountHome({
  home,
  pages,
}: {
  readonly home: Home;
  readonly pages: readonly {
    readonly company: Home['companies'][number];
    readonly page: CandidatePage | null;
  }[];
}): JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [state, setState] = useState<'all' | 'active' | 'hired' | 'closed'>('all');
  const [group, setGroup] = useState<'company' | 'state'>('company');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Notice | null>(null);
  const [pending, start] = useTransition();
  const notices = useMemo(() => noticesOf(pages), [pages]);
  const waiting = notices.filter((n) => n.open).length;

  const rows = useMemo<readonly Row[]>(
    () =>
      pages.flatMap(({ company, page }) =>
        (page?.applications ?? []).map((application) => ({ company, application })),
      ),
    [pages],
  );
  const shown = rows.filter(({ company, application }) => {
    const text = `${application.job.title} ${company.name}`.toLowerCase();
    if (q.trim() !== '' && !text.includes(q.trim().toLowerCase())) return false;
    if (state === 'active') return application.outcome === 'active';
    if (state === 'hired') return application.outcome === 'hired';
    if (state === 'closed')
      return application.outcome === 'rejected' || application.outcome === 'withdrawn';
    return true;
  });
  const groups = new Map<string, Row[]>();
  for (const row of shown) {
    const key =
      group === 'company'
        ? row.company.name
        : (OUTCOME()[row.application.outcome] ?? row.application.outcome);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const withdraw = (row: Row): void => {
    start(async () => {
      setError(null);
      const answer = await publicApi(
        row.company.slug,
        `/me/applications/${row.application.applicationId}/withdraw`,
        { method: 'POST', token: row.company.token },
      );
      if (!answer.ok) setError(answer.message);
      else {
        setNotice(
          t('app.me.account-home.withdrawn_from_at', 'Withdrawn from {{title}} at {{name}}.', {
            title: row.application.job.title,
            name: row.company.name,
          }),
        );
        router.refresh();
      }
    });
  };
  const upload = (file: File, makeDefault: boolean): void => {
    start(async () => {
      setError(null);
      const body = await asUpload('cv', file);
      const answer = await accountApi('/cvs', { method: 'POST', body: { ...body, makeDefault } });
      if (!answer.ok) setError(answer.message);
      else {
        setNotice(`${file.name} is in your library.`);
        router.refresh();
      }
    });
  };
  const act = (path: string, method: 'POST' | 'DELETE', body: unknown, done: string): void => {
    start(async () => {
      setError(null);
      const answer = await accountApi(path, { method, body });
      if (!answer.ok) setError(answer.message);
      else {
        setNotice(done);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={home.name} src={home.pictureUrl ?? undefined} size="xl" aria-hidden />
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-[-0.02em]">
              {t('app.me.account-home.hello', 'Hello, {{name}}', {
                name: home.name.split(' ')[0] ?? home.name,
              })}
            </h1>
            <p className="text-fg-muted">
              {t(
                'app.me.account-home.applications_across_companies',
                '{{applications}} across {{companies}}',
                {
                  applications: t(
                    'app.me.account-home.applications',
                    { one: '{{count}} application', other: '{{count}} applications' },
                    { count: rows.length },
                  ),
                  companies: t(
                    'app.me.account-home.companies',
                    { one: '{{count}} company', other: '{{count}} companies' },
                    { count: home.companies.length },
                  ),
                },
              )}
            </p>
          </div>
        </div>
        <form action="/auth/sign-out" method="post">
          <Button type="submit" variant="ghost" size="sm" startIcon={<icons.signOut aria-hidden />}>
            {t('app.me.account-home.sign_out', 'Sign out')}
          </Button>
        </form>
      </div>
      {notice === null ? null : (
        <Alert
          tone="success"
          title={notice}
          onDismiss={() => {
            setNotice(null);
          }}
        />
      )}
      {error === null ? null : (
        <Alert
          tone="danger"
          title={t('app.me.account-home.that_did_not_go_through', 'That did not go through')}
        >
          {error}
        </Alert>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {notices.length === 0 ? null : (
            <section
              aria-label={t('app.me.account-home.notifications', 'Notifications')}
              className="flex min-w-0 flex-col gap-3"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-[-0.01em]">
                  {t('app.me.account-home.notifications', 'Notifications')}
                </h2>
                {waiting === 0 ? null : (
                  <Badge size="sm" tone="warning">
                    {t(
                      'app.me.account-home.need_you',
                      { one: '{{count}} needs you', other: '{{count}} need you' },
                      { count: waiting },
                    )}
                  </Badge>
                )}
              </div>
              <NoticeList
                notices={notices}
                onOpen={setOpened}
                onOffer={(n) => {
                  window.location.assign(`/me/${n.company.slug}#${n.company.token}`);
                }}
              />
            </section>
          )}
          <section
            aria-label={t('app.me.account-home.your_applications', 'Your applications')}
            className="flex min-w-0 flex-col gap-4"
          >
            {rows.length === 0 ? (
              <EmptyState
                icon={<icons.work aria-hidden />}
                title={t('app.me.account-home.no_applications_yet', 'No applications yet')}
                description={t(
                  'app.me.account-home.apply_to_a_job_and_it',
                  'Apply to a job and it will be here, with every step it goes through.',
                )}
                action={
                  <Button asChild variant="secondary">
                    <Link href="/">
                      {t('app.me.account-home.every_open_job', 'Every open job')}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Field className="min-w-56 flex-1">
                    <FieldControl>
                      <Input
                        aria-label={t(
                          'app.me.account-home.search_your_applications',
                          'Search your applications',
                        )}
                        placeholder={t(
                          'app.me.account-home.search_by_job_or_company',
                          'Search by job or company',
                        )}
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value);
                        }}
                      />
                    </FieldControl>
                  </Field>
                  <SegmentedControl
                    aria-label={t('app.me.account-home.which_applications', 'Which applications')}
                    size="sm"
                    value={state}
                    onValueChange={(v) => {
                      if (v === 'all' || v === 'active' || v === 'hired' || v === 'closed')
                        setState(v);
                    }}
                  >
                    <SegmentedControlItem value="all">
                      {t('app.me.account-home.all', 'All')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="active">
                      {t('app.me.account-home.in_progress', 'In progress')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="hired">
                      {t('app.me.account-home.hired', 'Hired')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="closed">
                      {t('app.me.account-home.closed', 'Closed')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                  <Select
                    value={group}
                    onValueChange={(v) => {
                      if (v === 'company' || v === 'state') setGroup(v);
                    }}
                  >
                    <SelectTrigger
                      aria-label={t('app.me.account-home.group_by', 'Group by')}
                      size="sm"
                      className="w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">
                        {t('app.me.account-home.by_company', 'By company')}
                      </SelectItem>
                      <SelectItem value="state">
                        {t('app.me.account-home.by_state', 'By state')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {shown.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    {t(
                      'app.me.account-home.nothing_matches_clear_the_search_or',
                      'Nothing matches. Clear the search or the filter.',
                    )}
                  </p>
                ) : null}
                {[...groups.entries()].map(([title, members]) => (
                  <section key={title} className="flex flex-col gap-2">
                    <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
                    <List>
                      {members.map((row) => {
                        const a = row.application;
                        const current = Math.max(
                          0,
                          a.steps.findIndex((s) => s.state === 'current'),
                        );
                        const ownPage = `/me/${row.company.slug}#${row.company.token}`;
                        return (
                          <ListItem
                            key={a.applicationId}
                            description={
                              <span className="flex flex-col gap-2">
                                <span>
                                  {group === 'company'
                                    ? (OUTCOME()[a.outcome] ?? a.outcome)
                                    : row.company.name}
                                  {a.outcome === 'active' && a.stage !== null
                                    ? ` · ${a.stage}`
                                    : ''}
                                </span>
                                {a.outcome === 'active' && a.steps.length > 0 ? (
                                  <Stepper
                                    label={t(
                                      'app.me.account-home.where_it_stands',
                                      'Where it stands',
                                    )}
                                    size="sm"
                                    orientation="horizontal"
                                    steps={a.steps.map((s, i) => ({
                                      id: String(i),
                                      label: s.name,
                                    }))}
                                    current={current}
                                  />
                                ) : null}
                                {a.interviews.length > 0 ? (
                                  <span className="text-fg">
                                    {`Interview: ${a.interviews
                                      .map((i) =>
                                        new Date(i.startsAt).toLocaleString(locale(), {
                                          weekday: 'short',
                                          day: 'numeric',
                                          month: 'short',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        }),
                                      )
                                      .join(', ')}`}
                                  </span>
                                ) : null}
                              </span>
                            }
                            trailing={
                              <span className="flex items-center gap-2">
                                <Badge size="sm" tone={TONE[a.outcome] ?? 'neutral'}>
                                  {a.offer !== null && a.outcome === 'active'
                                    ? t('app.me.account-home.offer', 'Offer')
                                    : (OUTCOME()[a.outcome] ?? a.outcome)}
                                </Badge>
                                <RowMenu
                                  name={a.job.title}
                                  actions={[
                                    {
                                      id: 'open',
                                      label: t('app.me.account-home.open_at', 'Open at {{name}}', {
                                        name: row.company.name,
                                      }),
                                      icon: <icons.externalLink aria-hidden />,
                                      onSelect: () => {
                                        window.location.assign(ownPage);
                                      },
                                    },
                                    {
                                      id: 'job',
                                      label: t('app.me.account-home.see_the_job', 'See the job'),
                                      icon: <icons.work aria-hidden />,
                                      onSelect: () => {
                                        router.push(`/${row.company.slug}/${a.job.slug}`);
                                      },
                                    },
                                    ...(a.outcome === 'active'
                                      ? [
                                          {
                                            id: 'withdraw',
                                            label: t(
                                              'app.me.account-home.withdraw_application',
                                              'Withdraw application',
                                            ),
                                            icon: <icons.close aria-hidden />,
                                            destructive: true,
                                            disabled: pending,
                                            onSelect: () => {
                                              withdraw(row);
                                            },
                                          },
                                        ]
                                      : []),
                                  ]}
                                />
                              </span>
                            }
                          >
                            <Link
                              href={`/${row.company.slug}/${a.job.slug}`}
                              className="font-semibold hover:underline"
                            >
                              {a.job.title}
                            </Link>
                            {a.offer !== null && a.outcome === 'active' ? (
                              <a
                                href={`/me/${row.company.slug}?offer=${a.offer.offerId}#${row.company.token}`}
                                className="ms-2 text-sm text-accent-fg underline underline-offset-4"
                              >
                                {t('app.me.account-home.read_your_offer', 'Read your offer')}
                              </a>
                            ) : null}
                          </ListItem>
                        );
                      })}
                    </List>
                  </section>
                ))}
              </>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-sm">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">
              {t('app.me.account-home.your_cvs', 'Your CVs')}
            </h2>
            <p className="text-sm text-fg-muted">
              {t(
                'app.me.account-home.keep_up_to_five_the_default',
                'Keep up to five. The default one goes with an application when you attach none.',
              )}
            </p>
            <Button
              asChild
              variant="secondary"
              size="sm"
              startIcon={<icons.assistant aria-hidden />}
            >
              <Link href="/me/cv">
                {t(
                  'app.me.account-home.write_one_from_scratch_with_ai',
                  'Write one from scratch with AI',
                )}
              </Link>
            </Button>
            {home.cvs.length === 0 ? null : (
              <List>
                {home.cvs.map((cv) => (
                  <ListItem
                    key={cv.id}
                    description={`${kb(cv.size)} · ${new Date(cv.uploadedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`}
                    trailing={
                      <RowMenu
                        name={cv.fileName}
                        actions={[
                          {
                            id: 'open',
                            label: t('app.me.account-home.open', 'Open'),
                            icon: <icons.externalLink aria-hidden />,
                            onSelect: () => {
                              window.open(`/me/cv/${cv.id}`, '_blank', 'noopener');
                            },
                          },
                          {
                            id: 'download',
                            label: t('app.me.account-home.download', 'Download'),
                            icon: <icons.download aria-hidden />,
                            onSelect: () => {
                              window.location.assign(`/me/cv/${cv.id}?download=1`);
                            },
                          },
                          ...(cv.isDefault
                            ? []
                            : [
                                {
                                  id: 'default',
                                  label: t(
                                    'app.me.account-home.make_it_the_default',
                                    'Make it the default',
                                  ),
                                  icon: <icons.starred aria-hidden />,
                                  onSelect: () => {
                                    act(
                                      `/cvs/${cv.id}/default`,
                                      'POST',
                                      undefined,
                                      `${cv.fileName} is your default CV.`,
                                    );
                                  },
                                },
                              ]),
                          {
                            id: 'remove',
                            label: t('app.me.account-home.remove', 'Remove'),
                            icon: <icons.delete aria-hidden />,
                            destructive: true,
                            onSelect: () => {
                              act(`/cvs/${cv.id}`, 'DELETE', undefined, `${cv.fileName} removed.`);
                            },
                          },
                        ]}
                      />
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate">{cv.fileName}</span>
                      {cv.isDefault ? (
                        <Badge size="xs" tone="accent">
                          {t('app.me.account-home.default', 'Default')}
                        </Badge>
                      ) : null}
                    </span>
                  </ListItem>
                ))}
              </List>
            )}
            {home.cvs.length >= 5 ? null : (
              <Dropzone
                label={t('app.me.account-home.add_a_cv', 'Add a CV')}
                hint={t(
                  'app.me.account-home.pdf_docx_odt_or_rtf_up',
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
                  upload(file, home.cvs.length === 0);
                }}
              />
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-sm">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">
              {t('app.me.account-home.your_account', 'Your account')}
            </h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">{t('app.me.account-home.name', 'Name')}</dt>
                <dd className="text-end">{home.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">{t('app.me.account-home.email', 'Email')}</dt>
                <dd className="text-end">{home.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">
                  {t('app.me.account-home.signs_in_with', 'Signs in with')}
                </dt>
                <dd className="text-end">
                  {home.google
                    ? t('app.me.account-home.google', 'Google')
                    : t('app.me.account-home.a_code_by_email', 'A code by email')}
                </dd>
              </div>
            </dl>
            <Field orientation="horizontal">
              <span className="flex min-w-0 flex-col">
                <FieldLabel>
                  {t(
                    'app.me.account-home.keep_my_data_to_apply_faster',
                    'Keep my data to apply faster',
                  )}
                </FieldLabel>
                <FieldDescription>{CONSENT_NOTICE()}</FieldDescription>
              </span>
              <FieldControl>
                <Switch
                  checked={home.consentedAt !== null}
                  disabled={pending}
                  onCheckedChange={(on) => {
                    act(
                      '/consent',
                      'POST',
                      { given: on, notice: CONSENT_NOTICE() },
                      on
                        ? t(
                            'app.me.account-home.we_will_keep_your_data_to',
                            'We will keep your data to apply faster.',
                          )
                        : t(
                            'app.me.account-home.we_will_not_keep_your_data',
                            'We will not keep your data beyond this session’s applications.',
                          ),
                    );
                  }}
                />
              </FieldControl>
            </Field>
            <p className="text-xs text-fg-muted">
              {t(
                'app.me.account-home.to_download_or_delete_what_a',
                'To download or delete what a company holds about you, open your page at that company from the menu beside an application.',
              )}
            </p>
          </section>
        </aside>
      </div>
      <NoticeDialog
        notice={opened}
        onClose={() => {
          setOpened(null);
        }}
        onDone={(said) => {
          setOpened(null);
          setNotice(said);
          router.refresh();
        }}
      />
    </div>
  );
}
