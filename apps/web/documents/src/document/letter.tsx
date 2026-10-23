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
import { t } from '../i18n';

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
        {t('document.letter.act_on_this_letter', 'Act on this letter')}
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
              ? t(
                  'document.letter.what_this_letter_changes_for',
                  'What this letter changes for {{name}}',
                  { name: data.data.name },
                )
              : t('document.letter.act_on_this_letter', 'Act on this letter')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'document.letter.each_is_a_tick_nothing_changes',
              'Each is a tick. Nothing changes until you save.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {data === null ? (
            <Spinner
              label={t(
                'document.letter.kithena_is_reading_the_letter',
                'Kithena is reading the letter',
              )}
            />
          ) : !data.ok ? (
            <Alert tone="danger">{data.message}</Alert>
          ) : day === null ? (
            <p className="text-sm text-fg-muted">
              {t(
                'document.letter.the_letter_states_no_last_working',
                'The letter states no last working day.',
              )}
            </p>
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
                  {t(
                    'document.letter.give_notice_last_working_day',
                    'Give notice: last working day {{value}}',
                    { value: shortDate(day.value) },
                  ) + ' '}
                  <Badge size="sm" tone="neutral">
                    {t('document.letter.p', 'p. {{page}}', { page: String(day.page) })}
                  </Badge>
                </FieldLabel>
                <FieldDescription>
                  {t(
                    'document.letter.their_record_shows_them_leaving_and',
                    'Their record shows them leaving, and offboarding starts from it.',
                  )}
                </FieldDescription>
              </Field>
              <p className="text-sm text-fg-muted">
                {t(
                  'document.letter.their_leave_balance_is_settled_on',
                  'Their leave balance is settled on that day, as it is for anybody leaving.',
                )}
              </p>
            </>
          )}
          {done === null ? null : done.ok ? (
            <Alert tone="success" title={t('document.letter.saved', 'Saved')}>
              {t(
                'document.letter.their_notice_is_in_their_record',
                'Their notice is in their record.',
              )}
            </Alert>
          ) : (
            <Alert tone="danger">{done.message}</Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {done?.ok === true
              ? t('document.letter.close', 'Close')
              : t('document.letter.cancel', 'Cancel')}
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
              {t('document.letter.save', 'Save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
