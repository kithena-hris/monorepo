import {
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  ListItem,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Text,
  Textarea,
  useToast,
} from '@reach/ui-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { FileText, Send } from 'lucide-react-native';
import { View } from 'react-native';
import { useEffect, useState } from 'react';

import { useAct } from '../people/act';
import { ask, useSigned } from '../people/api';
import { blobOf, shareBase64 } from '../people/media';
import type { PeopleRoutes } from '../people/routes';
import { t as tr } from '../i18n';

/**
 * What HR starts from somebody's profile on the phone (H2, H3) and the
 * person's Documents: the web profile's, the same operations.
 */

const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** H2: ask them for these details, as one task in their Inbox. */
export function AskDialog({
  personId,
  name,
  fields,
  onClose,
}: {
  personId: string;
  name: string;
  fields: readonly { readonly key: string; readonly label: string }[];
  onClose: () => void;
}): React.JSX.Element {
  const first = name.split(' ')[0] ?? name;
  const { act, busy } = useAct();
  const [keys, setKeys] = useState<readonly string[]>(fields.map((f) => f.key));
  const [message, setMessage] = useState('');
  const [due, setDue] = useState<string | null>(inDays(7));
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('inbox.profile-asks.ask_for_details', 'Ask {{first}} for details', { first })}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'inbox.profile-asks.gets_one_task_and_fills_it',
              '{{first}} gets one task and fills it in from the Inbox.',
              { first },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {fields.map((f) => (
            <Checkbox
              key={f.key}
              checked={keys.includes(f.key)}
              onCheckedChange={(on) => {
                setKeys((was) => (on ? [...was, f.key] : was.filter((k) => k !== f.key)));
              }}
            >
              {f.label}
            </Checkbox>
          ))}
          <Textarea
            value={message}
            onChange={setMessage}
            placeholder={tr('inbox.profile-asks.your_words_to', 'Your words to {{first}}', {
              first,
            })}
            accessibilityLabel={tr('inbox.profile-asks.message', 'Message')}
          />
          <DatePicker label={tr('inbox.profile-asks.due', 'Due')} value={due} onChange={setDue} />
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>{tr('inbox.profile-asks.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<Icon icon={Send} />}
            disabled={keys.length === 0}
            loading={busy === 'AskForDetails'}
            onPress={() => {
              void act(
                'AskForDetails',
                {
                  personIds: [personId],
                  keys,
                  message: message.trim() === '' ? null : message.trim(),
                  dueOn: due,
                },
                `${first} has a task in their Inbox`,
              ).then((done) => {
                if (done !== null) onClose();
              });
            }}
          >
            {tr('inbox.profile-asks.send_to', 'Send to {{first}}', { first })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** H3: send a document; the sender decides whether it is a task or an update. */
export function SendDocumentDialog({
  personId,
  name,
  onClose,
}: {
  personId: string;
  name: string;
  onClose: () => void;
}): React.JSX.Element {
  const first = name.split(' ')[0] ?? name;
  const signed = useSigned();
  const { toast } = useToast();
  const [file, setFile] = useState<{ uri: string; name: string } | null>(null);
  const [mode, setMode] = useState<'keep' | 'acknowledge' | 'sign'>('sign');
  const [message, setMessage] = useState('');
  const [due, setDue] = useState<string | null>(inDays(7));
  const [countersign, setCountersign] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    if (file === null) return;
    setBusy(true);
    const body = await blobOf(file.uri);
    const target = await ask<string>(signed, 'StartDocumentUpload', {
      personId,
      name: file.name.slice(0, 255),
      size: body.size,
    });
    if (!target.ok) {
      setBusy(false);
      toast({
        title: tr('inbox.profile-asks.not_sent', 'Not sent'),
        description: target.message,
        tone: 'danger',
      });
      return;
    }
    const t = JSON.parse(target.data) as {
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    };
    const headers = Object.fromEntries(
      Object.entries(t.headers).filter(([k]) => k !== 'content-length'),
    );
    const put = await fetch(t.url, { method: 'PUT', headers, body }).catch(() => null);
    if (put?.ok !== true) {
      setBusy(false);
      toast({
        title: tr('inbox.profile-asks.not_sent', 'Not sent'),
        description: 'The upload did not go through; try again.',
        tone: 'danger',
      });
      return;
    }
    const sent = await ask(signed, 'SendDocument', {
      personId,
      uploadId: t.uploadId,
      mode,
      message: message.trim() === '' ? null : message.trim(),
      dueOn: mode === 'keep' ? null : due,
      countersign: mode === 'sign' && countersign,
    });
    setBusy(false);
    if (!sent.ok) {
      toast({
        title: tr('inbox.profile-asks.not_sent', 'Not sent'),
        description: sent.message,
        tone: 'danger',
      });
      return;
    }
    toast({
      title: tr('inbox.profile-asks.sent_to', 'Sent to {{first}}', { first }),
      tone: 'success',
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('inbox.profile-asks.send_a_document_to', 'Send a document to {{first}}', { first })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Button
            startIcon={<Icon icon={FileText} />}
            onPress={() => {
              void DocumentPicker.getDocumentAsync({
                type: ['application/pdf', 'image/png', 'image/jpeg'],
                copyToCacheDirectory: true,
              }).then((picked) => {
                const asset = picked.canceled ? undefined : picked.assets[0];
                if (asset !== undefined) setFile({ uri: asset.uri, name: asset.name });
              });
            }}
          >
            {file === null
              ? tr('inbox.profile-asks.choose_the_document', 'Choose the document')
              : file.name}
          </Button>
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              if (v === 'keep' || v === 'acknowledge' || v === 'sign') setMode(v);
            }}
          >
            <RadioGroupItem
              value="keep"
              description={tr(
                'inbox.profile-asks.filed_in_their_profile_they_get',
                'Filed in their profile. They get an update.',
              )}
            >
              {tr('inbox.profile-asks.just_keep_it', 'Just keep it')}
            </RadioGroupItem>
            <RadioGroupItem
              value="acknowledge"
              description={tr(
                'inbox.profile-asks.they_confirm_theyve_read_it_a',
                'They confirm they’ve read it. A task.',
              )}
            >
              {tr('inbox.profile-asks.read_and_acknowledge', 'Read and acknowledge')}
            </RadioGroupItem>
            <RadioGroupItem value="sign" description="They sign; then you countersign. A task.">
              {tr('inbox.profile-asks.sign_it', 'Sign it')}
            </RadioGroupItem>
          </RadioGroup>
          <Textarea
            value={message}
            onChange={setMessage}
            placeholder={tr('inbox.profile-asks.message', 'Message')}
            accessibilityLabel={tr('inbox.profile-asks.message', 'Message')}
          />
          {mode === 'keep' ? null : (
            <DatePicker label={tr('inbox.profile-asks.due', 'Due')} value={due} onChange={setDue} />
          )}
          {mode === 'sign' ? (
            <Switch checked={countersign} onCheckedChange={setCountersign}>
              {tr('inbox.profile-asks.i_countersign_it_after_them', 'I countersign it after them')}
            </Switch>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>{tr('inbox.profile-asks.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<Icon icon={Send} />}
            disabled={file === null}
            loading={busy}
            onPress={() => {
              void send();
            }}
          >
            {tr('inbox.profile-asks.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Doc {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly sentAt: string;
  readonly signature: { readonly name: string } | null;
}

const STATE = (): Readonly<Record<string, string>> => ({
  open: tr('inbox.profile-asks.waiting', 'Waiting'),
  kept: tr('inbox.profile-asks.kept', 'Kept'),
  acknowledged: tr('inbox.profile-asks.acknowledged', 'Acknowledged'),
  signed: tr('inbox.profile-asks.signed', 'Signed'),
  countersigned: tr('inbox.profile-asks.signed_by_both', 'Signed by both'),
  declined: tr('inbox.profile-asks.sent_back', 'Sent back'),
});

/** A row of the Document center's file for the person (Documents MP4). */
interface Filed {
  readonly id: string;
  readonly title: string;
  readonly typeName: string | null;
  readonly deletedAt: string | null;
  readonly status: { readonly label: string } | null;
}

/** Documents' file for this person, or nothing: no Documents, or a viewer it refuses. */
async function filedFor(
  signed: ReturnType<typeof useSigned>,
  personId: string | null,
): Promise<readonly Filed[]> {
  let id = personId;
  if (id === null) {
    const library = await ask<{ viewer: { personId: string | null } }>(
      signed,
      'DocumentsLibrary',
      {},
      'documents',
    );
    if (!library.ok || library.data.viewer.personId === null) return [];
    id = library.data.viewer.personId;
  }
  const file = await ask<{ rows: readonly Filed[] }>(
    signed,
    'DocumentsPersonFile',
    { personId: id },
    'documents',
  );
  return file.ok ? file.data.rows.filter((r) => r.deletedAt === null) : [];
}

/** The person's Documents (D2, F1), each opened in the phone's viewer. */
export function Documents({
  personId,
  onAdd,
}: {
  personId: string | null;
  /** HR's way to send one: "Send" beside the title. */
  onAdd?: () => void;
}): React.JSX.Element | null {
  const signed = useSigned();
  const navigation = useNavigation<NativeStackNavigationProp<PeopleRoutes>>();
  const { toast } = useToast();
  const [docs, setDocs] = useState<readonly Doc[] | null>(null);
  const [filed, setFiled] = useState<readonly Filed[]>([]);
  useEffect(() => {
    let live = true;
    void ask<string>(signed, 'PeopleDocuments', { personId }).then((a) => {
      if (live && a.ok) setDocs(JSON.parse(a.data) as Doc[]);
    });
    void filedFor(signed, personId).then((rows) => {
      if (live) setFiled(rows);
    });
    return () => {
      live = false;
    };
  }, [signed, personId]);
  if (docs === null || (docs.length === 0 && filed.length === 0 && onAdd === undefined)) {
    return null;
  }
  const open = (d: Doc): void => {
    void ask<string>(signed, 'PeopleDocumentFile', { id: d.id }).then(async (a) => {
      if (!a.ok) {
        toast({
          title: tr('inbox.profile-asks.that_did_not_open', 'That did not open'),
          description: a.message,
          tone: 'danger',
        });
        return;
      }
      const f = JSON.parse(a.data) as { name: string; mediaType: string; data: string };
      await shareBase64(f.data, f.name, f.mediaType);
    });
  };
  return (
    // One card per section (design v3 P12): the title and its one action, then the rows.
    <Card padded={false} className="overflow-hidden">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
        <Text variant="headline">{tr('inbox.profile-asks.documents', 'Documents')}</Text>
        {onAdd === undefined ? null : (
          <Button size="xs" variant="link" onPress={onAdd}>
            {tr('inbox.profile-asks.send', 'Send')}
          </Button>
        )}
      </View>
      {filed.map((f) => (
        <ListItem
          key={f.id}
          listitem={false}
          icon={FileText}
          description={f.status?.label ?? f.typeName ?? tr('inbox.profile-asks.filed', 'Filed')}
          chevron
          accessibilityLabel={tr('inbox.profile-asks.open', 'Open {{title}}', { title: f.title })}
          onPress={() => {
            navigation.navigate('DocumentDetail', { id: f.id, title: f.title });
          }}
        >
          {f.title}
        </ListItem>
      ))}
      {docs.length === 0 ? (
        filed.length > 0 ? null : (
          <Text tone="muted" className="px-4 pb-4">
            {tr('inbox.profile-asks.nothing_sent_yet', 'Nothing sent yet.')}
          </Text>
        )
      ) : (
        docs.map((d) => {
          const waiting = d.state === 'open';
          return (
            <ListItem
              key={d.id}
              listitem={false}
              icon={FileText}
              description={
                d.signature === null
                  ? (STATE()[d.state] ?? d.state)
                  : tr('inbox.profile-asks.signed_by', 'Signed by {{name}}', {
                      name: d.signature.name,
                    })
              }
              {...(waiting
                ? {
                    trailing: (
                      <Badge size="sm" tone="warning">
                        {tr('inbox.profile-asks.to_sign', 'To sign')}
                      </Badge>
                    ),
                  }
                : { chevron: true })}
              accessibilityLabel={tr('inbox.profile-asks.open_2', 'Open {{name}}', {
                name: d.name,
              })}
              onPress={() => {
                open(d);
              }}
            >
              {d.name}
            </ListItem>
          );
        })
      )}
    </Card>
  );
}
