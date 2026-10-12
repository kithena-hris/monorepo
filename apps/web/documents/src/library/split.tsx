import {
  Alert,
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropzone,
  Input,
  NumberField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { putFile, useWrite } from '../shared';
import type { FileRef, Outcome, PersonRef, Read, StartUpload, TypeOption } from '../types';

/**
 * A stack scanned as one PDF, split into its documents (C2): Kithena
 * proposes where each starts, what it is and whom it is about; HR changes
 * any of it, and each part is filed as a document of its own.
 */

export interface SplitPart {
  readonly from: number;
  readonly to: number;
  readonly title: string;
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
}

export interface SplitProposal {
  readonly available: boolean;
  readonly pages: number;
  readonly parts: readonly SplitPart[];
}

export interface SplitProps {
  readonly onStartUpload?: StartUpload | undefined;
  readonly onProposeSplit?: ((upload: FileRef) => Promise<Read<SplitProposal>>) | undefined;
  readonly onFileSplit?:
    ((upload: FileRef, parts: readonly SplitPart[]) => Promise<Outcome>) | undefined;
}

const NONE = '__none';

export function SplitDialog({
  open,
  onOpenChange,
  types,
  people,
  onStartUpload,
  onProposeSplit,
  onFileSplit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly types: readonly TypeOption[];
  readonly people: readonly PersonRef[];
} & SplitProps): JSX.Element {
  const [upload, setUpload] = useState<FileRef | null>(null);
  const [proposal, setProposal] = useState<SplitProposal | null>(null);
  const [parts, setParts] = useState<readonly SplitPart[]>([]);
  const [reading, setReading] = useState(false);
  const write = useWrite();

  const choose = (file: File): void => {
    if (onStartUpload === undefined || onProposeSplit === undefined) return;
    setReading(true);
    write.run(async () => {
      const put = await putFile(file, onStartUpload);
      if (!put.ok) {
        setReading(false);
        return put;
      }
      setUpload(put.ref);
      const r = await onProposeSplit(put.ref);
      setReading(false);
      if (!r.ok) return r;
      setProposal(r.data);
      setParts(r.data.parts);
      return { ok: true };
    });
  };
  const change = (i: number, patch: Partial<SplitPart>): void => {
    setParts(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };
  /** A part's last page moves; the next part starts after it, and an emptied one goes. */
  const endAt = (i: number, to: number): void => {
    const next = parts.map((p) => ({ ...p }));
    const part = next[i];
    if (part === undefined) return;
    part.to = Math.max(part.from, to);
    for (let j = i + 1; j < next.length; j++) {
      const before = next[j - 1];
      const here = next[j];
      if (before === undefined || here === undefined) break;
      here.from = before.to + 1;
      here.to = Math.max(here.from, here.to);
    }
    setParts(next.filter((p) => p.from <= (proposal?.pages ?? 0)));
  };
  const last = parts.at(-1);
  const covered = last !== undefined && last.to === proposal?.pages;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheetOnTouch>
        <DialogHeader>
          <DialogTitle>Split a scan</DialogTitle>
          <DialogDescription>
            One PDF of several documents. Kithena suggests where each starts; you check it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {upload === null ? (
            <Dropzone
              label="Drop the scanned PDF, or choose it"
              accept="application/pdf"
              variant="inline"
              onFiles={(files) => {
                const first = files[0];
                if (first !== undefined) choose(first);
              }}
            />
          ) : null}
          {reading ? <Spinner label="Kithena is reading the pages" /> : null}
          {proposal === null ? null : (
            <>
              {proposal.available ? null : (
                <Alert tone="info">
                  Kithena could not tell the documents apart. Set where each ends.
                </Alert>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pages</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>About</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parts.map((p, i) => (
                    <TableRow key={`${String(p.from)}-${String(i)}`}>
                      <TableCell>
                        <NumberField
                          label={`Document ${String(i + 1)} ends on page`}
                          value={p.to}
                          min={p.from}
                          max={proposal.pages}
                          onChange={(v) => {
                            if (v !== null) endAt(i, v);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Document ${String(i + 1)} name`}
                          value={p.title}
                          maxLength={200}
                          onChange={(e) => {
                            change(i, { title: e.target.value });
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={p.typeKey ?? NONE}
                          onValueChange={(v) => {
                            change(i, { typeKey: v === NONE ? null : v });
                          }}
                        >
                          <SelectTrigger aria-label={`Document ${String(i + 1)} type`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No type</SelectItem>
                            {types.map((t) => (
                              <SelectItem key={t.key} value={t.key}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Combobox
                          label={`Document ${String(i + 1)} is about`}
                          options={people.map((x) => ({ value: x.personId, label: x.name }))}
                          value={p.subjectPersonId}
                          onChange={(v) => {
                            change(i, { subjectPersonId: typeof v === 'string' ? v : null });
                          }}
                          placeholder="Nobody"
                          searchPlaceholder="Find someone"
                          emptyMessage="Nobody by that name"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {covered ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    if (last === undefined) return;
                    setParts([
                      ...parts,
                      {
                        from: last.to + 1,
                        to: proposal.pages,
                        title: 'Document',
                        typeKey: null,
                        subjectPersonId: null,
                      },
                    ]);
                  }}
                >
                  Add the pages left
                </Button>
              )}
            </>
          )}
          {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={upload === null || !covered || parts.some((p) => p.title.trim() === '')}
            loading={write.pending && !reading}
            onClick={() => {
              if (upload === null || onFileSplit === undefined) return;
              write.run(
                () => onFileSplit(upload, parts),
                () => {
                  onOpenChange(false);
                },
              );
            }}
          >
            {`File ${String(parts.length)} documents`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
