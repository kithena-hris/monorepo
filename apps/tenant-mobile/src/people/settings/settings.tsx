import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from '@reach/ui-native';
import {
  Bell,
  Building2,
  CalendarDays,
  CheckCheck,
  Clock3,
  FolderOpen,
  History,
  Languages,
  Moon,
  Plug,
  Scale,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Tags,
  TextCursorInput,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import { useContext, useEffect, useState } from 'react';
import { View } from 'react-native';

import { savedLook, setLook, type Look } from '../../appearance';
import { Failed, Loading, Page } from '../../frame';
import { MoreModules } from '../../more';
import { ask, useSigned } from '../api';
import type { Roles } from '../roles';
import { AskedChange } from './field-sentence';
import type { Registry } from './fields-model';
import type { PeopleRoutes, PeopleScreen } from '../routes';
import { t } from '../../i18n';

/** What each of People's settings holds now, read before anybody opens one. */
interface Overview {
  /** People's roles for this viewer; null in a company without People. */
  readonly roles: Roles | null;
  readonly fields: {
    readonly published: { readonly version: number } | null;
    readonly unpublishedChanges: number;
    readonly fields: readonly unknown[];
  } | null;
  readonly organisation: {
    readonly legalEntities: readonly { readonly archived: boolean }[];
    readonly locations: readonly { readonly archived: boolean }[];
  } | null;
  readonly holders: { readonly holders: readonly { readonly roles: readonly string[] }[] } | null;
  readonly integrations: {
    readonly endpoints: readonly { readonly enabled: boolean; readonly retrying: boolean }[];
    readonly scim: {
      readonly connections: readonly {
        readonly system: string;
        readonly revokedAt: string | null;
      }[];
    } | null;
  } | null;
  /** Time Off's word on this viewer; null in a company without Time Off. */
  readonly timeOff: { readonly hrAdmin: boolean } | null;
}

interface Row {
  readonly title: string;
  readonly line: string;
  readonly icon: LucideIcon;
  readonly badge?: number;
  readonly go: () => void;
}

interface Group {
  readonly title: string;
  readonly rows: readonly Row[];
}

type TimeOffSection = NonNullable<NonNullable<PeopleRoutes['TimeOffSettings']>['section']>;

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** The changes People's settings make, as the log names them: its link from People's settings. */
const PEOPLE_AREAS = ['fields', 'organisation', 'roles', 'integrations'];

const LOOKS = (): readonly [Look, string][] => [
  ['system', t('people.settings.settings.automatic', 'Automatic')],
  ['light', t('people.settings.settings.light', 'Light')],
  ['dark', t('people.settings.settings.dark', 'Dark')],
];

/**
 * Settings (design H1), as the web's Settings page: every setting this person
 * may open, grouped by the module it belongs to, each saying what is set now
 * where that can be read; the company's activity log for its administrators
 * and HR; and, last, their own. What needs somebody first comes as chips
 * above. A setting this viewer may not open is not drawn.
 */
export function Settings({ navigation }: PeopleScreen<'Settings'>): React.JSX.Element {
  const { performance } = useContext(MoreModules);
  const signed = useSigned();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [look, chooseLook] = useState<Look>('system');
  const [asked, setAsked] = useState<string | null>(null);
  const [choosingLook, setChoosingLook] = useState(false);
  useEffect(() => {
    void savedLook().then(chooseLook);
  }, []);

  const load = async (): Promise<void> => {
    setFailed(null);
    const [roles, fields, organisation, holders, integrations, timeOff] = await Promise.all([
      ask<Roles>(signed, 'Home'),
      ask<Overview['fields']>(signed, 'Registry'),
      ask<Overview['organisation']>(signed, 'Organisation'),
      ask<Overview['holders']>(signed, 'RoleSettings', {}),
      ask<Overview['integrations']>(signed, 'Integrations'),
      ask<{ hrAdmin: boolean }>(signed, 'TimeOffViewer', {}, 'timeoff'),
    ]);
    const offline = [roles, timeOff].every((a) => !a.ok && a.code === 'OFFLINE');
    if (offline && !roles.ok) {
      setFailed(roles.message);
      return;
    }
    setData({
      roles: roles.ok ? roles.data : null,
      fields: fields.ok ? fields.data : null,
      organisation: organisation.ok ? organisation.data : null,
      holders: holders.ok ? holders.data : null,
      integrations: integrations.ok ? integrations.data : null,
      timeOff: timeOff.ok ? timeOff.data : null,
    });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  const back = { label: t('people.settings.settings.back', 'Back'), onPress: navigation.goBack };
  if (failed !== null) {
    return (
      <Page title={t('people.settings.settings.settings', 'Settings')} back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (data === null) {
    return (
      <Page title={t('people.settings.settings.settings', 'Settings')} back={back}>
        <Loading
          label={t('people.settings.settings.loading_the_settings', 'Loading the settings')}
        />
      </Page>
    );
  }

  const roles = data.roles ?? { hr: false, admin: false, finance: false };
  const drafts = data.fields?.unpublishedChanges ?? 0;
  const finance =
    data.holders === null
      ? null
      : data.holders.holders.filter((p) => p.roles.includes('finance')).length;
  const live = (xs: readonly { archived: boolean }[]): number =>
    xs.filter((x) => !x.archived).length;

  // People's, as its route manifest offers them: fields and integrations to
  // its administrators, roles and the log to HR as well, organisation to all.
  const people: Row[] = [];
  if (data.roles !== null) {
    if (roles.admin) {
      people.push({
        title: t('people.settings.settings.employee_fields', 'Employee fields'),
        line:
          data.fields === null
            ? t(
                'people.settings.settings.what_you_keep_about_each_person',
                'What you keep about each person, who sees it and when it’s asked',
              )
            : [
                plural(data.fields.fields.length, 'field'),
                data.fields.published === null
                  ? 'not published yet'
                  : `version ${String(data.fields.published.version)}`,
                drafts === 0 ? null : plural(drafts, 'unpublished change'),
              ]
                .filter((x) => x !== null)
                .join(' · '),
        icon: TextCursorInput,
        ...(drafts > 0 ? { badge: drafts } : {}),
        go: () => {
          navigation.navigate('FieldRegistry');
        },
      });
    }
    people.push({
      title: t('people.settings.settings.organisation', 'Organisation'),
      line:
        data.organisation === null
          ? t(
              'people.settings.settings.legal_entities_locations_org_units_numbering',
              'Legal entities, locations, org units, numbering, country packs, reminders and pay bands',
            )
          : `${plural(live(data.organisation.legalEntities), 'legal entity', 'legal entities')} · ${plural(live(data.organisation.locations), 'location')}`,
      icon: Building2,
      go: () => {
        navigation.navigate('Organisation');
      },
    });
    if (roles.hr || roles.admin) {
      people.push({
        title: t('people.settings.settings.roles', 'Roles'),
        line:
          data.holders === null
            ? t(
                'people.settings.settings.who_has_administrator_hr_and_finance',
                'Who has administrator, HR and finance access',
              )
            : ['people_admin', 'hr', 'finance']
                .map((role) => {
                  const n = data.holders?.holders.filter((p) => p.roles.includes(role)).length ?? 0;
                  return role === 'people_admin'
                    ? plural(n, 'administrator')
                    : `${String(n)} in ${role === 'hr' ? 'HR' : 'finance'}`;
                })
                .join(' · '),
        icon: ShieldCheck,
        go: () => {
          navigation.navigate('Roles');
        },
      });
    }
    if (roles.admin) {
      const i = data.integrations;
      const scim = i?.scim?.connections.filter((c) => c.revokedAt === null) ?? [];
      people.push({
        title: t('people.settings.settings.integrations', 'Integrations'),
        line:
          i === null
            ? t(
                'people.settings.settings.slack_webhooks_and_provisioning_from_your',
                'Slack, webhooks and provisioning from your identity provider',
              )
            : [
                i.endpoints.length === 0
                  ? t('people.settings.settings.no_webhooks', 'No webhooks')
                  : plural(i.endpoints.length, 'webhook'),
                scim.length === 0
                  ? 'no provisioning'
                  : `provisioning from ${scim[0]?.system ?? ''}`,
              ].join(' · '),
        icon: Plug,
        go: () => {
          navigation.navigate('Integrations');
        },
      });
    }
    if (roles.hr || roles.admin) {
      people.push({
        title: t('people.settings.settings.activity_log', 'Activity log'),
        line: t(
          'people.settings.settings.every_change_who_made_it_and',
          'Every change, who made it and when',
        ),
        icon: ScrollText,
        go: () => {
          navigation.navigate('Activity', { areas: PEOPLE_AREAS });
        },
      });
    }
  }

  // Time Off's, as its manifest offers them: to HR (People's, or Time Off's
  // own) and administrators, its integrations to administrators only.
  const timeOff: Row[] = [];
  if (data.timeOff !== null) {
    const hr = roles.hr || data.timeOff.hrAdmin;
    const section = (title: string, line: string, icon: LucideIcon, key: TimeOffSection): Row => ({
      title,
      line,
      icon,
      go: () => {
        navigation.navigate('TimeOffSettings', { section: key });
      },
    });
    if (hr || roles.admin) {
      timeOff.push(
        section(
          t('people.settings.settings.leave_types', 'Leave types'),
          t(
            'people.settings.settings.each_kind_of_leave_how_much',
            'Each kind of leave: how much, and who approves',
          ),
          Tags,
          'leave-types',
        ),
        section(
          'Holidays',
          t(
            'people.settings.settings.per_location_kept_up_to_date',
            'Per location, kept up to date',
          ),
          CalendarDays,
          'holidays',
        ),
        section(
          'Approvals',
          t(
            'people.settings.settings.who_approves_team_minimums_escalation',
            'Who approves · team minimums · escalation',
          ),
          CheckCheck,
          'approvals',
        ),
        section(
          'Attendance',
          t(
            'people.settings.settings.ways_to_clock_in_the_working',
            'Ways to clock in · the working day',
          ),
          Clock3,
          'attendance',
        ),
        section(
          t('people.settings.settings.balance_rules', 'Balance rules'),
          t(
            'people.settings.settings.going_below_zero_when_someone_leaves',
            'Going below zero · when someone leaves',
          ),
          Scale,
          'negative',
        ),
      );
    }
    if (roles.admin) {
      timeOff.push(
        section(
          'Integrations',
          t(
            'people.settings.settings.calendars_chat_apps_and_badge_readers',
            'Calendars, chat apps and badge readers',
          ),
          Plug,
          'integrations',
        ),
      );
    }
  }

  // Documents' (MS1): one row to its page, which says who may change what.
  const documents: Row[] = [
    {
      title: t('people.settings.settings.documents', 'Documents'),
      line: t(
        'people.settings.settings.document_types_access_and_sharing_retention',
        'Document types · access and sharing · retention and legal holds',
      ),
      icon: FolderOpen,
      go: () => {
        navigation.navigate('DocumentsSettings');
      },
    },
  ];

  const activity: Row[] =
    roles.hr || roles.admin
      ? [
          {
            title: t('people.settings.settings.activity_log', 'Activity log'),
            line: t(
              'people.settings.settings.settings_changes_imports_and_exports_sensitive',
              'Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins',
            ),
            icon: History,
            go: () => {
              navigation.navigate('Activity');
            },
          },
        ]
      : [];

  const needle = find.trim().toLowerCase();
  const matches = (r: Row): boolean =>
    needle === '' || asked !== null || `${r.title} ${r.line}`.toLowerCase().includes(needle);
  const you: Row[] = [
    {
      title: t('people.settings.settings.notifications', 'Notifications'),
      line: t(
        'people.settings.settings.tasks_always_updates_as_you_choose',
        'Tasks always · updates as you choose · quiet hours',
      ),
      icon: Bell,
      go: () => {
        navigation.navigate('Notifications');
      },
    },
    // Performance's grants are each person's own (PFS3).
    ...(performance
      ? [
          {
            title: t('people.settings.settings.my_connected_tools', 'My connected tools'),
            line: t(
              'people.settings.settings.what_kithena_may_read_of_your',
              'What Kithena may read of your work for your reviews',
            ),
            icon: Plug,
            go: () => {
              navigation.navigate('PerformanceTools');
            },
          },
        ]
      : []),
    {
      title: t('people.settings.settings.appearance', 'Appearance'),
      line: LOOKS().find(([value]) => value === look)?.[1] ?? 'Automatic',
      icon: Moon,
      go: () => {
        setChoosingLook(true);
      },
    },
  ];
  const groups: (Group & { sub: string })[] = (
    [
      {
        title: t('people.settings.settings.people', 'People'),
        sub: t(
          'people.settings.settings.what_records_hold_who_sees_them',
          'What records hold, who sees them, where they go',
        ),
        rows: people,
      },
      {
        title: t('people.settings.settings.time_off', 'Time off'),
        sub: t(
          'people.settings.settings.how_people_request_earn_and_use',
          'How people request, earn and use days off',
        ),
        rows: timeOff,
      },
      {
        title: t('people.settings.settings.documents', 'Documents'),
        sub: t(
          'people.settings.settings.what_is_kept_who_sees_it',
          'What is kept, who sees it, how long it stays',
        ),
        rows: documents,
      },
      {
        title: t('people.settings.settings.activity', 'Activity'),
        sub: t('people.settings.settings.who_changed_what_and_when', 'Who changed what, and when'),
        rows: activity,
      },
      {
        title: t('people.settings.settings.you', 'You'),
        sub: t('people.settings.settings.only_on_your_account', 'Only on your account'),
        rows: you,
      },
    ] as const
  )
    .map((g) => ({ title: g.title, sub: g.sub, rows: g.rows.filter(matches) }))
    .filter((g) => g.rows.length > 0);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Page large="Settings" back={back}>
      {roles.admin && data.fields !== null && data.fields.published === null ? (
        <Alert
          tone="info"
          title={t(
            'people.settings.settings.set_up_the_employee_record',
            'Set up the employee record',
          )}
        >
          <Button
            size="sm"
            variant="primary"
            onPress={() => {
              navigation.navigate('PeopleSetup');
            }}
          >
            {t('people.settings.settings.start', 'Start')}
          </Button>
        </Alert>
      ) : null}
      <SearchField
        ask={roles.admin && data.fields !== null}
        value={find}
        onValueChange={(text) => {
          setFind(text);
          setAsked(null);
        }}
        onSearch={(text) => {
          if (roles.admin && text.trim().split(/\s+/u).length > 2) setAsked(text.trim());
        }}
        placeholder={
          roles.admin
            ? t(
                'people.settings.settings.find_a_setting_or_ask_to',
                'Find a setting, or ask to change one',
              )
            : t('people.settings.settings.find_a_setting', 'Find a setting')
        }
        label={t('people.settings.settings.find_a_setting', 'Find a setting')}
      />
      {asked === null || data.fields === null ? null : (
        <AskedChange
          registry={data.fields as Registry}
          sentence={asked}
          onDismiss={() => {
            setAsked(null);
          }}
          onDone={() => {
            setAsked(null);
            setFind('');
            void load();
          }}
        />
      )}
      {roles.admin && (drafts > 0 || finance === 0) ? (
        <View className="flex-row flex-wrap gap-1.5">
          {drafts > 0 ? (
            <Chip
              icon={TriangleAlert}
              onPress={() => {
                navigation.navigate('FieldRegistry');
              }}
            >
              {t('people.settings.settings.to_publish', '{{plural}} to publish', {
                plural: plural(drafts, 'draft'),
              })}
            </Chip>
          ) : null}
          {finance === 0 ? (
            <Chip
              icon={TriangleAlert}
              onPress={() => {
                navigation.navigate('Roles');
              }}
            >
              {t('people.settings.settings.nobody_in_finance', 'Nobody in finance')}
            </Chip>
          ) : null}
        </View>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState
          icon={SettingsIcon}
          title={t('people.settings.settings.no_setting_matches', 'No setting matches')}
          description={t('people.settings.settings.try_another_word', 'Try another word.')}
        />
      ) : null}
      {groups.map((g) => (
        // One card per group (S1): its name and what it is for, then a row per setting.
        <Card key={g.title} padded={false} className="overflow-hidden">
          <View className="gap-0.5 px-4 pb-1 pt-4">
            <Text variant="headline" accessibilityRole="header">
              {g.title}
            </Text>
            <Text variant="footnote" tone="muted">
              {g.sub}
            </Text>
          </View>
          {g.rows.map((r) => (
            <ListItem
              key={r.title}
              listitem={false}
              icon={r.icon}
              description={r.line}
              {...(r.badge === undefined
                ? { chevron: true }
                : {
                    trailing: (
                      <Badge size="sm" tone="danger" variant="solid">
                        {String(r.badge)}
                      </Badge>
                    ),
                  })}
              onPress={r.go}
            >
              {r.title}
            </ListItem>
          ))}
          {g.title === 'You' ? (
            <ListItem
              listitem={false}
              icon={Languages}
              description={t('people.settings.settings.english', 'English · {{zone}}', { zone })}
            >
              {t('people.settings.settings.language_and_region', 'Language and region')}
            </ListItem>
          ) : null}
        </Card>
      ))}
      {choosingLook ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setChoosingLook(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('people.settings.settings.appearance', 'Appearance')}</DialogTitle>
              <DialogDescription>
                {t(
                  'people.settings.settings.how_the_app_looks_on_this',
                  'How the app looks on this phone. Only you see this.',
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <SegmentedControl
                value={look}
                fullWidth
                accessibilityLabel={t('people.settings.settings.appearance', 'Appearance')}
                onValueChange={(next) => {
                  const chosen = LOOKS().find(([value]) => value === next)?.[0] ?? 'system';
                  chooseLook(chosen);
                  setLook(chosen);
                }}
              >
                {LOOKS().map(([value, label]) => (
                  <SegmentedControlItem key={value} value={value}>
                    {label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setChoosingLook(false);
                }}
              >
                {t('people.settings.settings.done', 'Done')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Page>
  );
}
