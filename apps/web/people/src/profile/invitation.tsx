import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  icons,
  SegmentedControl,
  SegmentedControlItem,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import type { Outcome } from '../load';
import { t } from '../i18n';
import { AttributeInput } from '../record/attribute-input';
import { longDate } from '../record/display';
import { isFileField } from '../record/files';
import type { RecordField, RecordSection, Values } from '../record/model';

/** Where a hire's invitation to sign up stands (People PRD §8.2, step 8). */
export interface Invitation {
  readonly state: 'not_invited' | 'scheduled' | 'invited' | 'signed_up';
  readonly sendOn: string | null;
  readonly sentAt: string | null;
}

export interface InvitationActions {
  /** The invitation of whoever holds this work email; null when there is none to read. */
  readonly read: (email: string) => Promise<Invitation | null>;
  /** Sent now (null), or kept for a day on their calendar. */
  readonly send: (
    sendOn: string | null,
  ) => Promise<
    | { readonly ok: true; readonly invitation: Invitation }
    | { readonly ok: false; readonly message: string }
  >;
}

/**
 * A hire who has not started, as HR sees them: the record is filled in from
 * their contract and theirs to check and complete above; this is the one
 * step left, the invitation to sign up, sent now or on a day. The start date
 * is the contract's; signing up makes them onboarding until it.
 */
