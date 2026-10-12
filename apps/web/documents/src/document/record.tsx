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
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { Read } from '../types';

/**
 * Filling a record from a document (G5, K9): what the document says beside
 * what the record holds, each with the page it came from. Nothing is written
 * until HR ticks it, and the record's own rules apply to what is: a value
 * that needs approving waits for it.
 */

export interface RecordRow {
  readonly key: string;
  readonly label: string;
  readonly current: string | null;
  readonly found: { readonly value: string; readonly page: number } | null;
}

export interface RecordData {
  readonly personId: string;
  readonly name: string;
  readonly rows: readonly RecordRow[];
}

export type Applied =
  | { readonly ok: true; readonly held?: readonly string[] | number }
  | { readonly ok: false; readonly message: string };

export interface RecordProps {
  readonly onReadRecord?: ((documentId: string) => Promise<Read<RecordData>>) | undefined;
  readonly onApplyRecord?:
    ((personId: string, changed: Readonly<Record<string, string>>) => Promise<Applied>) | undefined;
}

export function FillRecord({
  documentId,
  onReadRecord,
  onApplyRecord,
}: { readonly documentId: string } & RecordProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (onReadRecord === undefined || onApplyRecord === undefined) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        startIcon={<icons.assistant aria-hidden />}
        onClick={() => {
          setOpen(true);
        }}
      >
        Fill the record from it
      </Button>
      {open ? (
        <RecordDialog
          documentId={documentId}
          onReadRecord={onReadRecord}
          onApplyRecord={onApplyRecord}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function RecordDialog({
  documentId,
  onReadRecord,
  onApplyRecord,
  onClose,
}: {
  readonly documentId: string;
  readonly onReadRecord: NonNullable<RecordProps['onReadRecord']>;
  readonly onApplyRecord: NonNullable<RecordProps['onApplyRecord']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [data, setData] = useState<Read<RecordData> | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Applied | null>(null);
  useEffect(() => {
    let live = true;
    void onReadRecord(documentId).then((r) => {
      if (!live) return;
      setData(r);
      if (r.ok) {
        setTicked(
          new Set(
            r.data.rows
              .filter((x) => x.found !== null && x.found.value !== x.current)
              .map((x) => x.key),
          ),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [documentId, onReadRecord]);

  const rows = data?.ok === true ? data.data.rows.filter((r) => r.found !== null) : [];
  const apply = (): void => {
    if (data?.ok !== true) return;
    const changed = Object.fromEntries(
      rows.filter((r) => ticked.has(r.key)).map((r) => [r.key, r.found?.value ?? '']),
    );
    setBusy(true);
    void onApplyRecord(data.data.personId, changed).then((r) => {
      setBusy(false);
      setDone(r);
    });
  };
  const held = done?.ok === true ? done.held : undefined;
  const waiting = typeof held === 'number' ? held : (held?.length ?? 0);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent sheetOnTouch>
        <DialogHeader>
          <DialogTitle>
            {data?.ok === true ? `Fill ${data.data.name}’s record` : 'Fill the record'}
          </DialogTitle>
          <DialogDescription>
            Kithena read the document. Nothing is saved until you tick it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {data === null ? (
            <Spinner label="Kithena is reading the document" />
          ) : !data.ok ? (
            <Alert tone="danger">{data.message}</Alert>
          ) : rows.length === 0 ? (
            <p className="text-sm text-fg-muted">
              The document states none of the record’s fields.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <span className="sr-only">Save</span>
                  </TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Now</TableHead>
                  <TableHead>In the document</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Save ${r.label}`}
                        checked={ticked.has(r.key)}
                        disabled={done?.ok === true}
                        onCheckedChange={(v) => {
                          const next = new Set(ticked);
                          if (v === true) next.add(r.key);
                          else next.delete(r.key);
                          setTicked(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell>{r.current ?? '—'}</TableCell>
                    <TableCell>
                      {r.found?.value}{' '}
                      <Badge size="sm" tone="neutral">
                        {`p. ${String(r.found?.page ?? 0)}`}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {done === null ? null : done.ok ? (
            <Alert tone="success" title="Saved">
              {waiting === 0
                ? 'The record has the ticked values.'
                : `${String(waiting)} wait for approval before they show.`}
            </Alert>
          ) : (
            <Alert tone="danger">{done.message}</Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {done?.ok === true ? 'Close' : 'Cancel'}
          </Button>
          {done?.ok === true ? null : (
            <Button variant="primary" loading={busy} disabled={ticked.size === 0} onClick={apply}>
              {`Save ${String(ticked.size)}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
