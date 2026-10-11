import {
  Badge,
  Button,
  Card,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  useToast,
} from '@reach/ui-native';
import { Lock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { changeInbox, readNotifications, saveNotifications, useInbox } from './api';
import { moduleName } from './model';

/**
 * Me › Settings › Notifications (M:I1): tasks are always in the Inbox (the
 * lock) and routed to the phone and email; updates switched per kind; quiet
 * hours. The same preference the web's Settings › Notifications keeps.
 */

type Email = 'now' | 'digest' | 'off';
interface Channels {
  readonly inbox?: boolean;
  readonly phone: boolean;
  readonly email: Email;
}
interface Notifications {
  readonly tasks: Readonly<Record<'asked' | 'reminders' | 'handedOver', Channels>>;
  readonly updates: Readonly<
    Record<'decided' | 'documents' | 'team' | 'calendars', Required<Channels>>
  >;
  readonly quiet: {
    readonly on: boolean;
    readonly from: string;
    readonly to: string;
    readonly weekends: boolean;
  };
  readonly digestAt: string;
}

const TASKS = [
  ['asked', 'Someone asks you to do something'],
  ['reminders', 'Reminders before a task is due'],
  ['handedOver', 'Tasks handed to you while someone is away'],
] as const;
const UPDATES = [
  ['decided', 'Your requests are decided'],
  ['documents', 'Documents shared with you'],
  ['team', 'Someone joins or leaves your team'],
  ['calendars', 'Calendars and balances'],
] as const;
const EMAIL: Readonly<Record<Email, string>> = {
  now: 'Right away',
  digest: 'Daily digest',
  off: 'Off',
};

function EmailPick({
  value,
  onChange,
  label,
}: {
  value: Email;
  onChange: (v: Email) => void;
  label: string;
}): React.JSX.Element {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === 'now' || v === 'digest' || v === 'off') onChange(v);
      }}
    >
      <SelectTrigger size="sm" accessibilityLabel={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent title="Email">
        {(['now', 'digest', 'off'] as const).map((k) => (
          <SelectItem key={k} value={k}>
            {EMAIL[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NotificationSettings({
  navigation,
}: PeopleScreen<'Notifications'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const { inbox } = useInbox();
  const [n, setN] = useState<Notifications | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [each, setEach] = useState(false);
  useEffect(() => {
    let live = true;
    void readNotifications<Notifications>(signed).then((a) => {
      if (!live) return;
      if (a.ok) setN(a.data);
      else setFailed(a.message);
    });
    return () => {
      live = false;
    };
  }, [signed]);
  const back = { label: 'Back', onPress: navigation.goBack };
  if (n === null) {
    return (
      <Page title="Notifications" back={back}>
        {failed === null ? (
          <Loading label="Loading your settings" />
        ) : (
          <Failed
            message={failed}
            onRetry={() => {
              setFailed(null);
            }}
          />
        )}
      </Page>
    );
  }
  const save = (next: Notifications): void => {
    setN(next);
    void saveNotifications(signed, next).then((refused) => {
      if (refused !== null)
        toast({ title: 'That did not save', description: refused, tone: 'danger' });
    });
  };
  const kinds = TASKS.map(([key]) => key);
  const allPhone = kinds.every((k) => n.tasks[k].phone);
  const allEmail = kinds.every((k) => n.tasks[k].email !== 'off');
  const setTasks = (patch: Partial<Channels>): void => {
    save({
      ...n,
      tasks: Object.fromEntries(
        kinds.map((k) => [k, { ...n.tasks[k], ...patch }]),
      ) as Notifications['tasks'],
    });
  };
  const card = (title: string, sub: string, children: React.ReactNode): React.JSX.Element => (
    <Card padded={false} className="overflow-hidden">
      <View className="gap-0.5 px-4 pb-1 pt-4">
        <Text variant="headline">{title}</Text>
        <Text variant="footnote" tone="muted">
          {sub}
        </Text>
      </View>
      {children}
    </Card>
  );
  return (
    <Page title="Notifications" back={back}>
      {/* Tasks always arrive; updates mute by kind; quiet hours hold both (v3 S18). */}
      {card(
        'Tasks',
        'Things you need to do. They can’t be muted.',
        <>
          <ListItem
            listitem={false}
            trailing={
              <Badge size="sm" variant="outline" icon={Lock}>
                Always on
              </Badge>
            }
          >
            In the Inbox
          </ListItem>
          <ListItem
            listitem={false}
            description="Each task, as it arrives"
            trailing={
              <Switch
                checked={allPhone}
                accessibilityLabel="Tasks on your phone"
                onCheckedChange={(phone) => {
                  setTasks({ phone });
                }}
              />
            }
          >
            On your phone
          </ListItem>
          <ListItem
            listitem={false}
            description={`A daily digest at ${n.digestAt}`}
            trailing={
              <Switch
                checked={allEmail}
                accessibilityLabel="Tasks by email"
                onCheckedChange={(on) => {
                  setTasks({ email: on ? 'digest' : 'off' });
                }}
              />
            }
          >
            Email
          </ListItem>
        </>,
      )}
      {card(
        'Updates',
        'Things you should know. Mute any kind.',
        UPDATES.map(([key, label]) => {
          const c = n.updates[key];
          return (
            <ListItem
              key={key}
              listitem={false}
              trailing={
                <Switch
                  checked={c.phone || c.email !== 'off'}
                  accessibilityLabel={label}
                  onCheckedChange={(on) => {
                    save({
                      ...n,
                      updates: {
                        ...n.updates,
                        [key]: {
                          ...c,
                          phone: on,
                          email: on ? (c.email === 'off' ? 'digest' : c.email) : 'off',
                        },
                      },
                    });
                  }}
                />
              }
            >
              {label}
            </ListItem>
          );
        }),
      )}
      {card(
        'Quiet hours',
        'Nothing reaches your phone while they hold.',
        <>
          <ListItem
            listitem={false}
            description="Tasks due today still come through"
            wrap
            trailing={
              <Switch
                checked={n.quiet.on}
                accessibilityLabel="Quiet hours"
                onCheckedChange={(on) => {
                  save({ ...n, quiet: { ...n.quiet, on } });
                }}
              />
            }
          >
            {`Hold everything outside ${n.quiet.to}–${n.quiet.from}`}
          </ListItem>
          <ListItem
            listitem={false}
            overline="Weekends"
            trailing={
              <Switch
                checked={n.quiet.weekends}
                accessibilityLabel="Hold weekends"
                onCheckedChange={(weekends) => {
                  save({ ...n, quiet: { ...n.quiet, weekends } });
                }}
              />
            }
          >
            {n.quiet.weekends ? 'Hold until Monday' : 'Like any other day'}
          </ListItem>
        </>,
      )}
      <Button
        variant="link"
        onPress={() => {
          setEach((e) => !e);
        }}
      >
        {each ? 'Hide each kind' : 'Each kind of task and update'}
      </Button>
      {each ? (
        <>
          <Text variant="headline">Tasks</Text>
          <List>
            {TASKS.map(([key, label]) => {
              const c = n.tasks[key];
              return (
                <ListItem
                  key={key}
                  supporting={
                    <View className="mt-2 gap-2">
                      <Switch
                        checked={c.phone}
                        onCheckedChange={(phone) => {
                          save({ ...n, tasks: { ...n.tasks, [key]: { ...c, phone } } });
                        }}
                      >
                        Phone
                      </Switch>
                      <EmailPick
                        label={`${label} by email`}
                        value={c.email}
                        onChange={(email) => {
                          save({ ...n, tasks: { ...n.tasks, [key]: { ...c, email } } });
                        }}
                      />
                    </View>
                  }
                >
                  {label}
                </ListItem>
              );
            })}
          </List>
          <Text variant="headline">Updates</Text>
          <List>
            {UPDATES.map(([key, label]) => {
              const c = n.updates[key];
              const set = (next: typeof c) => {
                save({ ...n, updates: { ...n.updates, [key]: next } });
              };
              return (
                <ListItem
                  key={key}
                  supporting={
                    <View className="mt-2 gap-2">
                      <Switch
                        checked={c.inbox}
                        onCheckedChange={(inboxOn) => {
                          set({ ...c, inbox: inboxOn });
                        }}
                      >
                        Inbox
                      </Switch>
                      <Switch
                        checked={c.phone}
                        onCheckedChange={(phone) => {
                          set({ ...c, phone });
                        }}
                      >
                        Phone
                      </Switch>
                      <EmailPick
                        label={`${label} by email`}
                        value={c.email}
                        onChange={(email) => {
                          set({ ...c, email });
                        }}
                      />
                    </View>
                  }
                >
                  {label}
                </ListItem>
              );
            })}
          </List>
        </>
      ) : null}
      {inbox === null || inbox.muted.length === 0 ? null : (
        <>
          <Text variant="headline">Muted</Text>
          <List>
            {inbox.muted.map((m) => (
              <ListItem
                key={m.what}
                trailing={
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      void changeInbox(signed, { kind: 'unmute', what: m.what });
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
        </>
      )}
    </Page>
  );
}
