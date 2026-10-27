import {
  Button,
  DatePicker,
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
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { t } from './i18n';
import { when, type useAct } from './shared';

interface LeftBehind {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
}

/**
 * What a move can still need after it is sent, the same on the board and the
 * candidate's page: into Hired with no accepted offer, the day they start;
 * past a step whose interview is still booked, whether to cancel it.
 */
export function useMoveFollowUps(act: ReturnType<typeof useAct>): {
  /** The move's answer: asks about any interview it went past. */
  readonly moved: (answer: unknown) => void;
  /** The move's refusal: `'asked'` when it asks for the start date and repeats the move with it. */
  readonly refused: (
    code: string | undefined,
    name: string,
    again: (startDate: string) => void,
  ) => 'asked' | undefined;
  readonly dialogs: JSX.Element;
} {
  const [starting, setStarting] = useState<{
    readonly name: string;
    readonly again: (startDate: string) => void;
  } | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [behind, setBehind] = useState<readonly LeftBehind[]>([]);
  return {
    moved: (answer) => {
      const scheduled = (answer as { scheduled?: readonly LeftBehind[] } | null)?.scheduled ?? [];
      if (scheduled.length > 0) setBehind(scheduled);
    },
    refused: (code, name, again) => {
      if (code !== 'HIRE_NEEDS_START_DATE') return undefined;
      setStartDate(null);
      setStarting({ name, again });
      return 'asked';
    },
    dialogs: (
      <>
        <Dialog
          open={starting !== null}
          onOpenChange={(open) => {
            if (!open) setStarting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('move.hire_title', 'Hire {{name}}', { name: starting?.name ?? '' })}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'move.hire_without_offer',
                  'There is no accepted offer to say when they start. Their People record is created as soon as they are hired, from this date.',
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field required>
                <FieldLabel>{t('move.start_date', 'Start date')}</FieldLabel>
                <FieldControl>
                  <DatePicker
                    label={t('move.start_date', 'Start date')}
                    value={startDate}
                    onChange={setStartDate}
                  />
                </FieldControl>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setStarting(null);
                }}
              >
                {t('move.cancel', 'Cancel')}
              </Button>
              <Button
                disabled={startDate === null}
                loading={act.pending}
                onClick={() => {
                  if (starting === null || startDate === null) return;
                  starting.again(startDate);
                  setStarting(null);
                }}
              >
                {t('move.hire', 'Hire')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={behind.length > 0}
          onOpenChange={(open) => {
            if (!open) setBehind([]);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('move.cancel_interviews_title', 'Cancel the interviews they skipped?')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'move.cancel_interviews_about',
                  'They moved past a step whose interview is still booked. Cancelling tells the candidate and the panel, and takes it off their calendars.',
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="flex flex-col gap-1 text-sm">
                {behind.map((i) => (
                  <li key={i.id}>
                    {i.title} · <span className="text-fg-muted">{when(i.startsAt)}</span>
                  </li>
                ))}
              </ul>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setBehind([]);
                }}
              >
                {t('move.keep_interviews', 'Keep them')}
              </Button>
              <Button
                variant="destructive"
                loading={act.pending}
                onClick={() => {
                  const ids = behind.map((i) => i.id);
                  setBehind([]);
                  for (const interviewId of ids)
                    act.run(
                      'SetInterviewState',
                      { interviewId, input: { to: 'cancelled' } },
                      undefined,
                      undefined,
                      `cancel:${interviewId}`,
                    );
                }}
              >
                {t('move.cancel_interviews', 'Cancel interviews')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
