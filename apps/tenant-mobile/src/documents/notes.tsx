import { Alert, Button, Icon, List, ListItem, Text } from '@reach/ui-native';
import { FileText, ScanLine, Upload } from 'lucide-react-native';
import { useContext, useState } from 'react';
import { View } from 'react-native';

import { ask, useSigned } from '../people/api';
import { askDocuments, chooseFile, DocumentsOn, putFile, scan, type Picked } from './api';
import { t } from '../i18n';

/**
 * A Time Off request missing its note, on the phone (Documents MJ3, MJ4): a
 * sick note or a file already in Documents first, so nobody uploads twice,
 * or one scanned now and filed as the person's sick note. Time Off learns
 * the document's id and says only that a note arrived. Without Documents the
 * request only says a note is needed.
 */

interface Row {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly typeKey: string | null;
  readonly mediaType: string | null;
  readonly mine: boolean;
  readonly aboutMe: boolean;
  readonly deletedAt: string | null;
}

const NOTE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export function NoteNeeded({
  requestId,
  personId,
  onDone,
}: {
  readonly requestId: string;
  /** Whose request it is: the viewer's own, or one HR files a photo for (MH4). */
  readonly personId: string | undefined;
  readonly onDone: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const documents = useContext(DocumentsOn);
  const [files, setFiles] = useState<readonly Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const attach = async (fileId: string): Promise<void> => {
    const done = await ask(
      signed,
      'AttachTimeOffNote',
      { requestId, input: { fileId } },
      'timeoff',
    );
    setBusy(null);
    if (done.ok) onDone();
    else setProblem(done.message);
  };
  const open = (): void => {
    setBusy('list');
    void (async () => {
      const library = await askDocuments<{
        viewer: { personId: string | null };
        rows: readonly Row[];
      }>(signed, 'DocumentsLibrary', { show: 'all' });
      const own =
        !library.ok || personId === undefined || library.data.viewer.personId === personId;
      const file = own
        ? null
        : await askDocuments<{ rows: readonly Row[] }>(signed, 'DocumentsPersonFile', {
            personId,
          });
      const rows = own
        ? library.ok
          ? library.data.rows
          : []
        : file?.ok === true
          ? file.data.rows
          : [];
      setBusy(null);
      setFiles(
        rows.filter(
          (r) =>
            r.deletedAt === null &&
            (own ? r.mine || r.aboutMe : true) &&
            (r.kind === 'Medical' ||
              (own && r.typeKey === null && NOTE_TYPES.has(r.mediaType ?? ''))),
        ),
      );
    })();
  };
  const fileNew = async (how: 'scan' | 'file'): Promise<void> => {
    const picked: Picked | null = how === 'scan' ? await scan() : await chooseFile();
    if (picked === null) return;
    setBusy(how);
    setProblem(null);
    const library = await askDocuments<{ viewer: { personId: string | null } }>(
      signed,
      'DocumentsLibrary',
      { show: 'all' },
    );
    const put = await putFile(signed, picked);
    if (!library.ok || !put.ok) {
      setBusy(null);
      setProblem(
        put.ok
          ? t('documents.notes.documents_did_not_answer', 'Documents did not answer.')
          : put.message,
      );
      return;
    }
    const filed = await askDocuments<{ id: string }>(signed, 'UploadDocument', {
      input: {
        title: t('documents.notes.sick_note', 'Sick note'),
        typeKey: 'sick_note',
        subjectPersonId: personId ?? library.data.viewer.personId,
        upload: put.data,
      },
    });
    if (!filed.ok) {
      setBusy(null);
      setProblem(filed.message);
      return;
    }
    await attach(filed.data.id);
  };

  return (
    <Alert tone="warning" title={t('documents.notes.a_note_is_needed', 'A note is needed')}>
      <View className="gap-2.5">
        <Text>
          {t(
            'documents.notes.leave_this_long_needs_a_doctors',
            'Leave this long needs a doctor’s note. Only its person and HR see it.',
          )}
        </Text>
        {!documents ? null : files === null ? (
          <Button size="sm" loading={busy === 'list'} onPress={open}>
            {t('documents.notes.add_note', 'Add note')}
          </Button>
        ) : (
          <>
            {files.length === 0 ? null : (
              <List>
                {files.map((f) => (
                  <ListItem
                    key={f.id}
                    icon={FileText}
                    description={
                      f.kind === 'Medical'
                        ? t('documents.notes.sick_note', 'Sick note')
                        : t('documents.notes.your_document', 'Your document')
                    }
                    trailing={
                      <Button
                        size="xs"
                        variant="primary"
                        loading={busy === f.id}
                        onPress={() => {
                          setBusy(f.id);
                          setProblem(null);
                          void attach(f.id);
                        }}
                      >
                        {t('documents.notes.attach', 'Attach')}
                      </Button>
                    }
                  >
                    {f.title}
                  </ListItem>
                ))}
              </List>
            )}
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                startIcon={<Icon icon={ScanLine} />}
                loading={busy === 'scan'}
                onPress={() => void fileNew('scan')}
              >
                {t('documents.notes.scan_it', 'Scan it')}
              </Button>
              <Button
                className="flex-1"
                startIcon={<Icon icon={Upload} />}
                loading={busy === 'file'}
                onPress={() => void fileNew('file')}
              >
                {t('documents.notes.choose_a_file', 'Choose a file')}
              </Button>
            </View>
          </>
        )}
        {problem === null ? null : <Text tone="danger">{problem}</Text>}
      </View>
    </Alert>
  );
}
