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
  Input,
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
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { mute } from '../../app/(app)/inbox/actions';
import { saveNotifications } from '../../app/(app)/settings/notifications/actions';
import { moduleName, type Mute } from '../../lib/inbox/model';
import { TASK_ROWS, UPDATE_ROWS, type Notifications } from '../../lib/inbox/notifications';

/**
 * Settings › You › Notifications (P1): tasks (the Inbox always has them, the
 * lock; phone and email are theirs to route), updates per kind and channel,
 * quiet hours, the daily digest's time, and what they muted.
 */

const EMAIL = { now: 'Right away', digest: 'Daily digest', off: 'Off' } as const;

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
        toast({ title: 'That did not save', description: done.message, tone: 'danger' });
    });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Notifications</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Notifications"
        description="Where your tasks and updates reach you. The Inbox always has everything."
        meta={pending ? <Badge size="sm">Saving</Badge> : undefined}
      />
      <div className="grid gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle level={2}>Tasks</CardTitle>
              <CardDescription>
                Always in your Inbox. Choose where else they reach you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <List aria-label="Tasks" className="-mx-2 bg-transparent shadow-none">
                {TASK_ROWS.map((row) => {
                  const c = n.tasks[row.key];
                  return (
                    <ListItem
                      key={row.key}
                      description={row.detail ?? undefined}
                      trailing={
                        <span className="flex flex-wrap items-center gap-3">
                          <Badge size="sm" variant="outline">
                            <icons.locked aria-hidden /> Inbox
                          </Badge>
                          <Field orientation="horizontal">
                            <FieldLabel>Phone</FieldLabel>
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
                            label={`${row.label} by email`}
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
              <CardTitle level={2}>Updates</CardTitle>
              <CardDescription>
                News, never something owed. Switch each kind on or off.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <List aria-label="Updates" className="-mx-2 bg-transparent shadow-none">
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
                            <FieldLabel>Inbox</FieldLabel>
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
                            <FieldLabel>Phone</FieldLabel>
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
                            label={`${row.label} by email`}
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
              <CardTitle level={2}>Quiet hours</CardTitle>
              <CardDescription>Tasks due today still come through.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field orientation="horizontal">
                <FieldLabel>Hold phone notifications</FieldLabel>
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
                  <FieldLabel>From</FieldLabel>
                  <FieldControl>
                    <Input
                      type="time"
                      value={n.quiet.from}
                      disabled={!n.quiet.on}
                      onChange={(e) => {
                        save({ ...n, quiet: { ...n.quiet, from: e.target.value } });
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field disabled={!n.quiet.on}>
                  <FieldLabel>Until</FieldLabel>
                  <FieldControl>
                    <Input
                      type="time"
                      value={n.quiet.to}
                      disabled={!n.quiet.on}
                      onChange={(e) => {
                        save({ ...n, quiet: { ...n.quiet, to: e.target.value } });
                      }}
                    />
                  </FieldControl>
                </Field>
              </div>
              <Field orientation="horizontal" disabled={!n.quiet.on}>
                <FieldLabel>All day at weekends</FieldLabel>
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
              <CardTitle level={2}>Daily digest</CardTitle>
              <CardDescription>Everything you haven’t opened, once a day.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field>
                <FieldLabel>Sent at</FieldLabel>
                <FieldControl>
                  <Input
                    type="time"
                    value={n.digestAt}
                    onChange={(e) => {
                      save({ ...n, digestAt: e.target.value });
                    }}
                  />
                </FieldControl>
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Muted</CardTitle>
            </CardHeader>
            <CardContent>
              {muted.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  Nothing muted. Mute updates from any update’s menu.
                </p>
              ) : (
                <List aria-label="Muted" className="-mx-2 bg-transparent shadow-none">
                  {muted.map((m) => (
                    <ListItem
                      key={m.what}
                      icon={<icons.notifications aria-hidden />}
                      description={[
                        m.inbox ? 'Inbox' : null,
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
                          Unmute
                        </Button>
                      }
                    >
                      {m.what.includes('.')
                        ? `${moduleName(m.what.split('.')[0] ?? '')} · ${m.what.split('.')[1] ?? ''}`
                        : `Everything from ${moduleName(m.what)}`}
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
