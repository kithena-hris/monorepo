'use client';

import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldLabel,
  List,
  ListItem,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  ToastProvider,
  icons,
  useToast,
  TimePicker,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { mute } from '../../app/(app)/inbox/actions';
import { saveNotifications } from '../../app/(app)/settings/notifications/actions';
import { moduleName, type Mute } from '../../lib/inbox/model';
import { TASK_ROWS, UPDATE_ROWS, type Notifications } from '../../lib/inbox/notifications';
import { t as tr } from '../../lib/t';

/**
 * Settings › You › Notifications (P1): tasks (the Inbox always has them, the
 * lock; phone and email are theirs to route), updates per kind and channel,
 * quiet hours, the daily digest's time, and what they muted.
 */

const EMAIL = {
  get now() {
    return tr('components.inbox.notification-settings.right_away', 'Right away');
  },
  get digest() {
    return tr('components.inbox.notification-settings.daily_digest', 'Daily digest');
  },
  get off() {
    return tr('components.inbox.notification-settings.off', 'Off');
  },
};

function EmailSelect({
  value,
  onChange,
  label,
}: {
  readonly value: 'now' | 'digest' | 'off';
  readonly onChange: (v: 'now' | 'digest' | 'off') => void;
  readonly label: string;
}): JSX.Element {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === 'now' || v === 'digest' || v === 'off') onChange(v);
      }}
    >
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(['now', 'digest', 'off'] as const).map((k) => (
          <SelectItem key={k} value={k}>
            {EMAIL[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NotificationSettings(props: {
  readonly initial: Notifications;
  readonly muted: readonly Mute[];
}): JSX.Element {
  return (
    <ToastProvider>
      <Settings {...props} />
    </ToastProvider>
  );
}

function Settings({
  initial,
  muted,
}: {
  readonly initial: Notifications;
  readonly muted: readonly Mute[];
}): JSX.Element {
  const [n, setN] = useState(initial);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const save = (next: Notifications): void => {
    setN(next);
    start(async () => {
      const done = await saveNotifications(next);
      if (!done.ok)
        toast({
          title: tr(
            'components.inbox.notification-settings.that_did_not_save',
            'That did not save',
          ),
          description: done.message,
          tone: 'danger',
        });
    });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/settings">
                  {tr('components.inbox.notification-settings.settings', 'Settings')}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {tr('components.inbox.notification-settings.notifications', 'Notifications')}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={tr('components.inbox.notification-settings.notifications', 'Notifications')}
        description={tr(
          'components.inbox.notification-settings.where_your_tasks_and_updates_reach',
          'Where your tasks and updates reach you. The Inbox always has everything.',
        )}
        meta={
          pending ? (
            <Badge size="sm">{tr('components.inbox.notification-settings.saving', 'Saving')}</Badge>
          ) : undefined
        }
      />
      <div className="grid gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle level={2}>
                {tr('components.inbox.notification-settings.tasks', 'Tasks')}
              </CardTitle>
              <CardDescription>
                {tr(
                  'components.inbox.notification-settings.always_in_your_inbox_choose_where',
                  'Always in your Inbox. Choose where else they reach you.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <List
                aria-label={tr('components.inbox.notification-settings.tasks', 'Tasks')}
                className="-mx-2 bg-transparent shadow-none"
              >
                {TASK_ROWS.map((row) => {
                  const c = n.tasks[row.key];
                  return (
                    <ListItem
                      key={row.key}
                      description={row.detail ?? undefined}
                      trailing={
                        <span className="flex flex-wrap items-center gap-3">
                          <Badge size="sm" variant="outline">
                            <icons.locked aria-hidden />{' '}
                            {tr('components.inbox.notification-settings.inbox', 'Inbox')}
                          </Badge>
                          <Field orientation="horizontal">
                            <FieldLabel>
                              {tr('components.inbox.notification-settings.phone', 'Phone')}
                            </FieldLabel>
                            <FieldControl>
                              <Switch
                                checked={c.phone}
                                onCheckedChange={(phone) => {
                                  save({ ...n, tasks: { ...n.tasks, [row.key]: { ...c, phone } } });
                                }}
                              />
                            </FieldControl>
                          </Field>
                          <EmailSelect
                            label={tr(
                              'components.inbox.notification-settings.by_email',
                              '{{label}} by email',
                              { label: row.label },
                            )}
                            value={c.email}
                            onChange={(email) => {
                              save({ ...n, tasks: { ...n.tasks, [row.key]: { ...c, email } } });
                            }}
                          />
                        </span>
                      }
                    >
                      {row.label}
                    </ListItem>
                  );
                })}
              </List>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>
                {tr('components.inbox.notification-settings.updates', 'Updates')}
              </CardTitle>
              <CardDescription>
                {tr(
                  'components.inbox.notification-settings.news_never_something_owed_switch_each',
                  'News, never something owed. Switch each kind on or off.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <List
                aria-label={tr('components.inbox.notification-settings.updates', 'Updates')}
                className="-mx-2 bg-transparent shadow-none"
              >
                {UPDATE_ROWS.map((row) => {
                  const c = n.updates[row.key];
                  const set = (next: typeof c) => {
                    save({ ...n, updates: { ...n.updates, [row.key]: next } });
                  };
                  return (
                    <ListItem
                      key={row.key}
                      description={row.detail ?? undefined}
                      trailing={
                        <span className="flex flex-wrap items-center gap-3">
                          <Field orientation="horizontal">
                            <FieldLabel>
                              {tr('components.inbox.notification-settings.inbox', 'Inbox')}
                            </FieldLabel>
                            <FieldControl>
                              <Switch
                                checked={c.inbox}
                                onCheckedChange={(inbox) => {
                                  set({ ...c, inbox });
                                }}
                              />
                            </FieldControl>
                          </Field>
                          <Field orientation="horizontal">
                            <FieldLabel>
                              {tr('components.inbox.notification-settings.phone', 'Phone')}
                            </FieldLabel>
                            <FieldControl>
                              <Switch
                                checked={c.phone}
                                onCheckedChange={(phone) => {
                                  set({ ...c, phone });
                                }}
                              />
                            </FieldControl>
                          </Field>
                          <EmailSelect
                            label={tr(
                              'components.inbox.notification-settings.by_email',
                              '{{label}} by email',
                              { label: row.label },
                            )}
                            value={c.email}
                            onChange={(email) => {
                              set({ ...c, email });
                            }}
                          />
                        </span>
                      }
                    >
                      {row.label}
                    </ListItem>
                  );
                })}
              </List>
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle level={2}>
                {tr('components.inbox.notification-settings.quiet_hours', 'Quiet hours')}
              </CardTitle>
              <CardDescription>
                {tr(
                  'components.inbox.notification-settings.tasks_due_today_still_come_through',
                  'Tasks due today still come through.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field orientation="horizontal">
                <FieldLabel>
                  {tr(
                    'components.inbox.notification-settings.hold_phone_notifications',
                    'Hold phone notifications',
                  )}
                </FieldLabel>
                <FieldControl>
                  <Switch
                    checked={n.quiet.on}
                    onCheckedChange={(on) => {
                      save({ ...n, quiet: { ...n.quiet, on } });
                    }}
                  />
                </FieldControl>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field disabled={!n.quiet.on}>
                  <FieldLabel>
                    {tr('components.inbox.notification-settings.from', 'From')}
                  </FieldLabel>
                  <FieldControl>
                    <TimePicker
                      label={tr('components.inbox.notification-settings.from', 'From')}
                      value={n.quiet.from}
                      disabled={!n.quiet.on}
                      onChange={(t) => {
                        if (t !== null) save({ ...n, quiet: { ...n.quiet, from: t } });
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field disabled={!n.quiet.on}>
                  <FieldLabel>
                    {tr('components.inbox.notification-settings.until', 'Until')}
                  </FieldLabel>
                  <FieldControl>
                    <TimePicker
                      label={tr('components.inbox.notification-settings.until', 'Until')}
                      value={n.quiet.to}
                      disabled={!n.quiet.on}
                      onChange={(t) => {
                        if (t !== null) save({ ...n, quiet: { ...n.quiet, to: t } });
                      }}
                    />
                  </FieldControl>
                </Field>
              </div>
              <Field orientation="horizontal" disabled={!n.quiet.on}>
                <FieldLabel>
                  {tr(
                    'components.inbox.notification-settings.all_day_at_weekends',
                    'All day at weekends',
                  )}
                </FieldLabel>
                <FieldControl>
                  <Switch
                    checked={n.quiet.weekends}
                    disabled={!n.quiet.on}
                    onCheckedChange={(weekends) => {
                      save({ ...n, quiet: { ...n.quiet, weekends } });
                    }}
                  />
                </FieldControl>
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>
                {tr('components.inbox.notification-settings.daily_digest', 'Daily digest')}
              </CardTitle>
              <CardDescription>
                {tr(
                  'components.inbox.notification-settings.everything_you_havent_opened_once_a',
                  'Everything you haven’t opened, once a day.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field>
                <FieldLabel>
                  {tr('components.inbox.notification-settings.sent_at', 'Sent at')}
                </FieldLabel>
                <FieldControl>
                  <TimePicker
                    label={tr('components.inbox.notification-settings.sent_at', 'Sent at')}
                    value={n.digestAt}
                    onChange={(t) => {
                      if (t !== null) save({ ...n, digestAt: t });
                    }}
                  />
                </FieldControl>
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>
                {tr('components.inbox.notification-settings.muted', 'Muted')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {muted.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {tr(
                    'components.inbox.notification-settings.nothing_muted_mute_updates_from_any',
                    'Nothing muted. Mute updates from any update’s menu.',
                  )}
                </p>
              ) : (
                <List
                  aria-label={tr('components.inbox.notification-settings.muted', 'Muted')}
                  className="-mx-2 bg-transparent shadow-none"
                >
                  {muted.map((m) => (
                    <ListItem
                      key={m.what}
                      icon={<icons.notifications aria-hidden />}
                      description={[
                        m.inbox
                          ? tr('components.inbox.notification-settings.inbox', 'Inbox')
                          : null,
                        m.email ? 'email' : null,
                        m.phone ? 'phone' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      trailing={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            start(async () => {
                              await mute({ what: m.what, off: true });
                            });
                          }}
                        >
                          {tr('components.inbox.notification-settings.unmute', 'Unmute')}
                        </Button>
                      }
                    >
                      {m.what.includes('.')
                        ? tr(
                            'components.inbox.notification-settings.text',
                            '{{moduleName}} · {{value}}',
                            {
                              moduleName: moduleName(m.what.split('.')[0] ?? ''),
                              value: m.what.split('.')[1] ?? '',
                            },
                          )
                        : tr(
                            'components.inbox.notification-settings.everything_from',
                            'Everything from {{moduleName}}',
                            { moduleName: moduleName(m.what) },
                          )}
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