export function InvitationCard({
  name,
  email,
  startsOn,
  actions,
  sections,
  values,
  onSave,
  onSaved,
  openAtStart = false,
}: {
  readonly name: string;
  readonly email: string;
  readonly startsOn: string | null;
  readonly actions: InvitationActions;
  /** The record as HR sees it: what the set-up dialog offers to fill in before inviting. */
  readonly sections: readonly RecordSection[];
  readonly values: Values;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  /** What the dialog saved and the record now holds. */
  readonly onSaved: (applied: Values) => void;
  /** Opened from the Inbox or Recruiting (`?invite=1`): the dialog is up on arrival. */
  readonly openAtStart?: boolean;
}): JSX.Element | null {
  const [invitation, setInvitation] = useState<Invitation | null | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [settingUp, setSettingUp] = useState(openAtStart);
  useEffect(() => {
    let live = true;
    void actions
      .read(email)
      .catch(() => null)
      .then((found) => {
        // Nothing to read is no invitation card, never a broken record.
        if (live) setInvitation(found ?? null);
      });
    return () => {
      live = false;
    };
  }, [email, actions]);
  if (invitation === null || invitation === 'loading' || invitation.state === 'signed_up')
    return null;
  const first = name.split(' ')[0] ?? name;
  const send = (on: string | null): void => {
    setError(null);
    startSending(async () => {
      const done = await actions.send(on);
      if (!done.ok) {
        setError(done.message);
        return;
      }
      setInvitation(done.invitation);
    });
  };
  const dialog = settingUp ? (
    <SetUpDialog
      name={first}
      sections={sections}
      values={values}
      scheduledFor={invitation.state === 'scheduled' ? invitation.sendOn : null}
      onSave={onSave}
      onClose={() => {
        setSettingUp(false);
      }}
      onDone={(applied, sendOn) =>
        actions.send(sendOn).then((done) => {
          onSaved(applied);
          if (!done.ok) return done.message;
          setInvitation(done.invitation);
          setSettingUp(false);
          return null;
        })
      }
    />
  ) : null;
  const said =
    invitation.state === 'invited'
      ? t(
          'profile.invitation.sent',
          'Sent on {{date}}. {{name}} confirms the details filled in from their contract, adds what is missing, and signs up.',
          { name: first, date: longDate((invitation.sentAt ?? '').slice(0, 10)) },
        )
      : invitation.state === 'scheduled'
        ? t('profile.invitation.scheduled', 'It goes to {{name}} on {{date}}.', {
            name: first,
            date: longDate(invitation.sendOn ?? ''),
          })
        : t(
            'profile.invitation.not_sent',
            'Check the record above, then invite {{name}} to sign up, now or on a day you choose. Until they do they are a pre-hire, seen only by HR.',
            { name: first },
          );
  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{t('profile.invitation.title', 'Invitation to sign up')}</CardTitle>
        <CardDescription>
          {startsOn === null
            ? said
            : `${t('profile.invitation.starts', 'Starts {{date}}, from their contract.', {
                date: longDate(startsOn),
              })} ${said}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Badge dot tone={invitation.state === 'not_invited' ? 'warning' : 'accent'}>
            {invitation.state === 'invited'
              ? t('profile.invitation.state_invited', 'Invited')
              : invitation.state === 'scheduled'
                ? t('profile.invitation.state_scheduled', 'Scheduled')
                : t('profile.invitation.state_not_invited', 'Not invited')}
          </Badge>
        </div>
        {error === null ? null : (
          <Alert tone="danger" title={t('profile.invitation.not_sent_title', 'Not sent')}>
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Button
            variant="primary"
            startIcon={<icons.email aria-hidden />}
            onClick={() => {
              setSettingUp(true);
            }}
          >
            {t('profile.invitation.set_up_and_invite', 'Set up and invite')}
          </Button>
          {invitation.state === 'invited' ? (
            <Button
              loading={sending}
              onClick={() => {
                send(null);
              }}
            >
              {t('profile.invitation.send_again', 'Send it again')}
            </Button>
          ) : null}
        </div>
        {dialog}
      </CardContent>
    </Card>
  );
}

/** A field HR fills in here: theirs to change, kept in People, not a file. */
const fillable = (f: RecordField): boolean =>
  !f.readOnly && f.keptIn === undefined && !isFileField(f);

/**
 * Everything HR can fill in before the hire is invited — their manager,
 * department, location, the rest of the record — and when the invitation
 * goes: now, or on a day. What is filled in here is on the sign-up page for
 * the hire to confirm; only what changed is saved, a section at a time.
 */
/** What an invitation cannot go without: who it is for, where it goes, who employs them. */
const NEEDED_TO_INVITE: ReadonlySet<string> = new Set([
  'given_name',
  'family_name',
  'work_email',
  'legal_entity_id',
]);

function SetUpDialog({
  name,
  sections,
  values,
  scheduledFor,
  onSave,
  onClose,
  onDone,
}: {
  readonly name: string;
  readonly sections: readonly RecordSection[];
  readonly values: Values;
  readonly scheduledFor: string | null;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  readonly onClose: () => void;
  /** Saved: send or schedule. A message when that failed. */
  readonly onDone: (applied: Values, sendOn: string | null) => Promise<string | null>;
}): JSX.Element {
  const [draft, setDraft] = useState<Values>(values);
  const [when, setWhen] = useState<'now' | 'on'>(scheduledFor === null ? 'now' : 'on');
  const [day, setDay] = useState<string | null>(scheduledFor);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = sections
    .map((section) => ({ section, fields: section.fields.filter(fillable) }))
    .filter((x) => x.fields.length > 0);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    let applied: Values = {};
    for (const { section, fields } of shown) {
      const changed = Object.fromEntries(
        fields
          .filter(
            (f) => JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(values[f.key] ?? null),
          )
          .map((f) => [f.key, draft[f.key] ?? null]),
      ) as Values;
      if (Object.keys(changed).length === 0) continue;
      // One section after another: a refusal stops here, with what went before kept.
      const outcome = await onSave(section.key, changed);
      if (!outcome.ok) {
        setBusy(false);
        setProblem(`${section.label}: ${outcome.message}`);
        return;
      }
      // A value sent for approval is not the record's yet (PEO-077).
      const held = new Set(outcome.held ?? []);
      applied = {
        ...applied,
        ...Object.fromEntries(
          Object.entries(changed).filter(
            ([k]) => !held.has(fields.find((f) => f.key === k)?.label ?? k),
          ),
        ),
      };
    }
    const failed = await onDone(applied, when === 'on' ? day : null);
    setBusy(false);
    if (failed !== null) setProblem(failed);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent sheetOnTouch>
        <DialogHeader>
          <DialogTitle>
            {t('profile.invitation.set_up_title', 'Set up {{name}} and invite them', { name })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'profile.invitation.set_up_description',
              'Fill in what you know. {{name}} sees it on the sign-up page, confirms it and adds the rest.',
              { name },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-6">
          {shown.map(({ section, fields }) => (
            <section key={section.key} className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-fg-muted">{section.label}</h3>
              {fields.map((field) => (
                <AttributeInput
                  key={field.key}
                  // Asked of HR here only what an invitation cannot go without;
                  // the rest is filled in now or later, by HR or by them.
                  field={{
                    ...field,
                    required: field.required && NEEDED_TO_INVITE.has(field.key),
                    missing: false,
                  }}
                  value={draft[field.key] ?? null}
                  onChange={(next) => {
                    setDraft((d) => ({ ...d, [field.key]: next }));
                  }}
                />
              ))}
            </section>
          ))}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg-muted">
              {t('profile.invitation.when_it_goes', 'When the invitation goes')}
            </h3>
            <SegmentedControl
              aria-label={t('profile.invitation.when_it_goes', 'When the invitation goes')}
              value={when}
              onValueChange={(next) => {
                if (next === 'now' || next === 'on') setWhen(next);
              }}
            >
              <SegmentedControlItem value="now">
                {t('profile.invitation.now', 'Now')}
              </SegmentedControlItem>
              <SegmentedControlItem value="on">
                {t('profile.invitation.on_a_day', 'On a day')}
              </SegmentedControlItem>
            </SegmentedControl>
            {when === 'on' ? (
              <DatePicker
                label={t('profile.invitation.send_it_on', 'Send it on')}
                value={day}
                onChange={setDay}
              />
            ) : null}
          </section>
          {problem === null ? null : (
            <Alert tone="danger" title={t('profile.invitation.not_sent_title', 'Not sent')}>
              {problem}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('profile.invitation.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={when === 'on' && day === null}
            startIcon={<icons.email aria-hidden />}
            onClick={() => {
              void submit();
            }}
          >
            {when === 'now'
              ? t('profile.invitation.save_and_send', 'Save and send')
              : t('profile.invitation.save_and_schedule', 'Save and schedule')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
