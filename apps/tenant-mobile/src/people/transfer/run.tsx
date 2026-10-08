import { Alert, AutoGrid, Button, Progress, Stack, Stat, Text } from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { ask, useSigned } from '../api';
import { parsed } from '../review/load';
import type { PeopleScreen } from '../routes';
import { isRunning, type RunStatus } from './model';

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

  const back = { label: 'Import & export', onPress: navigation.goBack };
  if (failed !== null)
    return (
      <Page title="Import" back={back}>
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
      <Page title="Import" back={back}>
        <Loading label="Loading the import" />
      </Page>
    );

  const result = run.result;
  return (
    <Page
      title="Import"
      back={back}
      {...(run.status === 'succeeded'
        ? {
            foot: (
              <Button
                className="flex-1"
                fullWidth
                variant="primary"
                onPress={() => {
                  navigation.navigate('Directory');
                }}
              >
                Open in Directory
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
            label="People imported"
            showValue
            valueLabel={
              run.people.total === null
                ? 'Reading the file'
                : `${String(run.people.done)} of ${String(run.people.total)}`
            }
          />
          <Text variant="footnote" tone="muted">
            It keeps going if you leave this screen.
          </Text>
        </Stack>
      ) : run.status === 'failed' ? (
        <Alert tone="danger" title="Import failed">
          {run.failure ?? 'The import stopped.'}
        </Alert>
      ) : result === null ? (
        <Text>{run.label}</Text>
      ) : (
        <>
          <Text variant="title2">
            {`Imported ${String(result.created + result.updated)} people${
              (result.fields ?? []).length === 0
                ? ''
                : ` and created ${String((result.fields ?? []).length)} ${(result.fields ?? []).length === 1 ? 'field' : 'fields'}`
            }`}
          </Text>
          {result.finishedAt === undefined ? null : (
            <Text tone="muted">
              {`Finished ${new Date(result.finishedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${
                result.tookMs === undefined
                  ? ''
                  : ` · took ${String(Math.max(1, Math.round(result.tookMs / 1000)))} s`
              }`}
            </Text>
          )}
          <AutoGrid minItemWidth={140} gap={2}>
            <Stat label="Created" value={result.created} />
            <Stat label="Updated" value={result.updated} />
            {result.asked === undefined ? null : <Stat label="Asked" value={result.asked} />}
            {result.forHr === undefined ? null : <Stat label="For HR" value={result.forHr} />}
            {result.blocked === 0 ? null : <Stat label="Skipped" value={result.blocked} />}
            {result.held === undefined || result.held === 0 ? null : (
              <Stat label="Waiting for approval" value={result.held} />
            )}
          </AutoGrid>
          {result.reportUrl === undefined ? null : (
            <Button onPress={() => void WebBrowser.openBrowserAsync(result.reportUrl ?? '')}>
              Download the report
            </Button>
          )}
          <Alert tone="info" title="Nobody has been invited yet">
            Invite each from their record.
          </Alert>
        </>
      )}
    </Page>
  );
}
