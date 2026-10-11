import { Alert, Badge, Button, List, ListItem, Switch, Text } from '@reach/ui-native';
import { Archive, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askDocuments, useDocuments } from './api';

/**
 * Settings › Documents on the phone (MS1–MS3, MS5, MS6): the types as one
 * line each, the access switches, retention and legal holds. HR changes the
 * switches and lifts holds; editing a type's sentence is the web's
 * (`desktop-only.json`).
 */

interface SettingsData {
  readonly types: readonly {
    key: string;
    name: string;
    archived: boolean;
    used: number;
    retentionWords: string;
    requiredFor: string | null;
    signers: readonly string[];
    confidential: boolean;
  }[];
  readonly access: Readonly<Record<string, boolean | string>>;
  readonly holds: readonly { id: string; name: string; setBy: string; count: number }[];
  readonly hr: boolean;
}

const SWITCHES: readonly (readonly [string, string])[] = [
  ['askAfterUpload', 'Ask once after an upload whether to share'],
  ['peopleMayTurnOffQuestion', 'People can turn the question off'],
  ['watermark', 'Watermark confidential documents'],
  ['blockDownload', 'Block download and print'],
  ['personalSections', 'Everyone can create personal sections'],
];

export function DocumentsSettings({
  navigation,
}: PeopleScreen<'DocumentsSettings'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useDocuments<SettingsData>('DocumentsSettings');
  const [problem, setProblem] = useState<string | null>(null);
  const back = { label: 'Settings', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Documents" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the settings" />
        )}
      </Page>
    );
  }
  const d = load.data;
  const save = (input: Record<string, unknown>): void => {
    void askDocuments(signed, 'SetDocumentAccessSettings', { input }).then((a) => {
      if (a.ok) reload();
      else setProblem(a.message);
    });
  };
  return (
    <Page title="Documents" back={back}>
      {d.hr ? null : <Alert tone="info">Only HR can change these.</Alert>}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      <Heading title="Document types" />
      <List>
        {d.types
          .filter((t) => !t.archived)
          .map((t) => (
            <ListItem
              key={t.key}
              description={`${t.confidential ? 'Confidential · ' : ''}${t.retentionWords} · ${String(t.used)} documents`}
              supporting={
                <View className="mt-1 flex-row gap-1.5">
                  {t.requiredFor === null ? null : (
                    <Badge tone="accent" size="sm">
                      Required
                    </Badge>
                  )}
                  {t.signers.length === 0 ? null : <Badge size="sm">Signature</Badge>}
                </View>
              }
            >
              {t.name}
            </ListItem>
          ))}
      </List>
      <Heading title="Access and sharing" />
      <List>
        {SWITCHES.map(([key, label]) => (
          <ListItem
            key={key}
            trailing={
              <Switch
                accessibilityLabel={label}
                checked={d.access[key] === true}
                disabled={!d.hr}
                onCheckedChange={(on) => {
                  save({ [key]: on });
                }}
              />
            }
          >
            {label}
          </ListItem>
        ))}
        <ListItem icon={Lock} description="Always on">
          Log every confidential view
        </ListItem>
      </List>
      <Heading title="Legal holds" />
      {d.holds.length === 0 ? (
        <Text tone="muted">No holds.</Text>
      ) : (
        <List>
          {d.holds.map((h) => (
            <ListItem
              key={h.id}
              icon={Archive}
              description={`${h.setBy} · ${String(h.count)} documents`}
              trailing={
                d.hr ? (
                  <Button
                    size="xs"
                    onPress={() =>
                      void askDocuments(signed, 'LiftLegalHold', { holdId: h.id }).then(reload)
                    }
                  >
                    Lift
                  </Button>
                ) : null
              }
            >
              {h.name}
            </ListItem>
          ))}
        </List>
      )}
      <Text variant="footnote" tone="muted">
        Deleted documents are kept for 30 days, then gone.
      </Text>
    </Page>
  );
}
