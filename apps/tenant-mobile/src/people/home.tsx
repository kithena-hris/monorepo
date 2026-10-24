import {
  ActionCard,
  Alert,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Icon,
  Stack,
  Stat,
  useToast,
} from '@reach/ui-native';
import { Camera, ClipboardList } from 'lucide-react-native';
import { useContext, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AccountActionsContext } from '../account-card';
import { Failed, Heading, Loading, Page } from '../frame';
import { useInbox } from '../inbox/api';
import { homeBrief, tasksOf } from '../inbox/brief';
import { TaskCard } from '../inbox/task-card';
import { useTimeOff } from '../timeoff/api';
import { clockTime, duration } from '../timeoff/time';
import { amount } from '../timeoff/words';
import { ask, useSigned } from './api';
import { changePhoto, uploadFile } from './media';
import type { OnboardingData } from './onboarding';
import type { PeopleScreen } from './routes';
import { t } from '../i18n';

interface Overview {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  readonly now: string;
  readonly me: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly title: string | null;
    readonly department: string | null;
    readonly location: string | null;
    readonly timeZone: string;
    readonly startedOn: string | null;
    readonly status: string | null;
    readonly missing: number | null;
    readonly required: number;
  } | null;
  readonly reportingLine: {
    readonly managers: readonly {
      id: string;
      name: string;
      title: string | null;
      avatarUrl: string | null;
    }[];
    readonly peers: number | null;
    readonly reports: readonly {
      id: string;
      name: string;
      title: string | null;
      avatarUrl: string | null;
    }[];
    readonly reportsTotal: number;
  } | null;
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    readonly flagged: number;
    readonly flagReason: string | null;
    readonly items: readonly {
      id: string;
      label: string;
      requestedAt: string;
      requestedBy: string;
    }[];
  } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly section: string;
    readonly ownedBy: string | null;
  }[];
  readonly corrections:
    | readonly {
        readonly key: string;
        readonly label: string;
        readonly sectionKey: string;
        readonly reason: string;
      }[]
    | null;
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
  readonly setup: {
    readonly photo: 'required' | 'optional' | null;
    readonly fields: readonly {
      key: string;
      sectionKey: string;
      label: string;
      description: string | null;
      dataType: string;
      required: boolean;
    }[];
  } | null;
}

/** Enough of Time Off's overview for Home's two tiles. */
interface TimeOffGlance {
  readonly clock: {
    readonly state: 'out' | 'in' | 'on_break';
    readonly today: {
      readonly workedMinutes: number | null;
      readonly segments: readonly { readonly kind: string; readonly from: number }[];
    };
  } | null;
  readonly balances: readonly {
    readonly leaveTypeKey: string;
    readonly name: string;
    readonly unit: 'day' | 'hour';
    readonly left: string;
    readonly yearly: string | null;
  }[];
}

/**
 * Home (design v3 H1): a one-line briefing, the two tasks that matter most
 * with their buttons on the cards, and the balance and the clock as tiles.
 * Signing up's last asks (a photo, a file) and onboarding come first.
 */
