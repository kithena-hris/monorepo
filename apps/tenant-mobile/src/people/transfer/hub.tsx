import {
  Alert,
  Button,
  Card,
  EmptyState,
  Inline,
  List,
  ListItem,
  Progress,
  Stack,
  Text,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { ArrowDownToLine, ArrowUpFromLine, History } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { ask, useSigned } from '../api';
import { parsed } from '../review/load';
import { useRoles } from '../roles';
import type { PeopleScreen } from '../routes';
import type { RunStatus } from './model';
import { t } from '../../i18n';

interface Entry {
  readonly id: string;
  readonly kind: 'import' | 'export';
  readonly title: string | null;
  readonly at: string;
  readonly by: { readonly name: string };
  readonly imported: { created: number; updated: number; blocked: number } | null;
  readonly exported: { rows: number; format: string | null } | null;
  readonly downloadable: boolean;
  readonly reportUrl: string | null;
  readonly run: {
    status: string;
    label: string;
    people: { done: number; total: number | null };
  } | null;
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** "6 created · 1 skipped · 15 Sep", "42 people · Excel · Mon": one history row's line. */
function lineOf(e: Entry): string {
  if (e.run !== null && e.run.status === 'importing') {
    return `${e.run.label}… ${String(e.run.people.done)}${e.run.people.total === null ? '' : ` of ${String(e.run.people.total)}`}`;
  }
  if (e.imported !== null) {
    return [
      `${String(e.imported.created)} created`,
      e.imported.updated > 0 ? `${String(e.imported.updated)} updated` : null,
      e.imported.blocked > 0 ? `${String(e.imported.blocked)} skipped` : null,
      day(e.at),
    ]
      .filter((x) => x !== null)
      .join(' · ');
  }
  if (e.exported !== null) {
    return [
      `${String(e.exported.rows)} people`,
      e.exported.format === null
        ? null
        : e.exported.format === 'xlsx'
          ? 'Excel'
          : e.exported.format.toUpperCase(),
      day(e.at),
    ]
      .filter((x) => x !== null)
      .join(' · ');
  }
  return day(e.at);
}

/**
 * Import & export (design F1): two tiles and the history. The import that is
 * running shows its progress here and opens where it can be followed. No
 * template, kind filter or search on a phone, as designed.
 */
export function ImportExport({ navigation }: PeopleScreen<'ImportExport'>): React.JSX.Element {
  const signed = useSigned();
  const { hr } = useRoles();
  const [items, setItems] = useState<readonly Entry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [active, setActive] = useState<RunStatus | null>(null);
  const [more, setMore] = useState(false);

  const load = async (): Promise<void> => {
    const [history, running] = await Promise.all([
      ask<{ items: Entry[]; next: string | null }>(signed, 'TransferHistory', {}),
      ask<string>(signed, 'ActiveImportRun'),
    ]);
    if (!history.ok) {
      setFailed(history.message);
      return;
    }
    setFailed(null);
    setItems(history.data.items);
    setNext(history.data.next);
    setActive(running.ok ? (parsed(running.data) as RunStatus | null) : null);
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  const back = { label: t('people.transfer.hub.people', 'People'), onPress: navigation.goBack };
  if (failed !== null)
    return (
      <Page title={t('people.transfer.hub.import_export', 'Import & export')} back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  if (items === null)
    return (
      <Page title={t('people.transfer.hub.import_export', 'Import & export')} back={back}>
        <Loading
          label={t(
            'people.transfer.hub.loading_imports_and_exports',
            'Loading imports and exports',
          )}
        />
      </Page>
    );

  return (
    <Page title={t('people.transfer.hub.import_export', 'Import & export')} back={back}>
      <Inline gap={2} wrap={false}>
        {hr ? (
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel={t(
              'people.transfer.hub.import_people_from_a_file',
              'Import people from a file',
            )}
            onPress={() => {
              if (active === null) navigation.navigate('Import');
              else navigation.navigate('ImportRun', { id: active.id });
            }}
          >
            <Card>
              <Stack gap={2}>
                <ArrowDownToLine size={22} />
                <Text variant="title3">{t('people.transfer.hub.import', 'Import')}</Text>
                <Text variant="footnote" tone="muted">
                  {active === null
                    ? t('people.transfer.hub.from_excel_or_csv', 'From Excel or CSV')
                    : t('people.transfer.hub.importing', 'Importing… {{String}}{{value}}', {
                        String: String(active.people.done),
                        value:
                          active.people.total === null ? '' : ` of ${String(active.people.total)}`,
                      })}
                </Text>
              </Stack>
            </Card>
          </Pressable>
        ) : null}
        <Pressable
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel={t(
            'people.transfer.hub.export_people_to_a_file',
            'Export people to a file',
          )}
          onPress={() => {
            navigation.navigate('Export');
          }}
        >
          <Card>
            <Stack gap={2}>
              <ArrowUpFromLine size={22} />
              <Text variant="title3">{t('people.transfer.hub.export', 'Export')}</Text>
              <Text variant="footnote" tone="muted">
                {t('people.transfer.hub.with_a_reason', 'With a reason')}
              </Text>
            </Stack>
          </Card>
        </Pressable>
      </Inline>

      {active === null ? null : (
        <Alert tone="info" title={active.step}>
          <Stack gap={2}>
            <Progress
              value={active.people.total === null ? null : active.people.done}
              max={active.people.total ?? 1}
              label={t('people.transfer.hub.people_imported', 'People imported')}
            />
            <Button
              size="sm"
              onPress={() => {
                navigation.navigate('ImportRun', { id: active.id });
              }}
            >
              {t('people.transfer.hub.follow_it', 'Follow it')}
            </Button>
          </Stack>
        </Alert>
      )}

      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {t('people.transfer.hub.history', 'History')}
      </Text>
      {items.length === 0 ? (
        <EmptyState
          icon={History}
          title={t('people.transfer.hub.nothing_yet', 'Nothing yet')}
          description={t(
            'people.transfer.hub.imports_and_exports_appear_here',
            'Imports and exports appear here.',
          )}
        />
      ) : (
        <List>
          {items.map((e) => (
            <ListItem
              key={e.id}
              icon={e.kind === 'import' ? ArrowDownToLine : ArrowUpFromLine}
              iconTone={e.kind === 'import' ? ((e.imported?.blocked ?? 0) > 0 ? 4 : 1) : 6}
              description={`${lineOf(e)} · ${e.by.name}`}
              chevron
              onPress={() => {
                if (e.kind === 'export') navigation.navigate('ExportRecord', { id: e.id });
                else if (e.reportUrl !== null) void WebBrowser.openBrowserAsync(e.reportUrl);
                else navigation.navigate('ImportRun', { id: e.id });
              }}
            >
              {e.title ??
                (e.kind === 'import'
                  ? t('people.transfer.hub.an_import', 'An import')
                  : t('people.transfer.hub.an_export', 'An export'))}
            </ListItem>
          ))}
        </List>
      )}
      {next === null ? null : (
        <Button
          loading={more}
          onPress={() => {
            setMore(true);
            void ask<{ items: Entry[]; next: string | null }>(signed, 'TransferHistory', {
              before: next,
            }).then((page) => {
              setMore(false);
              if (!page.ok) return;
              setItems((held) => [...(held ?? []), ...page.data.items]);
              setNext(page.data.next);
            });
          }}
        >
          {t('people.transfer.hub.show_older', 'Show older')}
        </Button>
      )}
    </Page>
  );
}
