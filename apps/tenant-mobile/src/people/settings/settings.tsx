import {
  Alert,
  Badge,
  Button,
  Chip,
  EmptyState,
  List,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
} from '@reach/ui-native';
import {
  Building2,
  CalendarDays,
  CheckCheck,
  Clock3,
  History,
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
        line: 'Changes to People’s settings: who, and when. Never the values themselves',
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
          'The kinds of time off people can request, and how each one is paid and approved',
          Tags,
          'leave-types',
        ),
        section(
          'Holidays',
          'The public holidays each location keeps, year by year',
          CalendarDays,
          'holidays',
        ),
        section(
          'Negative balance',
          'What happens when someone books more than they have earned',
          Scale,
          'negative',
        ),
        section(
          'Attendance',
          'Schedules, breaks, overtime and how clocking in works',
          Clock3,
          'attendance',
        ),
        section(
          'Approvals',
          'Who approves what, cover minimums and when a request escalates',
          CheckCheck,
          'approvals',
        ),
      );
    }
    if (roles.admin) {
      timeOff.push(
        section('Integrations', 'Calendars, chat apps and badge readers', Plug, 'integrations'),
      );
    }
  }

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
    needle === '' || `${r.title} ${r.line}`.toLowerCase().includes(needle);
  const groups: Group[] = (
    [
      { title: 'People', rows: people },
      { title: 'Time off', rows: timeOff },
      { title: 'Activity', rows: activity },
    ] as const
  )
    .map((g) => ({ title: g.title, rows: g.rows.filter(matches) }))
    .filter((g) => g.rows.length > 0);
  const youShown = needle === '' || 'appearance dark light mode'.includes(needle);

  return (
    <Page title="Settings" back={back}>
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
        value={find}
        onValueChange={setFind}
        placeholder="Find a setting"
        label="Find a setting"
      />
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
      {groups.length === 0 && !youShown ? (
        <EmptyState
          icon={SettingsIcon}
          title="No setting matches"
          description="Try another word."
        />
      ) : null}
      {groups.map((g) => (
        <Stack key={g.title} gap={2}>
          <Text
            variant="caption"
            weight="semibold"
            tone="subtle"
            accessibilityRole="header"
            className="px-4 text-[12px] leading-none"
          >
            {g.title}
          </Text>
          <List>
            {g.rows.map((r) => (
              <ListItem
                key={r.title}
                icon={r.icon}
                description={r.line}
                {...(r.badge === undefined
                  ? { chevron: true }
                  : {
                      trailing: (
                        <Badge size="sm" tone="warning">
                          {String(r.badge)}
                        </Badge>
                      ),
                    })}
                onPress={r.go}
              >
                {r.title}
              </ListItem>
            ))}
          </List>
        </Stack>
      ))}
      {youShown ? (
        <Stack gap={2}>
          <Text
            variant="caption"
            weight="semibold"
            tone="subtle"
            accessibilityRole="header"
            className="px-4 text-[12px] leading-none"
          >
            You
          </Text>
          <Text variant="footnote" tone="muted" className="px-1">
            Appearance: how the app looks on this phone. Only you see this.
          </Text>
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
        </Stack>
      ) : null}
    </Page>
  );
}
