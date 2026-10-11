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
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { savedLook, setLook, type Look } from '../../appearance';
import { Failed, Loading, Page } from '../../frame';
import { ask, useSigned } from '../api';
import type { Roles } from '../roles';
import { AskedChange } from './field-sentence';
import type { Registry } from './fields-model';
import type { PeopleRoutes, PeopleScreen } from '../routes';

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

const LOOKS: readonly [Look, string][] = [
  ['system', 'Automatic'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/**
 * Settings (design H1), as the web's Settings page: every setting this person
 * may open, grouped by the module it belongs to, each saying what is set now
 * where that can be read; the company's activity log for its administrators
 * and HR; and, last, their own. What needs somebody first comes as chips
 * above. A setting this viewer may not open is not drawn.
 */
export function Settings({ navigation }: PeopleScreen<'Settings'>): React.JSX.Element {
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

  const back = { label: 'Back', onPress: navigation.goBack };
  if (failed !== null) {
    return (
      <Page title="Settings" back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (data === null) {
    return (
      <Page title="Settings" back={back}>
        <Loading label="Loading the settings" />
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
        title: 'Employee fields',
        line:
          data.fields === null
            ? 'What you keep about each person, who sees it and when it’s asked'
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
      title: 'Organisation',
      line:
        data.organisation === null
          ? 'Legal entities, locations, org units, numbering, country packs, reminders and pay bands'
          : `${plural(live(data.organisation.legalEntities), 'legal entity', 'legal entities')} · ${plural(live(data.organisation.locations), 'location')}`,
      icon: Building2,
      go: () => {
        navigation.navigate('Organisation');
      },
    });
    if (roles.hr || roles.admin) {
      people.push({
        title: 'Roles',
        line:
          data.holders === null
            ? 'Who has administrator, HR and finance access'
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
        title: 'Integrations',
        line:
          i === null
            ? 'Slack, webhooks and provisioning from your identity provider'
            : [
                i.endpoints.length === 0 ? 'No webhooks' : plural(i.endpoints.length, 'webhook'),
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
        title: 'Activity log',
        line: 'Every change, who made it and when',
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
          'Leave types',
          'Each kind of leave: how much, and who approves',
          Tags,
          'leave-types',
        ),
        section('Holidays', 'Per location, kept up to date', CalendarDays, 'holidays'),
        section('Approvals', 'Who approves · team minimums · escalation', CheckCheck, 'approvals'),
        section('Attendance', 'Ways to clock in · the working day', Clock3, 'attendance'),
        section('Balance rules', 'Going below zero · when someone leaves', Scale, 'negative'),
      );
    }
    if (roles.admin) {
      timeOff.push(
        section('Integrations', 'Calendars, chat apps and badge readers', Plug, 'integrations'),
      );
    }
  }

  // Documents' (MS1): one row to its page, which says who may change what.
  const documents: Row[] = [
    {
      title: 'Documents',
      line: 'Document types · access and sharing · retention and legal holds',
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
            title: 'Activity log',
            line: 'Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins',
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
      title: 'Notifications',
      line: 'Tasks always · updates as you choose · quiet hours',
      icon: Bell,
      go: () => {
        navigation.navigate('Notifications');
      },
    },
    {
      title: 'Appearance',
      line: LOOKS.find(([value]) => value === look)?.[1] ?? 'Automatic',
      icon: Moon,
      go: () => {
        setChoosingLook(true);
      },
    },
  ];
  const groups: (Group & { sub: string })[] = (
    [
      { title: 'People', sub: 'What records hold, who sees them, where they go', rows: people },
      { title: 'Time off', sub: 'How people request, earn and use days off', rows: timeOff },
      { title: 'Documents', sub: 'What is kept, who sees it, how long it stays', rows: documents },
      { title: 'Activity', sub: 'Who changed what, and when', rows: activity },
      { title: 'You', sub: 'Only on your account', rows: you },
    ] as const
  )
    .map((g) => ({ title: g.title, sub: g.sub, rows: g.rows.filter(matches) }))
    .filter((g) => g.rows.length > 0);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Page large="Settings" back={back}>
      {roles.admin && data.fields !== null && data.fields.published === null ? (
        <Alert tone="info" title="Set up the employee record">
          <Button
            size="sm"
            variant="primary"
            onPress={() => {
              navigation.navigate('PeopleSetup');
            }}
          >
            Start
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
        placeholder={roles.admin ? 'Find a setting, or ask to change one' : 'Find a setting'}
        label="Find a setting"
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
              {`${plural(drafts, 'draft')} to publish`}
            </Chip>
          ) : null}
          {finance === 0 ? (
            <Chip
              icon={TriangleAlert}
              onPress={() => {
                navigation.navigate('Roles');
              }}
            >
              Nobody in finance
            </Chip>
          ) : null}
        </View>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState
          icon={SettingsIcon}
          title="No setting matches"
          description="Try another word."
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
            <ListItem listitem={false} icon={Languages} description={`English · ${zone}`}>
              Language and region
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
              <DialogTitle>Appearance</DialogTitle>
              <DialogDescription>
                How the app looks on this phone. Only you see this.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <SegmentedControl
                value={look}
                fullWidth
                accessibilityLabel="Appearance"
                onValueChange={(next) => {
                  const chosen = LOOKS.find(([value]) => value === next)?.[0] ?? 'system';
                  chooseLook(chosen);
                  setLook(chosen);
                }}
              >
                {LOOKS.map(([value, label]) => (
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
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Page>
  );
}
