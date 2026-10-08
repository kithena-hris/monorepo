import {
  Alert,
  Badge,
  Button,
  Chip,
  EmptyState,
  List,
  ListItem,
  SearchField,
} from '@reach/ui-native';
import {
  Building2,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  TextCursorInput,
  TriangleAlert,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';

/** What each of People's settings holds now, read before anybody opens one. */
interface Overview {
  readonly fields: {
    readonly published: { readonly version: number } | null;
    readonly unpublishedChanges: number;
    readonly fields: readonly unknown[];
  } | null;
  readonly organisation: {
    readonly legalEntities: readonly { readonly archived: boolean }[];
    readonly locations: readonly { readonly archived: boolean }[];
  } | null;
  readonly roles: { readonly holders: readonly { readonly roles: readonly string[] }[] } | null;
  readonly integrations: {
    readonly endpoints: readonly { readonly enabled: boolean; readonly retrying: boolean }[];
    readonly scim: {
      readonly connections: readonly {
        readonly system: string;
        readonly revokedAt: string | null;
      }[];
    } | null;
  } | null;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * Settings (design H1): People's five settings as rows, each saying what is
 * set now, with what needs somebody first as chips above them. A setting
 * this viewer may not open is not drawn.
 */
export function Settings({ navigation }: PeopleScreen<'Settings'>): React.JSX.Element {
  const signed = useSigned();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [find, setFind] = useState('');

  const load = async (): Promise<void> => {
    setFailed(null);
    const [fields, organisation, roles, integrations] = await Promise.all([
      ask<Overview['fields']>(signed, 'Registry'),
      ask<Overview['organisation']>(signed, 'Organisation'),
      ask<Overview['roles']>(signed, 'RoleSettings', {}),
      ask<Overview['integrations']>(signed, 'Integrations'),
    ]);
    const offline = [fields, organisation, roles, integrations].find(
      (a) => !a.ok && a.code === 'OFFLINE',
    );
    if (offline !== undefined && !offline.ok) {
      setFailed(offline.message);
      return;
    }
    setData({
      fields: fields.ok ? fields.data : null,
      organisation: organisation.ok ? organisation.data : null,
      roles: roles.ok ? roles.data : null,
      integrations: integrations.ok ? integrations.data : null,
    });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  const back = { label: 'Me', onPress: navigation.goBack };
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

  const drafts = data.fields?.unpublishedChanges ?? 0;
  const finance = data.roles?.holders.filter((p) => p.roles.includes('finance')).length ?? null;
  const live = (xs: readonly { archived: boolean }[]): number =>
    xs.filter((x) => !x.archived).length;
  const rows: { title: string; line: string; icon: typeof Plug; go: () => void }[] = [];
  if (data.fields !== null) {
    rows.push({
      title: 'Employee fields',
      line: `${plural(data.fields.fields.length, 'field')}${drafts === 0 ? '' : ` · ${plural(drafts, 'draft')}`}`,
      icon: TextCursorInput,
      go: () => {
        navigation.navigate('FieldRegistry');
      },
    });
  }
  if (data.organisation !== null) {
    rows.push({
      title: 'Organisation',
      line: `${plural(live(data.organisation.legalEntities), 'entity', 'entities')} · ${plural(live(data.organisation.locations), 'location')}`,
      icon: Building2,
      go: () => {
        navigation.navigate('Organisation');
      },
    });
  }
  if (data.roles !== null) {
    rows.push({
      title: 'Roles',
      line: `${String(finance ?? 0)} in finance`,
      icon: ShieldCheck,
      go: () => {
        navigation.navigate('Roles');
      },
    });
  }
  if (data.integrations !== null) {
    const i = data.integrations;
    const scim = i.scim?.connections.filter((c) => c.revokedAt === null) ?? [];
    rows.push({
      title: 'Integrations',
      line:
        [
          i.endpoints.length === 0 ? null : plural(i.endpoints.length, 'webhook'),
          ...scim.map((c) => c.system),
        ]
          .filter((x) => x !== null)
          .join(' · ') || 'Nothing connected',
      icon: Plug,
      go: () => {
        navigation.navigate('Integrations');
      },
    });
  }
  rows.push({
    title: 'Activity log',
    line: 'Who did what, and when',
    icon: ScrollText,
    go: () => {
      navigation.navigate('Activity');
    },
  });
  const needle = find.trim().toLowerCase();
  const shown = rows.filter(
    (r) => needle === '' || `${r.title} ${r.line}`.toLowerCase().includes(needle),
  );

  return (
    <Page title="Settings" back={back}>
      {data.fields !== null && data.fields.published === null ? (
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
      {drafts === 0 && finance !== 0 ? null : (
        <View className="flex-row flex-wrap gap-1.5">
          {drafts === 0 ? null : (
            <Chip
              icon={TriangleAlert}
              onPress={() => {
                navigation.navigate('FieldRegistry');
              }}
            >
              {`${plural(drafts, 'draft')} to publish`}
            </Chip>
          )}
          {finance !== 0 ? null : (
            <Chip
              icon={TriangleAlert}
              onPress={() => {
                navigation.navigate('Roles');
              }}
            >
              Nobody in finance
            </Chip>
          )}
        </View>
      )}
      {shown.length === 0 ? (
        <EmptyState
          icon={SettingsIcon}
          title="No setting matches"
          description="Try another word."
        />
      ) : (
        <List>
          {shown.map((r) => (
            <ListItem
              key={r.title}
              icon={r.icon}
              description={r.line}
              {...(r.title === 'Employee fields' && drafts > 0
                ? {
                    trailing: (
                      <Badge size="sm" tone="warning">
                        {String(drafts)}
                      </Badge>
                    ),
                  }
                : { chevron: true })}
              onPress={r.go}
            >
              {r.title}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}
