import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useWrite } from '../shared';
import type { PersonRef, Read, Row } from '../types';

/**
 * Letters from a template (G3): pick the people and a Template document,
 * check one letter as it will read, then each is filled from that person's
 * record, filed to their documents and, when asked, sent to them to sign.
 */

export interface LettersPreview {
  readonly preview: string;
  readonly missing: readonly { readonly personId: string; readonly fields: readonly string[] }[];
}

export interface LettersProps {
  readonly onPreviewLetters?:
    | ((templateId: string, personIds: readonly string[]) => Promise<Read<LettersPreview>>)
    | undefined;
  readonly onGenerateLetters?:
    | ((
        templateId: string,
        title: string,
        personIds: readonly string[],
        sign: boolean,
      ) => Promise<Read<{ readonly ids: readonly string[] }>>)
    | undefined;
}

export function LettersDialog({
  open,
  onOpenChange,
  templates,
  people,
  onPreviewLetters,
  onGenerateLetters,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly templates: readonly Row[];
  readonly people: readonly PersonRef[];
  readonly onDone: (count: number) => void;
} & LettersProps): JSX.Element {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [title, setTitle] = useState(templates[0]?.title ?? '');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [q, setQ] = useState('');
  const [sign, setSign] = useState(false);
  const [preview, setPreview] = useState<LettersPreview | null>(null);
  const write = useWrite();
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const name = (id: string) => people.find((p) => p.personId === id)?.name ?? 'Someone';
  const ids = [...chosen];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheetOnTouch>
        <DialogHeader>
          <DialogTitle>Generate letters</DialogTitle>
          <DialogDescription>
            Each is filled from the person’s record and filed to their documents.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {templates.length === 0 ? (
            <Alert tone="info">
              Add a document of the Template type first: its text with fields in double braces, such
              as {'{{Preferred name}}'}.
            </Alert>
          ) : (
            <>
              <Field>
                <FieldLabel>Template</FieldLabel>
                <Select
                  value={templateId}
                  onValueChange={(v) => {
                    setTemplateId(v);
                    setTitle(templates.find((t) => t.id === v)?.title ?? title);
                    setPreview(null);
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field required>
                <FieldLabel>Each letter’s name</FieldLabel>
                <FieldControl>
                  <Input
                    value={title}
                    maxLength={200}
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{`People · ${String(chosen.size)} chosen`}</FieldLabel>
                <FieldControl>
                  <Input
                    value={q}
                    placeholder="Find someone"
                    onChange={(e) => {
                      setQ(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <List aria-label="People" className="max-h-56 overflow-y-auto">
                {shown.slice(0, 50).map((p) => (
                  <ListItem
                    key={p.personId}
                    description={p.teamName ?? undefined}
                    leading={
                      <Checkbox
                        aria-label={`Write to ${p.name}`}
                        checked={chosen.has(p.personId)}
                        onCheckedChange={(v) => {
                          const next = new Set(chosen);
                          if (v === true) next.add(p.personId);
                          else next.delete(p.personId);
                          setChosen(next);
                          setPreview(null);
                        }}
                      />
                    }
                  >
                    {p.name}
                  </ListItem>
                ))}
              </List>
              <Field orientation="horizontal">
                <FieldControl>
                  <Checkbox
                    checked={sign}
                    onCheckedChange={(v) => {
                      setSign(v === true);
                    }}
                  />
                </FieldControl>
                <FieldLabel>Send each to its person to sign</FieldLabel>
              </Field>
              {preview === null ? null : (
                <>
                  <Card variant="fill" padded>
                    <p className="text-sm whitespace-pre-wrap">{preview.preview}</p>
                  </Card>
                  {preview.missing.length === 0 ? null : (
                    <Alert tone="warning" title="Not every record fills the letter">
                      {preview.missing
                        .map((m) => `${name(m.personId)}: ${m.fields.join(', ')}`)
                        .join(' · ')}
                    </Alert>
                  )}
                </>
              )}
            </>
          )}
          {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={templateId === '' || chosen.size === 0}
            loading={write.pending && preview === null}
            onClick={() => {
              if (onPreviewLetters === undefined) return;
              write.run(async () => {
                const r = await onPreviewLetters(templateId, ids);
                if (!r.ok) return r;
                setPreview(r.data);
                return { ok: true };
              });
            }}
          >
            Preview
          </Button>
          <Button
            variant="primary"
            disabled={
              preview === null ||
              preview.missing.length > 0 ||
              title.trim() === '' ||
              chosen.size === 0
            }
            loading={write.pending && preview !== null}
            onClick={() => {
              if (onGenerateLetters === undefined) return;
              write.run(async () => {
                const r = await onGenerateLetters(templateId, title.trim(), ids, sign);
                if (!r.ok) return r;
                onDone(r.data.ids.length);
                onOpenChange(false);
                return { ok: true };
              });
            }}
          >
            {`Generate ${String(chosen.size)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
