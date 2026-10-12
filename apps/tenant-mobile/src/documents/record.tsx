import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListItem,
  Spinner,
  Text,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';

import { ask, formInputs, useSigned } from '../people/api';
import { askDocuments } from './api';

/**
 * Filling a record from a document on the phone (Documents MP3, K9): the
 * web's `document/record.tsx` with the phone's parts. People says which
 * fields this person may change and what they hold; Documents reads the
 * document for those names, each with its page; People's own save applies
 * what HR ticks, a value that needs approving waiting for it.
 */

const FILLABLE = new Set(['text', 'number', 'decimal', 'date', 'email', 'phone', 'url']);

interface Row {
  readonly key: string;
  readonly label: string;
  readonly current: string | null;
  readonly found: { readonly value: string; readonly page: number };
}

type Entry = { readonly key: string } & Readonly<Record<string, unknown>>;

/** People's fields this person may change, beside what the document says of each; or why not. */
async function readRows(
  signed: ReturnType<typeof useSigned>,
  documentId: string,
  personId: string,
): Promise<readonly Row[] | string> {
  const profile = await ask<{
    sections: readonly {
      fields: readonly { key: string; label: string; dataType: string; readOnly: boolean }[];
    }[];
    values: readonly Entry[];
  }>(signed, 'Profile', { personId });
  if (!profile.ok) return profile.message;
  const fields = profile.data.sections
    .flatMap((s) => s.fields)
    .filter((f) => !f.readOnly && FILLABLE.has(f.dataType))
    .slice(0, 40);
  const read = await askDocuments<{
    fields: readonly { name: string; value: string; page: number }[];
  }>(signed, 'ReadDocumentFields', {
    documentId,
    input: { names: fields.map((f) => f.label) },
  });
  if (!read.ok) return read.message;
  const values = new Map(profile.data.values.map((v) => [v.key, v]));
  const found = new Map(read.data.fields.map((f) => [f.name, f]));
  return fields.flatMap((f): Row[] => {
    const hit = found.get(f.label);
    const text = values.get(f.key)?.['text'];
    return hit === undefined
      ? []
      : [
          {
            key: f.key,
            label: f.label,
            current: typeof text === 'string' ? text : null,
            found: { value: hit.value, page: hit.page },
          },
        ];
  });
}

export function FillRecord({
  documentId,
  personId,
  name,
  onClose,
}: {
  readonly documentId: string;
  readonly personId: string;
  readonly name: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [rows, setRows] = useState<readonly Row[] | string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readRows(signed, documentId, personId).then((list) => {
      if (!live) return;
      setRows(list);
      if (typeof list !== 'string') {
        setTicked(new Set(list.filter((r) => r.found.value !== r.current).map((r) => r.key)));
      }
    });
    return () => {
      live = false;
    };
  }, [signed, documentId, personId]);

  const save = async (): Promise<void> => {
    if (typeof rows !== 'object' || rows === null) return;
    setSaving(true);
    const changed = Object.fromEntries(
      rows.filter((r) => ticked.has(r.key)).map((r) => [r.key, r.found.value]),
    );
    const answer = await ask<{ held: readonly string[] | null }>(signed, 'SavePersonSection', {
      personId,
      changed: formInputs(changed),
    });
    setSaving(false);
    const waiting = answer.ok ? (answer.data.held ?? []).length : 0;
    setDone(
      !answer.ok
        ? answer.message
        : waiting === 0
          ? 'Saved.'
          : `Saved. ${String(waiting)} wait for approval before they show.`,
    );
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
          <DialogTitle>{`Fill ${name}’s record`}</DialogTitle>
          <DialogDescription>Nothing is saved until you tick it.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {rows === null ? (
            <Spinner label="Kithena is reading the document" />
          ) : typeof rows === 'string' ? (
            <Alert tone="danger">{rows}</Alert>
          ) : rows.length === 0 ? (
            <Text tone="muted">The document states none of the record’s fields.</Text>
          ) : (
            rows.map((r) => (
              <ListItem
                key={r.key}
                description={`Now: ${r.current ?? '—'}`}
                supporting={
                  <Badge size="sm" tone="neutral">
                    {`${r.found.value} · p. ${String(r.found.page)}`}
                  </Badge>
                }
                trailing={
                  <Checkbox
                    accessibilityLabel={`Save ${r.label}`}
                    checked={ticked.has(r.key)}
                    disabled={done !== null}
                    onCheckedChange={(on) => {
                      const next = new Set(ticked);
                      if (on) next.add(r.key);
                      else next.delete(r.key);
                      setTicked(next);
                    }}
                  />
                }
              >
                {r.label}
              </ListItem>
            ))
          )}
          {done === null ? null : <Text>{done}</Text>}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {done === null ? 'Cancel' : 'Close'}
          </Button>
          {done === null ? (
            <Button
              className="flex-1"
              variant="primary"
              loading={saving}
              disabled={ticked.size === 0}
              onPress={() => void save()}
            >
              {`Save ${String(ticked.size)}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
