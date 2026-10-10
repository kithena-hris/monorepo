import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  List,
  ListItem,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Textarea,
  useToast,
} from '@reach/ui-native';
import * as DocumentPicker from 'expo-document-picker';
import { Download, FileText, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';

import { useAct } from '../people/act';
import { ask, useSigned } from '../people/api';
import { blobOf, shareBase64 } from '../people/media';

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
          <DialogTitle>{`Ask ${first} for details`}</DialogTitle>
          <DialogDescription>{`${first} gets one task and fills it in from the Inbox.`}</DialogDescription>
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
            placeholder={`Your words to ${first}`}
            accessibilityLabel="Message"
          />
          <DatePicker label="Due" value={due} onChange={setDue} />
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>Cancel</Button>
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
            {`Send to ${first}`}
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
      toast({ title: 'Not sent', description: target.message, tone: 'danger' });
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
        title: 'Not sent',
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
      toast({ title: 'Not sent', description: sent.message, tone: 'danger' });
      return;
    }
    toast({ title: `Sent to ${first}`, tone: 'success' });
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
          <DialogTitle>{`Send a document to ${first}`}</DialogTitle>
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
            {file === null ? 'Choose the document' : file.name}
          </Button>
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              if (v === 'keep' || v === 'acknowledge' || v === 'sign') setMode(v);
            }}
          >
            <RadioGroupItem value="keep" description="Filed in their profile. They get an update.">
              Just keep it
            </RadioGroupItem>
            <RadioGroupItem value="acknowledge" description="They confirm they’ve read it. A task.">
              Read and acknowledge
            </RadioGroupItem>
            <RadioGroupItem value="sign" description="They sign; then you countersign. A task.">
              Sign it
            </RadioGroupItem>
          </RadioGroup>
          <Textarea
            value={message}
            onChange={setMessage}
            placeholder="Message"
            accessibilityLabel="Message"
          />
          {mode === 'keep' ? null : <DatePicker label="Due" value={due} onChange={setDue} />}
          {mode === 'sign' ? (
            <Switch checked={countersign} onCheckedChange={setCountersign}>
              I countersign it after them
            </Switch>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<Icon icon={Send} />}
            disabled={file === null}
            loading={busy}
            onPress={() => {
              void send();
            }}
          >
            Send
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

const STATE: Readonly<Record<string, string>> = {
  open: 'Waiting',
  kept: 'Kept',
  acknowledged: 'Acknowledged',
  signed: 'Signed',
  countersigned: 'Signed by both',
  declined: 'Sent back',
};

/** The person's Documents (D2, F1), each opened in the phone's viewer. */
export function Documents({ personId }: { personId: string | null }): React.JSX.Element | null {
  const signed = useSigned();
  const { toast } = useToast();
  const [docs, setDocs] = useState<readonly Doc[] | null>(null);
  useEffect(() => {
    let live = true;
    void ask<string>(signed, 'PeopleDocuments', { personId }).then((a) => {
      if (live && a.ok) setDocs(JSON.parse(a.data) as Doc[]);
    });
    return () => {
      live = false;
    };
  }, [signed, personId]);
  if (docs === null || docs.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <List>
          {docs.map((d) => (
            <ListItem
              key={d.id}
              icon={FileText}
              description={[
                STATE[d.state] ?? d.state,
                d.signature === null ? d.sentAt.slice(0, 10) : `by ${d.signature.name}`,
              ].join(' · ')}
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  accessibilityLabel={`Open ${d.name}`}
                  startIcon={<Icon icon={Download} />}
                  onPress={() => {
                    void ask<string>(signed, 'PeopleDocumentFile', { id: d.id }).then(async (a) => {
                      if (!a.ok) {
                        toast({
                          title: 'That did not open',
                          description: a.message,
                          tone: 'danger',
                        });
                        return;
                      }
                      const f = JSON.parse(a.data) as {
                        name: string;
                        mediaType: string;
                        data: string;
                      };
                      await shareBase64(f.data, f.name, f.mediaType);
                    });
                  }}
                />
              }
            >
              {d.name}
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}
