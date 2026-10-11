import { Badge, Button, List, ListItem, Progress, Text } from '@reach/ui-native';
import { useState } from 'react';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askDocuments, meta, useDocuments, type Row } from './api';

/**
 * A person's file on the phone (MH2): the checklist their types require,
 * each row with its one action, then what is filed to them.
 */

interface PersonFileData {
  readonly jobLine: string;
  readonly have: number;
  readonly of: number;
  readonly hr: boolean;
  readonly checklist: readonly {
    typeKey: string;
    name: string;
    state: 'have' | 'expired' | 'asked' | 'missing';
    detail: string;
    documentId: string | null;
    requestId: string | null;
    action: 'view' | 'remind' | 'ask';
  }[];
  readonly rows: readonly Row[];
}

const STATE = {
  have: ['In the file', 'success'],
  asked: ['Asked', 'info'],
  expired: ['Expired', 'danger'],
  missing: ['Missing', 'warning'],
} as const;

export function DocumentsPersonFile({
  navigation,
  route,
}: PeopleScreen<'DocumentsPersonFile'>): React.JSX.Element {
  const signed = useSigned();
  const { personId, name } = route.params;
  const { load, reload } = useDocuments<PersonFileData>('DocumentsPersonFile', { personId });
  const [done, setDone] = useState<Readonly<Record<string, string>>>({});
  const back = { label: 'Documents', onPress: navigation.goBack };
  const first = name.split(' ')[0] ?? name;
  if (load.status !== 'ready') {
    return (
      <Page title={name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the file" />
        )}
      </Page>
    );
  }
  const data = load.data;
  return (
    <Page title={name} back={back}>
      <Text tone="muted">{data.jobLine}</Text>
      {data.of === 0 ? null : (
        <>
          <Heading title={`Required · ${String(data.have)} of ${String(data.of)}`} />
          <Progress
            value={(data.have / data.of) * 100}
            label={`${String(data.have)} of ${String(data.of)}`}
          />
          <List>
            {data.checklist.map((r) => (
              <ListItem
                key={r.typeKey}
                description={r.detail}
                supporting={
                  <Badge tone={STATE[r.state][1]} size="sm">
                    {STATE[r.state][0]}
                  </Badge>
                }
                trailing={
                  done[r.typeKey] !== undefined ? (
                    <Text variant="footnote" tone="muted">
                      {done[r.typeKey]}
                    </Text>
                  ) : r.action === 'view' && r.documentId !== null ? (
                    <Button
                      size="xs"
                      onPress={() => {
                        navigation.navigate('DocumentDetail', {
                          id: r.documentId ?? '',
                          title: r.name,
                        });
                      }}
                    >
                      Open
                    </Button>
                  ) : data.hr && r.action === 'remind' && r.requestId !== null ? (
                    <Button
                      size="xs"
                      onPress={() =>
                        void askDocuments(signed, 'RemindDocumentRequest', {
                          requestId: r.requestId,
                        }).then((a) => {
                          if (a.ok) setDone({ ...done, [r.typeKey]: 'Reminded' });
                        })
                      }
                    >
                      Remind
                    </Button>
                  ) : data.hr ? (
                    <Button
                      size="xs"
                      variant="primary"
                      onPress={() =>
                        void askDocuments(signed, 'AskForDocument', {
                          input: {
                            personId,
                            typeKey: r.typeKey,
                            dueOn: null,
                            message: `Hi ${first}, we need your ${r.name.toLowerCase()}. A photo is fine.`,
                          },
                        }).then((a) => {
                          if (a.ok) {
                            setDone({ ...done, [r.typeKey]: 'Asked' });
                            reload();
                          }
                        })
                      }
                    >
                      Ask
                    </Button>
                  ) : null
                }
              >
                {r.name}
              </ListItem>
            ))}
          </List>
        </>
      )}
      <Heading title={data.hr ? `Filed to ${first}` : 'Filed to you'} />
      <List>
        {data.rows.map((row) => (
          <ListItem
            key={row.id}
            description={meta(row)}
            chevron
            onPress={() => {
              navigation.navigate('DocumentDetail', { id: row.id, title: row.title });
            }}
          >
            {row.title}
          </ListItem>
        ))}
      </List>
    </Page>
  );
}
