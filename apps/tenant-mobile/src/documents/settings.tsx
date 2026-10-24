import { Alert, Badge, Button, List, ListItem, Switch, Text } from '@reach/ui-native';
import { Archive, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askDocuments, useDocuments } from './api';
import { t as tr } from '../i18n';

/**
 * Settings › Documents on the phone (MS1–MS3, MS5, MS6): the types as one
 * line each, the access switches, Kithena's reading (MS7), retention and
 * legal holds. HR changes the
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
  readonly ai: Readonly<Record<string, boolean>>;
  readonly hr: boolean;
}

/** MS7: what Kithena may do with the company's documents. */
const READING = (): readonly (readonly [string, string])[] => [
  ['summaries', tr('documents.settings.summaries', 'Summaries')],
  ['questions', tr('documents.settings.questions_about_a_document', 'Questions about a document')],
  ['across', tr('documents.settings.questions_across_documents', 'Questions across documents')],
  ['sorting', tr('documents.settings.sort_uploads', 'Sort uploads')],
  ['fields', tr('documents.settings.read_fields_into_people', 'Read fields into People')],
  ['photos', tr('documents.settings.read_photos_and_scans', 'Read photos and scans')],
];

const SWITCHES = (): readonly (readonly [string, string])[] => [
  [
    'askAfterUpload',
    tr(
      'documents.settings.ask_once_after_an_upload_whether',
      'Ask once after an upload whether to share',
    ),
  ],
  [
    'peopleMayTurnOffQuestion',
    tr('documents.settings.people_can_turn_the_question_off', 'People can turn the question off'),
  ],
  [
    'watermark',
    tr('documents.settings.watermark_confidential_documents', 'Watermark confidential documents'),
  ],
  ['blockDownload', tr('documents.settings.block_download_and_print', 'Block download and print')],
  [
    'personalSections',
    tr(
      'documents.settings.everyone_can_create_personal_sections',
      'Everyone can create personal sections',
    ),
  ],
];

export function DocumentsSettings({
  navigation,
}: PeopleScreen<'DocumentsSettings'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useDocuments<SettingsData>('DocumentsSettings');
  const [problem, setProblem] = useState<string | null>(null);
  const back = { label: tr('documents.settings.settings', 'Settings'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={tr('documents.settings.documents', 'Documents')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('documents.settings.loading_the_settings', 'Loading the settings')} />
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
    <Page title={tr('documents.settings.documents', 'Documents')} back={back}>
      {d.hr ? null : (
        <Alert tone="info">
          {tr('documents.settings.only_hr_can_change_these', 'Only HR can change these.')}
        </Alert>
      )}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      <Heading title={tr('documents.settings.document_types', 'Document types')} />
      <List>
        {d.types
          .filter((t) => !t.archived)
          .map((t) => (
            <ListItem
              key={t.key}
              description={tr(
                'documents.settings.documents_2',
                '{{value}}{{retentionWords}} · {{String}} documents',
                {
                  value: t.confidential ? 'Confidential · ' : '',
                  retentionWords: t.retentionWords,
                  String: String(t.used),
                },
              )}
              supporting={
                <View className="mt-1 flex-row gap-1.5">
                  {t.requiredFor === null ? null : (
                    <Badge tone="accent" size="sm">
                      {tr('documents.settings.required', 'Required')}
                    </Badge>
                  )}
                  {t.signers.length === 0 ? null : (
                    <Badge size="sm">{tr('documents.settings.signature', 'Signature')}</Badge>
                  )}
                </View>
              }
            >
              {t.name}
            </ListItem>
          ))}
      </List>
      <Heading title={tr('documents.settings.access_and_sharing', 'Access and sharing')} />
      <List>
        {SWITCHES().map(([key, label]) => (
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
        <ListItem icon={Lock} description={tr('documents.settings.always_on', 'Always on')}>
          {tr('documents.settings.log_every_confidential_view', 'Log every confidential view')}
        </ListItem>
      </List>
      <Heading title={tr('documents.settings.kithena_reading', 'Kithena reading')} />
      <List>
        {READING().map(([key, label]) => (
          <ListItem
            key={key}
            trailing={
              <Switch
                accessibilityLabel={label}
                checked={d.ai[key] === true}
                disabled={!d.hr}
                onCheckedChange={(on) => {
                  void askDocuments(signed, 'SetDocumentsAiSettings', {
                    input: { [key]: on },
                  }).then((a) => {
                    if (a.ok) reload();
                    else setProblem(a.message);
                  });
                }}
              />
            }
          >
            {label}
          </ListItem>
        ))}
      </List>
      <Text variant="footnote" tone="muted">
        {tr(
          'documents.settings.medical_documents_are_only_ever_read',
          'Medical documents are only ever read for their dates.',
        )}
      </Text>
      <Heading title={tr('documents.settings.legal_holds', 'Legal holds')} />
      {d.holds.length === 0 ? (
        <Text tone="muted">{tr('documents.settings.no_holds', 'No holds.')}</Text>
      ) : (
        <List>
          {d.holds.map((h) => (
            <ListItem
              key={h.id}
              icon={Archive}
              description={tr(
                'documents.settings.documents_3',
                '{{setBy}} · {{String}} documents',
                { setBy: h.setBy, String: String(h.count) },
              )}
              trailing={
                d.hr ? (
                  <Button
                    size="xs"
                    onPress={() =>
                      void askDocuments(signed, 'LiftLegalHold', { holdId: h.id }).then(reload)
                    }
                  >
                    {tr('documents.settings.lift', 'Lift')}
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
        {tr(
          'documents.settings.deleted_documents_are_kept_for_30',
          'Deleted documents are kept for 30 days, then gone.',
        )}
      </Text>
    </Page>
  );
}
