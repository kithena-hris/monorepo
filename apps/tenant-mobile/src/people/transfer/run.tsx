import { Alert, AutoGrid, Button, Progress, Stack, Stat, Text } from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { ask, useSigned } from '../api';
import { parsed } from '../review/load';
import type { PeopleScreen } from '../routes';
import { isRunning, type RunStatus } from './model';
import { t } from '../../i18n';

/**
 * An approved import, followed (design F5): its progress while it runs, read
 * again every two seconds, then what it did — created, updated, asked, left
 * to HR — and that nobody has been invited yet. A failure says why and what
 * stays.
 */
export function ImportRun({ navigation, route }: PeopleScreen<'ImportRun'>): React.JSX.Element {
  const signed = useSigned();
  const [run, setRun] = useState<RunStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      const answer = await ask<string>(signed, 'ImportRun', { id: route.params.id });
      if (!live) return;
      if (!answer.ok) {
        setFailed(answer.message);
        return;
      }
      const status = parsed(answer.data) as RunStatus | null;
      setRun(status);
      if (status !== null && isRunning(status)) {
        timer = setTimeout(() => void read(), 2000);
      }
    };
    void read();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [signed, route.params.id]);

  const back = {
    label: t('people.transfer.run.import_export', 'Import & export'),
    onPress: navigation.goBack,
  };
  if (failed !== null)
    return (
      <Page title={t('people.transfer.run.import', 'Import')} back={back}>
        <Failed
          message={failed}
          onRetry={() => {
            setFailed(null);
          }}
        />
      </Page>
    );
  if (run === null)
    return (
      <Page title={t('people.transfer.run.import', 'Import')} back={back}>
        <Loading label={t('people.transfer.run.loading_the_import', 'Loading the import')} />
      </Page>
    );

  const result = run.result;
  return (
    <Page
      title={t('people.transfer.run.import', 'Import')}
      back={back}
      {...(run.status === 'succeeded'
        ? {
            foot: (
              <Button
                className="flex-1"
                fullWidth
                variant="primary"
                onPress={() => {
                  navigation.navigate('People');
                }}
              >
                {t('people.transfer.run.open_in_directory', 'Open in Directory')}
              </Button>
            ),
          }
        : {})}
    >
      {isRunning(run) ? (
        <Stack gap={3}>
          <Text variant="title3">{run.step}</Text>
          <Progress
            value={run.people.total === null ? null : run.people.done}
            max={run.people.total ?? 1}
            label={t('people.transfer.run.people_imported', 'People imported')}
            showValue
            valueLabel={
              run.people.total === null
                ? t('people.transfer.run.reading_the_file', 'Reading the file')
                : t('people.transfer.run.of', '{{String}} of {{String2}}', {
                    String: String(run.people.done),
                    String2: String(run.people.total),
                  })
            }
          />
          <Text variant="footnote" tone="muted">
            {t(
              'people.transfer.run.it_keeps_going_if_you_leave',
              'It keeps going if you leave this screen.',
            )}
          </Text>
        </Stack>
      ) : run.status === 'failed' ? (
        <Alert tone="danger" title={t('people.transfer.run.import_failed', 'Import failed')}>
          {run.failure ?? t('people.transfer.run.the_import_stopped', 'The import stopped.')}
        </Alert>
      ) : result === null ? (
        <Text>{run.label}</Text>
      ) : (
        <>
          <Text variant="title2">
            {t('people.transfer.run.imported_people', 'Imported {{String}} people{{value}}', {
              String: String(result.created + result.updated),
              value:
                (result.fields ?? []).length === 0
                  ? ''
                  : ` and created ${String((result.fields ?? []).length)} ${(result.fields ?? []).length === 1 ? 'field' : 'fields'}`,
            })}
          </Text>
          {result.finishedAt === undefined ? null : (
            <Text tone="muted">
              {t('people.transfer.run.finished', 'Finished {{toLocaleTimeString}}{{value}}', {
                toLocaleTimeString: new Date(result.finishedAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                value:
                  result.tookMs === undefined
                    ? ''
                    : ` · took ${String(Math.max(1, Math.round(result.tookMs / 1000)))} s`,
              })}
            </Text>
          )}
          <AutoGrid minItemWidth={140} gap={2}>
            <Stat label={t('people.transfer.run.created', 'Created')} value={result.created} />
            <Stat label={t('people.transfer.run.updated', 'Updated')} value={result.updated} />
            {result.asked === undefined ? null : (
              <Stat label={t('people.transfer.run.asked', 'Asked')} value={result.asked} />
            )}
            {result.forHr === undefined ? null : (
              <Stat label={t('people.transfer.run.for_hr', 'For HR')} value={result.forHr} />
            )}
            {result.blocked === 0 ? null : (
              <Stat label={t('people.transfer.run.skipped', 'Skipped')} value={result.blocked} />
            )}
            {result.held === undefined || result.held === 0 ? null : (
              <Stat
                label={t('people.transfer.run.waiting_for_approval', 'Waiting for approval')}
                value={result.held}
              />
            )}
          </AutoGrid>
          {result.reportUrl === undefined ? null : (
            <Button onPress={() => void WebBrowser.openBrowserAsync(result.reportUrl ?? '')}>
              {t('people.transfer.run.download_the_report', 'Download the report')}
            </Button>
          )}
          <Alert
            tone="info"
            title={t(
              'people.transfer.run.nobody_has_been_invited_yet',
              'Nobody has been invited yet',
            )}
          >
            {t(
              'people.transfer.run.invite_each_from_their_record',
              'Invite each from their record.',
            )}
          </Alert>
        </>
      )}
    </Page>
  );
}