export function PeopleHome({ navigation }: PeopleScreen<'Home'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const tabs = useContext(AccountActionsContext);
  const { inbox } = useInbox();
  const glance = useTimeOff<TimeOffGlance>('TimeOffOverview', {});
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(0);
  const round = useRef(0);

  const load = async (): Promise<void> => {
    const mine = ++round.current;
    const read = await ask<Overview>(signed, 'Overview');
    if (mine !== round.current) return;
    if (!read.ok) {
      setFailed(read.message);
      return;
    }
    setFailed(null);
    setOverview(read.data);
    // What onboarding still asks: a card on Home until every section is saved.
    void ask<OnboardingData>(signed, 'Onboarding').then((onboarding) => {
      if (mine !== round.current || !onboarding.ok) return;
      setOnboarding(
        onboarding.data.sections.filter((x) => !onboarding.data.saved.includes(x.key)).length,
      );
    });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
      glance.reload();
    });
  }, [navigation, signed]);

  const first = (name: string): string => name.split(' ')[0] ?? name;
  if (failed !== null)
    return (
      <Page large="Home">
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  if (overview === null)
    return (
      <Page large="Home">
        <Loading label={t('people.home.loading_your_home', 'Loading your home')} />
      </Page>
    );

  const { me, setup } = overview;
  const setupShown =
    me !== null &&
    setup !== null &&
    (setup.photo !== null || setup.fields.length > 0) &&
    (!later || setup.photo === 'required' || setup.fields.some((f) => f.required));
  const tasks = inbox === null ? [] : tasksOf(inbox);
  const brief = inbox === null ? null : homeBrief(inbox);
  const time = glance.load.status === 'ready' ? glance.load.data : null;
  const balance = time?.balances.find((b) => b.unit === 'day' && b.yearly !== null) ?? null;
  const clock = time?.clock ?? null;
  const since = clock?.today.segments.find((x) => x.kind !== 'planned' && x.kind !== 'missing');

  return (
    <Page large={me === null ? 'Home' : `Hi ${first(me.name)}`}>
      {setupShown ? (
        <Card>
          <CardTitle>
            {t('people.home.finish_setting_up_your_account', 'Finish setting up your account')}
          </CardTitle>
          <CardDescription>
            {t(
              'people.home.your_company_asks_for_these_each',
              'Your company asks for these. Each is saved as soon as you choose it.',
            )}
          </CardDescription>
          <Stack gap={2} className="pt-2">
            {setup.photo === null ? null : (
              <Button
                startIcon={<Icon icon={Camera} />}
                loading={busy === 'photo'}
                onPress={() => {
                  setBusy('photo');
                  void changePhoto(signed, null).then((up) => {
                    setBusy(null);
                    if (up === null) return;
                    if (up.ok) void load();
                    else
                      toast({
                        title: t('people.home.that_did_not_work', 'That did not work'),
                        description: up.message,
                        tone: 'danger',
                      });
                  });
                }}
              >
                {setup.photo === 'required'
                  ? t('people.home.add_your_photo_required', 'Add your photo (required)')
                  : t('people.home.add_your_photo', 'Add your photo')}
              </Button>
            )}
            {setup.fields.map((f) => (
              <Button
                key={f.key}
                loading={busy === f.key}
                onPress={() => {
                  setBusy(f.key);
                  void uploadFile(
                    signed,
                    null,
                    f.key,
                    f.dataType === 'image' ? 'image' : 'document',
                  ).then(async (up) => {
                    if (up === null || !up.ok) {
                      setBusy(null);
                      if (up !== null)
                        toast({
                          title: t('people.home.that_did_not_work', 'That did not work'),
                          description: up.message,
                          tone: 'danger',
                        });
                      return;
                    }
                    await ask(signed, 'SaveOwnSection', {
                      changed: [{ key: f.key, text: up.value.id }],
                    });
                    setBusy(null);
                    void load();
                  });
                }}
              >
                {f.required
                  ? t('people.home.required', '{{label}} (required)', { label: f.label })
                  : f.label}
              </Button>
            ))}
            {setup.photo === 'required' || setup.fields.some((f) => f.required) ? null : (
              <Button
                variant="ghost"
                onPress={() => {
                  setLater(true);
                }}
              >
                {t('people.home.later', 'Later')}
              </Button>
            )}
          </Stack>
        </Card>
      ) : null}

      {brief === null ? null : (
        <Alert tone="accent" variant="summary">
          {brief}
        </Alert>
      )}

      {onboarding === 0 ? null : (
        <ActionCard
          icon={ClipboardList}
          tone="accent"
          title={t('people.home.finish_your_onboarding', 'Finish your onboarding')}
          description={t(
            'people.home.to_go_each_saves_on_its',
            {
              one: '{{count}} step to go. Each saves on its own.',
              other: '{{count}} steps to go. Each saves on its own.',
            },
            { count: onboarding },
          )}
          actions={
            <Button
              size="sm"
              variant="primary"
              onPress={() => {
                navigation.navigate('Onboarding');
              }}
            >
              {t('people.home.continue', 'Continue')}
            </Button>
          }
        />
      )}

      {tasks.length === 0 || inbox === null ? null : (
        <>
          <Heading
            title={t('people.home.needs_you', 'Needs you')}
            action={t('people.home.inbox', 'Inbox · {{String}}', {
              String: String(inbox.counts.todo),
            })}
            onAction={() => {
              tabs?.open('inbox');
            }}
          />
          {tasks.slice(0, 2).map((item) => (
            <TaskCard
              key={item.id}
              item={item}
              now={inbox.now}
              zone={inbox.zone}
              navigation={navigation}
            />
          ))}
        </>
      )}

      {balance === null && clock === null ? null : (
        <View className="flex-row gap-2.5">
          {balance === null ? null : (
            <Pressable
              className="flex-1"
              accessibilityRole="button"
              accessibilityLabel={t(
                'people.home.days_left_where_the_days_went',
                '{{name}}: {{amount}} days left. Where the days went',
                { name: balance.name, amount: amount(balance.left) },
              )}
              onPress={() => {
                navigation.navigate('TimeOffBalance', {
                  leaveTypeKey: balance.leaveTypeKey,
                  name: balance.name,
                });
              }}
            >
              <Stat
                label={balance.name}
                value={amount(balance.left)}
                unit="days"
                size={24}
                description={t('people.home.left_this_year', 'left this year')}
              />
            </Pressable>
          )}
          {clock === null ? null : (
            <Pressable
              className="flex-1"
              accessibilityRole="button"
              accessibilityLabel={t('people.home.open_time_off', 'Open Time off')}
              onPress={() => {
                tabs?.open('timeoff');
              }}
            >
              <Stat
                label={
                  clock.state === 'in'
                    ? t('people.home.clocked_in', 'Clocked in')
                    : clock.state === 'on_break'
                      ? t('people.home.on_a_break', 'On a break')
                      : t('people.home.not_clocked_in', 'Not clocked in')
                }
                value={duration(clock.today.workedMinutes ?? 0)}
                size={24}
                description={
                  since === undefined
                    ? t('people.home.worked_today', 'worked today')
                    : t('people.home.since', 'since {{clockTime}}', {
                        clockTime: clockTime(since.from),
                      })
                }
              />
            </Pressable>
          )}
        </View>
      )}
    </Page>
  );
}
