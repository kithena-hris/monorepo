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
import type { Act } from './pane';
import { t } from '../../lib/t';

/**
 * The Inbox's dialogs: short and centred, never a new page (C4's rule). Each
 * says what will happen in its title and its button.
 */

export function Frame({
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
  cancel = t('components.inbox.dialogs.cancel', 'Cancel'),
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
          <Button onClick={onClose}>{t('components.inbox.dialogs.cancel', 'Cancel')}</Button>
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
        <FieldLabel>
          {optional
            ? t('components.inbox.dialogs.optional', '{{label}} (optional)', { label })
            : label}
        </FieldLabel>
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
      title={t('components.inbox.dialogs.send_this_back_to', 'Send this back to {{sender}}?', {
        sender,
      })}
      description={t(
        'components.inbox.dialogs.it_leaves_your_to_do_gets',
        'It leaves your To do. {{sender}} gets an update with your reason and can ask again or cancel it.',
        { sender },
      )}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('components.inbox.dialogs.cancel', 'Cancel')}</Button>
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
            {t('components.inbox.dialogs.send_back', 'Send back')}
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label={t('components.inbox.dialogs.why', 'Why')}
        value={reason}
        onValueChange={(v) => {
          if (v === 'no_information' || v === 'not_applicable' || v === 'other') setReason(v);
        }}
      >
        <RadioGroupItem value="no_information">
          {t(
            'components.inbox.dialogs.i_dont_have_this_information',
            'I don’t have this information',
          )}
        </RadioGroupItem>
        <RadioGroupItem value="not_applicable">
          {t('components.inbox.dialogs.this_doesnt_apply_to_me', 'This doesn’t apply to me')}
        </RadioGroupItem>
        <RadioGroupItem value="other">
          {t('components.inbox.dialogs.something_else', 'Something else')}
        </RadioGroupItem>
      </RadioGroup>
      <Field required={reason === 'other'}>
        <FieldLabel>
          {t('components.inbox.dialogs.note_for', 'Note for {{sender}}', { sender })}
        </FieldLabel>
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
      title={t('components.inbox.dialogs.mute_updates_like_this', 'Mute updates like this?')}
      description={t(
        'components.inbox.dialogs.youll_still_find_them_in_done',
        'You’ll still find them in Done. Tasks are never muted.',
      )}
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-sm text-fg-subtle">
            {t(
              'components.inbox.dialogs.undo_in_settings_notifications',
              'Undo in Settings › Notifications',
            )}
          </span>
          <Button onClick={onClose}>{t('components.inbox.dialogs.cancel', 'Cancel')}</Button>
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
            {t('components.inbox.dialogs.mute', 'Mute')}
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label={t('components.inbox.dialogs.what_to_mute', 'What to mute')}
        value={what}
        onValueChange={(v) => {
          if (v === 'kind' || v === 'module') setWhat(v);
        }}
      >
        <RadioGroupItem value="kind">
          {t('components.inbox.dialogs.from', '{{area}} from {{moduleName}}', {
            area,
            moduleName: moduleName(item.module),
          })}
        </RadioGroupItem>
        <RadioGroupItem value="module">
          {t('components.inbox.dialogs.everything_from', 'Everything from {{moduleName}}', {
            moduleName: moduleName(item.module),
          })}
        </RadioGroupItem>
      </RadioGroup>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-fg-muted">
          {t('components.inbox.dialogs.mute_on', 'Mute on')}
        </legend>
        {(
          [
            [t('components.inbox.dialogs.email', 'Email'), email, setEmail],
            [t('components.inbox.dialogs.phone', 'Phone'), phone, setPhone],
            [t('components.inbox.dialogs.inbox_too', 'Inbox, too'), inbox, setInbox],
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
      title={t('components.inbox.dialogs.text', '{{value}} {{documentName}}', {
        value: counter ? 'Countersign' : 'Sign',
        documentName,
      })}
      description={t(
        'components.inbox.dialogs.a_signed_copy_is_kept_in',
        'A signed copy is kept in the profile under Documents.',
      )}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('components.inbox.dialogs.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={!ready}
            onClick={() => {
              onSign({ name: name.trim(), how, mark: how === 'typed' ? name.trim() : mark });
            }}
          >
            {counter
              ? t('components.inbox.dialogs.countersign', 'Countersign')
              : t('components.inbox.dialogs.sign', 'Sign')}
          </Button>
        </>
      }
    >
      {counter ? null : (
        <SegmentedControl
          aria-label={t('components.inbox.dialogs.how_to_sign', 'How to sign')}
          size="sm"
          value={how}
          onValueChange={(v) => {
            if (v === 'typed' || v === 'drawn') setHow(v);
          }}
        >
          <SegmentedControlItem value="typed">
            {t('components.inbox.dialogs.type', 'Type')}
          </SegmentedControlItem>
          <SegmentedControlItem value="drawn">
            {t('components.inbox.dialogs.draw', 'Draw')}
          </SegmentedControlItem>
        </SegmentedControl>
      )}
      <Field required>
        <FieldLabel>{t('components.inbox.dialogs.your_full_name', 'Your full name')}</FieldLabel>
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
        <SignaturePad
          value={mark}
          onValueChange={setMark}
          label={t('components.inbox.dialogs.draw_your_signature', 'Draw your signature')}
        />
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
        <FieldLabel>
          {t(
            'components.inbox.dialogs.i_agree_this_is_my_signature',
            'I agree this is my signature',
          )}
        </FieldLabel>
      </Field>
      <p className="text-sm text-fg-subtle">
        {t(
          'components.inbox.dialogs.the_time_the_place_your_company',
          'The time, the place your company works from and your name are recorded in the document’s history.',
        )}
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
      title={t('components.inbox.dialogs.time_off_requests', '{{value}} {{n}} time-off requests?', {
        value: decision === 'approve' ? 'Approve' : 'Decline',
        n,
      })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('components.inbox.dialogs.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={decision === 'approve' ? <icons.approve aria-hidden /> : undefined}
            onClick={() => {
              onConfirm(note.trim() === '' ? null : note.trim());
            }}
          >
            {t('components.inbox.dialogs.text_2', '{{value}} {{n}}', {
              value: decision === 'approve' ? 'Approve' : 'Decline',
              n,
            })}
          </Button>
        </>
      }
    >
      <List aria-label={t('components.inbox.dialogs.requests', 'Requests')}>
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
        <FieldLabel>
          {items.length === 2
            ? t('components.inbox.dialogs.note_to_both', 'Note to both')
            : t('components.inbox.dialogs.note_to_all', 'Note to all')}
        </FieldLabel>
        <FieldControl>
          <Input
            placeholder={t('components.inbox.dialogs.optional_2', 'Optional')}
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
