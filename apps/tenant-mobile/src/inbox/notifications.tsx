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
import { t } from '../i18n';

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

const TASKS = () =>
  [
    [
      'asked',
      t('inbox.notifications.someone_asks_you_to_do_something', 'Someone asks you to do something'),
    ],
    [
      'reminders',
      t('inbox.notifications.reminders_before_a_task_is_due', 'Reminders before a task is due'),
    ],
    [
      'handedOver',
      t(
        'inbox.notifications.tasks_handed_to_you_while_someone',
        'Tasks handed to you while someone is away',
      ),
    ],
  ] as const;
const UPDATES = () =>
  [
    ['decided', t('inbox.notifications.your_requests_are_decided', 'Your requests are decided')],
    ['documents', t('inbox.notifications.documents_shared_with_you', 'Documents shared with you')],
    [
      'team',
      t(
        'inbox.notifications.someone_joins_or_leaves_your_team',
        'Someone joins or leaves your team',
      ),
    ],
    ['calendars', t('inbox.notifications.calendars_and_balances', 'Calendars and balances')],
  ] as const;
const EMAIL = (): Readonly<Record<Email, string>> => ({
  now: t('inbox.notifications.right_away', 'Right away'),
  digest: t('inbox.notifications.daily_digest', 'Daily digest'),
  off: t('inbox.notifications.off', 'Off'),
});

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
      <SelectContent title={t('inbox.notifications.email', 'Email')}>
        {(['now', 'digest', 'off'] as const).map((k) => (
          <SelectItem key={k} value={k}>
            {EMAIL()[k]}
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
  const back = { label: t('inbox.notifications.back', 'Back'), onPress: navigation.goBack };
  if (n === null) {
    return (
      <Page title={t('inbox.notifications.notifications', 'Notifications')} back={back}>
        {failed === null ? (
          <Loading
            label={t('inbox.notifications.loading_your_settings', 'Loading your settings')}
          />
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
        toast({
          title: t('inbox.notifications.that_did_not_save', 'That did not save'),
          description: refused,
          tone: 'danger',
        });
    });
  };
  const kinds = TASKS().map(([key]) => key);
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
    <Page title={t('inbox.notifications.notifications', 'Notifications')} back={back}>
      {/* Tasks always arrive; updates mute by kind; quiet hours hold both (v3 S18). */}
      {card(
        'Tasks',
        t(
          'inbox.notifications.things_you_need_to_do_they',
          'Things you need to do. They can’t be muted.',
        ),
        <>
          <ListItem
            listitem={false}
            trailing={
              <Badge size="sm" variant="outline" icon={Lock}>
                {t('inbox.notifications.always_on', 'Always on')}
              </Badge>
            }
          >
            {t('inbox.notifications.in_the_inbox', 'In the Inbox')}
          </ListItem>
          <ListItem
            listitem={false}
            description={t(
              'inbox.notifications.each_task_as_it_arrives',
              'Each task, as it arrives',
            )}
            trailing={
              <Switch
                checked={allPhone}
                accessibilityLabel={t(
                  'inbox.notifications.tasks_on_your_phone',
                  'Tasks on your phone',
                )}
                onCheckedChange={(phone) => {
                  setTasks({ phone });
                }}
              />
            }
          >
            {t('inbox.notifications.on_your_phone', 'On your phone')}
          </ListItem>
          <ListItem
            listitem={false}
            description={t(
              'inbox.notifications.a_daily_digest_at',
              'A daily digest at {{digestAt}}',
              { digestAt: n.digestAt },
            )}
            trailing={
              <Switch
                checked={allEmail}
                accessibilityLabel={t('inbox.notifications.tasks_by_email', 'Tasks by email')}
                onCheckedChange={(on) => {
                  setTasks({ email: on ? 'digest' : 'off' });
                }}
              />
            }
          >
            {t('inbox.notifications.email', 'Email')}
          </ListItem>
        </>,
      )}
      {card(
        'Updates',
        t(
          'inbox.notifications.things_you_should_know_mute_any',
          'Things you should know. Mute any kind.',
        ),
        UPDATES().map(([key, label]) => {
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
        t('inbox.notifications.quiet_hours', 'Quiet hours'),
        t(
          'inbox.notifications.nothing_reaches_your_phone_while_they',
          'Nothing reaches your phone while they hold.',
        ),
        <>
          <ListItem
            listitem={false}
            description={t(
              'inbox.notifications.tasks_due_today_still_come_through',
              'Tasks due today still come through',
            )}
            wrap
            trailing={
              <Switch
                checked={n.quiet.on}
                accessibilityLabel={t('inbox.notifications.quiet_hours', 'Quiet hours')}
                onCheckedChange={(on) => {
                  save({ ...n, quiet: { ...n.quiet, on } });
                }}
              />
            }
          >
            {t(
              'inbox.notifications.hold_everything_outside',
              'Hold everything outside {{to}}–{{from}}',
              { to: n.quiet.to, from: n.quiet.from },
            )}
          </ListItem>
          <ListItem
            listitem={false}
            overline="Weekends"
            trailing={
              <Switch
                checked={n.quiet.weekends}
                accessibilityLabel={t('inbox.notifications.hold_weekends', 'Hold weekends')}
                onCheckedChange={(weekends) => {
                  save({ ...n, quiet: { ...n.quiet, weekends } });
                }}
              />
            }
          >
            {n.quiet.weekends
              ? t('inbox.notifications.hold_until_monday', 'Hold until Monday')
              : t('inbox.notifications.like_any_other_day', 'Like any other day')}
          </ListItem>
        </>,
      )}
      <Button
        variant="link"
        onPress={() => {
          setEach((e) => !e);
        }}
      >
        {each
          ? t('inbox.notifications.hide_each_kind', 'Hide each kind')
          : t('inbox.notifications.each_kind_of_task_and_update', 'Each kind of task and update')}
      </Button>
      {each ? (
        <>
          <Text variant="headline">{t('inbox.notifications.tasks', 'Tasks')}</Text>
          <List>
            {TASKS().map(([key, label]) => {
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
                        {t('inbox.notifications.phone', 'Phone')}
                      </Switch>
                      <EmailPick
                        label={t('inbox.notifications.by_email', '{{label}} by email', { label })}
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
          <Text variant="headline">{t('inbox.notifications.updates', 'Updates')}</Text>
          <List>
            {UPDATES().map(([key, label]) => {
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
                        {t('inbox.notifications.inbox', 'Inbox')}
                      </Switch>
                      <Switch
                        checked={c.phone}
                        onCheckedChange={(phone) => {
                          set({ ...c, phone });
                        }}
                      >
                        {t('inbox.notifications.phone', 'Phone')}
                      </Switch>
                      <EmailPick
                        label={t('inbox.notifications.by_email', '{{label}} by email', { label })}
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
          <Text variant="headline">{t('inbox.notifications.muted', 'Muted')}</Text>
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
                    {t('inbox.notifications.unmute', 'Unmute')}
                  </Button>
                }
              >
                {m.what.includes('.')
                  ? `${moduleName(m.what.split('.')[0] ?? '')} · ${m.what.split('.')[1] ?? ''}`
                  : t('inbox.notifications.everything_from', 'Everything from {{moduleName}}', {
                      moduleName: moduleName(m.what),
                    })}
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Page>
  );
}
