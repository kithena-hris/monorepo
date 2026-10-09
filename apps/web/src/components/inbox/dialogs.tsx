'use client';

import {
  Alert,
  Avatar,
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
  FieldLabel,
  Input,
  List,
  ListItem,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  SegmentedControlItem,
  SignaturePad,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { moduleName, type Shown } from '../../lib/inbox/model';
import { mute, sendBackAsk } from '../../app/(app)/inbox/actions';
import type { Act } from './detail';

/**
 * The Inbox's dialogs: short and centred, never a new page (C4's rule). Each
 * says what will happen in its title and its button.
 */

function Frame({
  title,
  description,
  children,
  footer,
  onClose,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly footer: ReactNode;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children === undefined ? null : (
          <DialogBody className="flex flex-col gap-4">{children}</DialogBody>
        )}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** E2 and the like: a plain confirmation. */
export function ConfirmDialog({
  title,
  description,
  confirm,
  cancel = 'Cancel',
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
  readonly cancel?: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Frame
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{cancel}</Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    />
  );
}

/** A note to go with an action: sending back, taking over. */
export function NoteDialog({
  title,
  description,
  label,
  confirm,
  optional = false,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly confirm: string;
  readonly optional?: boolean;
  readonly onConfirm: (note: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  return (
    <Frame
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!optional && note.trim() === ''}
            onClick={() => {
              onConfirm(note.trim());
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Field required={!optional}>
        <FieldLabel>{optional ? `${label} (optional)` : label}</FieldLabel>
        <FieldControl>
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
    </Frame>
  );
}

/** C8: "I can't do this" always needs a reason. */
export function SendBackDialog({
  sender,
  askId,
  act,
  onClose,
}: {
  readonly sender: string;
  readonly askId: string;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [reason, setReason] = useState<'no_information' | 'not_applicable' | 'other'>(
    'no_information',
  );
  const [note, setNote] = useState('');
  const ready = reason !== 'other' || note.trim() !== '';
  return (
    <Frame
      title={`Send this back to ${sender}?`}
      description={`It leaves your To do. ${sender} gets an update with your reason and can ask again or cancel it.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.undo aria-hidden />}
            disabled={!ready}
            onClick={() => {
              onClose();
              act.run(() => sendBackAsk(askId, reason, note.trim() === '' ? null : note.trim()), {
                title: 'Sent back',
                description: `${sender} gets an update`,
                next: true,
              });
            }}
          >
            Send back
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label="Why"
        value={reason}
        onValueChange={(v) => {
          if (v === 'no_information' || v === 'not_applicable' || v === 'other') setReason(v);
        }}
      >
        <RadioGroupItem value="no_information">I don’t have this information</RadioGroupItem>
        <RadioGroupItem value="not_applicable">This doesn’t apply to me</RadioGroupItem>
        <RadioGroupItem value="other">Something else</RadioGroupItem>
      </RadioGroup>
      <Field required={reason === 'other'}>
        <FieldLabel>{`Note for ${sender}`}</FieldLabel>
        <FieldControl>
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
    </Frame>
  );
}

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
          <Input
            type="datetime-local"
            value={at}
            {...(item.due === null ? {} : { max: `${item.due}T23:59` })}
            onChange={(e) => {
              setAt(e.target.value);
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
          <Input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
    </Frame>
  );
}

/** D6: mute updates like this, per kind or for the whole module, and where. */
export function MuteDialog({
  item,
  act,
  onClose,
}: {
  readonly item: Shown;
  readonly act: Act;
  readonly onClose: () => void;
}): JSX.Element {
  const [what, setWhat] = useState<'kind' | 'module'>('kind');
  const [email, setEmail] = useState(true);
  const [phone, setPhone] = useState(true);
  const [inbox, setInbox] = useState(false);
  const area = item.area ?? 'updates';
  return (
    <Frame
      title="Mute updates like this?"
      description="You’ll still find them in Done. Tasks are never muted."
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-sm text-fg-subtle">Undo in Settings › Notifications</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!email && !phone && !inbox}
            onClick={() => {
              onClose();
              act.run(
                () =>
                  mute({ what: what === 'kind' ? item.kind : item.module, email, phone, inbox }),
                { title: 'Muted' },
              );
            }}
          >
            Mute
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label="What to mute"
        value={what}
        onValueChange={(v) => {
          if (v === 'kind' || v === 'module') setWhat(v);
        }}
      >
        <RadioGroupItem value="kind">{`${area} from ${moduleName(item.module)}`}</RadioGroupItem>
        <RadioGroupItem value="module">{`Everything from ${moduleName(item.module)}`}</RadioGroupItem>
      </RadioGroup>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-fg-muted">Mute on</legend>
        {(
          [
            ['Email', email, setEmail],
            ['Phone', phone, setPhone],
            ['Inbox, too', inbox, setInbox],
          ] as const
        ).map(([label, on, set]) => (
          <Field key={label} orientation="horizontal">
            <FieldControl>
              <Checkbox
                checked={on}
                onCheckedChange={(v) => {
                  set(v === true);
                }}
              />
            </FieldControl>
            <FieldLabel>{label}</FieldLabel>
          </Field>
        ))}
      </fieldset>
    </Frame>
  );
}

/** C4, M:B4: sign, typed or drawn; the time, place and name are recorded. */
export function SignDialog({
  documentName,
  counter,
  onSign,
  onClose,
}: {
  readonly documentName: string;
  readonly counter: boolean;
  readonly onSign: (s: { name: string; how: 'typed' | 'drawn'; mark: string }) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [how, setHow] = useState<'typed' | 'drawn'>('typed');
  const [name, setName] = useState('');
  const [mark, setMark] = useState('');
  const [agreed, setAgreed] = useState(false);
  const ready = name.trim() !== '' && agreed && (how === 'typed' || mark !== '');
  return (
    <Frame
      title={`${counter ? 'Countersign' : 'Sign'} ${documentName}`}
      description="A signed copy is kept in the profile under Documents."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={!ready}
            onClick={() => {
              onSign({ name: name.trim(), how, mark: how === 'typed' ? name.trim() : mark });
            }}
          >
            {counter ? 'Countersign' : 'Sign'}
          </Button>
        </>
      }
    >
      {counter ? null : (
        <SegmentedControl
          aria-label="How to sign"
          size="sm"
          value={how}
          onValueChange={(v) => {
            if (v === 'typed' || v === 'drawn') setHow(v);
          }}
        >
          <SegmentedControlItem value="typed">Type</SegmentedControlItem>
          <SegmentedControlItem value="drawn">Draw</SegmentedControlItem>
        </SegmentedControl>
      )}
      <Field required>
        <FieldLabel>Your full name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      {how === 'drawn' ? (
        <SignaturePad value={mark} onValueChange={setMark} label="Draw your signature" />
      ) : null}
      <Field orientation="horizontal">
        <FieldControl>
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => {
              setAgreed(v === true);
            }}
          />
        </FieldControl>
        <FieldLabel>I agree this is my signature</FieldLabel>
      </Field>
      <p className="text-sm text-fg-subtle">
        The time, the place your company works from and your name are recorded in the document’s
        history.
      </p>
    </Frame>
  );
}

/** G3: decide several of the same kind at once, with the one warning that matters. */
export function BulkDecideDialog({
  items,
  decision,
  warning,
  onConfirm,
  onClose,
}: {
  readonly items: readonly Shown[];
  readonly decision: 'approve' | 'decline';
  readonly warning: string | null;
  readonly onConfirm: (note: string | null) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const n = String(items.length);
  return (
    <Frame
      title={`${decision === 'approve' ? 'Approve' : 'Decline'} ${n} time-off requests?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={decision === 'approve' ? <icons.approve aria-hidden /> : undefined}
            onClick={() => {
              onConfirm(note.trim() === '' ? null : note.trim());
            }}
          >
            {`${decision === 'approve' ? 'Approve' : 'Decline'} ${n}`}
          </Button>
        </>
      }
    >
      <List aria-label="Requests">
        {items.map((i) => (
          <ListItem
            key={i.id}
            leading={<Avatar name={i.from?.name ?? i.title} size="sm" />}
            description={i.summary}
          >
            {i.title}
          </ListItem>
        ))}
      </List>
      <Field>
        <FieldLabel>{items.length === 2 ? 'Note to both' : 'Note to all'}</FieldLabel>
        <FieldControl>
          <Input
            placeholder="Optional"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      {warning === null ? null : <Alert tone="warning">{warning}</Alert>}
    </Frame>
  );
}

export interface Candidate {
  readonly personId: string;
  readonly displayName: string;
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
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>Until</FieldLabel>
          <FieldControl>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
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
