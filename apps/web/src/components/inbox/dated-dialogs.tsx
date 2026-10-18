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
      title="Remind me"
      description={
        item.due === null
          ? 'It comes back to To do then.'
          : `It comes back by the day it’s due, ${item.due}, at the latest.`
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={at === ''}
            onClick={() => {
              onPick(new Date(at).toISOString());
            }}
          >
            Remind me
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel>When</FieldLabel>
        <FieldControl>
          <DatePicker
            label="When"
            {...(item.due === null ? {} : { max: item.due })}
            value={at === '' ? null : at.slice(0, 10)}
            onChange={(d) => {
              setAt(d === null ? '' : `${d}T${at.slice(11, 16) || '09:00'}`);
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>At</FieldLabel>
        <FieldControl>
          <TimePicker
            label="At"
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
      title="Change the due date"
      description="For everyone who still has it. Reminders follow the new date."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onPick(day === '' ? null : day);
            }}
          >
            Change
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel>Due</FieldLabel>
        <FieldControl>
          <DatePicker
            label="Due"
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
      title="Hand over while you’re away"
      description="Approvals go to someone else for these dates. People waiting see who has them."
      onClose={onClose}
      footer={
        <>
          {current === null ? null : (
            <Button variant="ghost" className="me-auto" onClick={onStop}>
              {`Stop handing to ${current.delegateName}`}
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              onSave({ delegateId, from, to });
            }}
          >
            Hand over
          </Button>
        </>
      }
    >
      {current === null ? null : (
        <Alert tone="info">{`${current.delegateName} has them from ${current.from} to ${current.to}.`}</Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field required>
          <FieldLabel>From</FieldLabel>
          <FieldControl>
            <DatePicker
              label="From"
              value={from === '' ? null : from}
              onChange={(d) => {
                setFrom(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>Until</FieldLabel>
          <FieldControl>
            <DatePicker
              label="Until"
              value={to === '' ? null : to}
              onChange={(d) => {
                setTo(d ?? '');
              }}
            />
          </FieldControl>
        </Field>
      </div>
      <RadioGroup aria-label="Hand to" value={delegateId} onValueChange={setDelegateId}>
        {candidates.map((c) => (
          <RadioGroupItem key={c.personId} value={c.personId}>
            {c.displayName}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <p className="text-sm text-fg-subtle">
        Time off approvals are handed over; People’s Review stays with HR.
      </p>
    </Frame>
  );
}
