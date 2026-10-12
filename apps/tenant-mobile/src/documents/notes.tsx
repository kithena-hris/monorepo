import { Alert, Button, Icon, List, ListItem, Text } from '@reach/ui-native';
import { FileText, ScanLine, Upload } from 'lucide-react-native';
import { useContext, useState } from 'react';
import { View } from 'react-native';

import { ask, useSigned } from '../people/api';
import { askDocuments, chooseFile, DocumentsOn, putFile, scan, type Picked } from './api';

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
  onDone,
}: {
  readonly requestId: string;
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
    void askDocuments<{ rows: readonly Row[] }>(signed, 'DocumentsLibrary', {
      show: 'all',
    }).then((a) => {
      setBusy(null);
      setFiles(
        a.ok
          ? a.data.rows.filter(
              (r) =>
                r.deletedAt === null &&
                (r.mine || r.aboutMe) &&
                (r.kind === 'Medical' || (r.typeKey === null && NOTE_TYPES.has(r.mediaType ?? ''))),
            )
          : [],
      );
    });
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
      setProblem(put.ok ? 'Documents did not answer.' : put.message);
      return;
    }
    const filed = await askDocuments<{ id: string }>(signed, 'UploadDocument', {
      input: {
        title: 'Sick note',
        typeKey: 'sick_note',
        subjectPersonId: library.data.viewer.personId,
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
    <Alert tone="warning" title="A note is needed">
      <View className="gap-2.5">
        <Text>Leave this long needs a doctor’s note. Only you and HR see it.</Text>
        {!documents ? null : files === null ? (
          <Button size="sm" loading={busy === 'list'} onPress={open}>
            Add note
          </Button>
        ) : (
          <>
            {files.length === 0 ? null : (
              <List>
                {files.map((f) => (
                  <ListItem
                    key={f.id}
                    icon={FileText}
                    description={f.kind === 'Medical' ? 'Sick note' : 'Your document'}
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
                        Attach
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
                Scan it
              </Button>
              <Button
                className="flex-1"
                startIcon={<Icon icon={Upload} />}
                loading={busy === 'file'}
                onPress={() => void fileNew('file')}
              >
                Choose a file
              </Button>
            </View>
          </>
        )}
        {problem === null ? null : <Text tone="danger">{problem}</Text>}
      </View>
    </Alert>
  );
}
