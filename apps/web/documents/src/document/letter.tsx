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
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Spinner,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { shortDate } from '../shared';
import type { Outcome, Read } from '../types';

/**
 * A letter that changes a record (J7): a resignation's last working day,
 * read with its page, becomes the person's notice once HR ticks it. The
 * record's own rules run from there; the leave balance is settled when they
 * leave, as it is for anybody.
 */

export interface LetterData {
  readonly personId: string;
  readonly name: string;
  readonly lastWorkingDay: { readonly value: string; readonly page: number } | null;
}

export interface LetterProps {
  readonly onReadLetter?: ((documentId: string) => Promise<Read<LetterData>>) | undefined;
  readonly onGiveNotice?:
    ((personId: string, lastWorkingDay: string) => Promise<Outcome>) | undefined;
}

export function ActOnLetter({
  documentId,
  onReadLetter,
  onGiveNotice,
}: { readonly documentId: string } & LetterProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (onReadLetter === undefined || onGiveNotice === undefined) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        startIcon={<icons.offboard aria-hidden />}
        onClick={() => {
          setOpen(true);
        }}
      >
        Act on this letter
      </Button>
      {open ? (
        <LetterDialog
          documentId={documentId}
          onReadLetter={onReadLetter}
          onGiveNotice={onGiveNotice}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function LetterDialog({
  documentId,
  onReadLetter,
  onGiveNotice,
  onClose,
}: {
  readonly documentId: string;
  readonly onReadLetter: NonNullable<LetterProps['onReadLetter']>;
  readonly onGiveNotice: NonNullable<LetterProps['onGiveNotice']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [data, setData] = useState<Read<LetterData> | null>(null);
  const [notice, setNotice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Outcome | null>(null);
  useEffect(() => {
    let live = true;
    void onReadLetter(documentId).then((r) => {
      if (live) setData(r);
    });
    return () => {
      live = false;
    };
  }, [documentId, onReadLetter]);
  const day = data?.ok === true ? data.data.lastWorkingDay : null;
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
            {data?.ok === true
              ? `What this letter changes for ${data.data.name}`
              : 'Act on this letter'}
          </DialogTitle>
          <DialogDescription>Each is a tick. Nothing changes until you save.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {data === null ? (
            <Spinner label="Kithena is reading the letter" />
          ) : !data.ok ? (
            <Alert tone="danger">{data.message}</Alert>
          ) : day === null ? (
            <p className="text-sm text-fg-muted">The letter states no last working day.</p>
          ) : (
            <>
              <Field orientation="horizontal">
                <FieldControl>
                  <Checkbox
                    checked={notice}
                    disabled={done?.ok === true}
                    onCheckedChange={(v) => {
                      setNotice(v === true);
                    }}
                  />
                </FieldControl>
                <FieldLabel>
                  {`Give notice: last working day ${shortDate(day.value)} `}
                  <Badge size="sm" tone="neutral">{`p. ${String(day.page)}`}</Badge>
                </FieldLabel>
                <FieldDescription>
                  Their record shows them leaving, and offboarding starts from it.
                </FieldDescription>
              </Field>
              <p className="text-sm text-fg-muted">
                Their leave balance is settled on that day, as it is for anybody leaving.
              </p>
            </>
          )}
          {done === null ? null : done.ok ? (
            <Alert tone="success" title="Saved">
              Their notice is in their record.
            </Alert>
          ) : (
            <Alert tone="danger">{done.message}</Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {done?.ok === true ? 'Close' : 'Cancel'}
          </Button>
          {done?.ok === true || day === null || data?.ok !== true ? null : (
            <Button
              variant="primary"
              loading={busy}
              disabled={!notice}
              onClick={() => {
                setBusy(true);
                void onGiveNotice(data.data.personId, day.value).then((r) => {
                  setBusy(false);
                  setDone(r);
                });
              }}
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
