'use client';

import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  RadioGroup,
  RadioGroupItem,
  DatePicker,
  TimePicker,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Frame, type Candidate } from './dialogs';
import type { Shown } from '../../lib/inbox/model';
import { t as tr } from '../../lib/t';

/**
 * The Inbox dialogs that pick a date or a time, in a chunk of their own: Reach's
 * pickers stay out of every page's first load, and arrive when one of these
 * opens (`apps/web/acceptance/perf.acceptance.test.ts`, the JS budgets).
 */

/** C6's "Pick a date and time…": never past the due date (the action holds it there). */
export function SnoozeDialog({
  item,
  onPick,
  onClose,
}: {
  readonly item: Shown;
  readonly onPick: (at: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [at, setAt] = useState('');
  return (
    <Frame
      title={tr('components.inbox.dated-dialogs.remind_me', 'Remind me')}
      description={
        item.due === null
          ? tr(
              'components.inbox.dated-dialogs.it_comes_back_to_to_do',
              'It comes back to To do then.',
            )
          : tr(
              'components.inbox.dated-dialogs.it_comes_back_by_the_day',
              'It comes back by the day it’s due, {{due}}, at the latest.',
              { due: item.due },
            )
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('components.inbox.dated-dialogs.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            disabled={at === ''}
            onClick={() => {
              onPick(new Date(at).toISOString());
            }}
          >
            {tr('components.inbox.dated-dialogs.remind_me', 'Remind me')}
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel>{tr('components.inbox.dated-dialogs.when', 'When')}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={tr('components.inbox.dated-dialogs.when', 'When')}
            {...(item.due === null ? {} : { max: item.due })}
            value={at === '' ? null : at.slice(0, 10)}
            onChange={(d) => {
              setAt(d === null ? '' : `${d}T${at.slice(11, 16) || '09:00'}`);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>{tr('components.inbox.dated-dialogs.at', 'At')}</FieldLabel>
        <FieldControl>
          <TimePicker
            label={tr('components.inbox.dated-dialogs.at', 'At')}
            value={at === '' ? null : at.slice(11, 16)}
            onChange={(t) => {
              if (t !== null && at !== '') setAt(`${at.slice(0, 10)}T${t}`);
            }}
          />
        </FieldControl>
      </Field>
    </Frame>
  );
}

/** H4's "Change due date". */
export function DueDialog({
  due,
  onPick,
  onClose,
}: {
  readonly due: string | null;
  readonly onPick: (due: string | null) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [day, setDay] = useState(due ?? '');
  return (
    <Frame
      title={tr('components.inbox.dated-dialogs.change_the_due_date', 'Change the due date')}
      description={tr(
        'components.inbox.dated-dialogs.for_everyone_who_still_has_it',
        'For everyone who still has it. Reminders follow the new date.',
      )}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('components.inbox.dated-dialogs.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onPick(day === '' ? null : day);
            }}
          >
            {tr('components.inbox.dated-dialogs.change', 'Change')}
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel>{tr('components.inbox.dated-dialogs.due', 'Due')}</FieldLabel>
        <FieldControl>
          <DatePicker
            label={tr('components.inbox.dated-dialogs.due', 'Due')}
            value={day === '' ? null : day}
            onChange={(d) => {
              setDay(d ?? '');
            }}
          />
        </FieldControl>
      </Field>
    </Frame>
  );
}

/** G4, M:F3: hand approvals over while away (Time Off's cover). */
export function HandOverDialog({
  candidates,
  current,
  onSave,
  onStop,
  onClose,
}: {
  readonly candidates: readonly Candidate[];
  readonly current: {
    readonly delegateName: string;
    readonly from: string;
    readonly to: string;
  } | null;
  readonly onSave: (input: { delegateId: string; from: string; to: string }) => void;
  readonly onStop: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [delegateId, setDelegateId] = useState('');
  const ready = from !== '' && to !== '' && to >= from && delegateId !== '';
  return (
    <Frame
      title={tr(
        'components.inbox.dated-dialogs.hand_over_while_youre_away',
        'Hand over while you’re away',
      )}
      description={tr(
        'components.inbox.dated-dialogs.approvals_go_to_someone_else_for',
        'Approvals go to someone else for these dates. People waiting see who has them.',
      )}
      onClose={onClose}
      footer={
        <>
          {current === null ? null : (
            <Button variant="ghost" className="me-auto" onClick={onStop}>
              {tr(
                'components.inbox.dated-dialogs.stop_handing_to',
                'Stop handing to {{delegateName}}',
                { delegateName: current.delegateName },
              )}
            </Button>
          )}
          <Button onClick={onClose}>{tr('components.inbox.dated-dialogs.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              onSave({ delegateId, from, to });
            }}
          >
            {tr('components.inbox.dated-dialogs.hand_over', 'Hand over')}
          </Button>
        </>
      }
    >
      {current === null ? null : (
        <Alert tone="info">
          {tr(
            'components.inbox.dated-dialogs.has_them_from_to',
            '{{delegateName}} has them from {{from}} to {{to}}.',
            { delegateName: current.delegateName, from: current.from, to: current.to },
          )}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field required>
          <FieldLabel>{tr('components.inbox.dated-dialogs.from', 'From')}</FieldLabel>
          <FieldControl>
            <DatePicker
              label={tr('components.inbox.dated-dialogs.from', 'From')}
              value={from === '' ? null : from}
              onChange={(d) => {
                setFrom(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>{tr('components.inbox.dated-dialogs.until', 'Until')}</FieldLabel>
          <FieldControl>
            <DatePicker
              label={tr('components.inbox.dated-dialogs.until', 'Until')}
              value={to === '' ? null : to}
              onChange={(d) => {
                setTo(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
      </div>
      <RadioGroup
        aria-label={tr('components.inbox.dated-dialogs.hand_to', 'Hand to')}
        value={delegateId}
        onValueChange={setDelegateId}
      >
        {candidates.map((c) => (
          <RadioGroupItem key={c.personId} value={c.personId}>
            {c.displayName}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <p className="text-sm text-fg-subtle">
        {tr(
          'components.inbox.dated-dialogs.time_off_approvals_are_handed_over',
          'Time off approvals are handed over; People’s Review stays with HR.',
        )}
      </p>
    </Frame>
  );
}
