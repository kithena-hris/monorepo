import {
  Badge,
  Button,
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
  const back = { label: 'Inbox', onPress: navigation.goBack };
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
  return (
    <Page title="Notifications" back={back}>
      <Text variant="footnote" tone="muted">
        Where your tasks and updates reach you. The Inbox always has everything.
      </Text>
      <Text variant="headline">Tasks</Text>
      <List>
        {TASKS.map(([key, label]) => {
          const c = n.tasks[key];
          return (
            <ListItem
              key={key}
              supporting={
                <View className="mt-2 gap-2">
                  <Badge size="sm" variant="outline" icon={Lock}>
                    In the Inbox: always on
                  </Badge>
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
                    onCheckedChange={(inbox) => {
                      set({ ...c, inbox });
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
      <Text variant="headline">Quiet hours</Text>
      <Switch
        checked={n.quiet.on}
        onCheckedChange={(on) => {
          save({ ...n, quiet: { ...n.quiet, on } });
        }}
        description={`${n.quiet.from}–${n.quiet.to}${n.quiet.weekends ? ' and weekends' : ''}. Tasks due today still come through.`}
      >
        Hold phone notifications
      </Switch>
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
