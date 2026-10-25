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
  icons,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { t } from '../i18n';
import { longDate } from '../record/display';

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
    { readonly ok: true; readonly invitation: Invitation } | { readonly ok: false; readonly message: string }
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
}: {
  readonly name: string;
  readonly email: string;
  readonly startsOn: string | null;
  readonly actions: InvitationActions;
}): JSX.Element | null {
  const [invitation, setInvitation] = useState<Invitation | null | 'loading'>('loading');
  const [sendOn, setSendOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  useEffect(() => {
    let live = true;
    void actions.read(email).then((found) => {
      if (live) setInvitation(found);
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
      setSendOn(null);
    });
  };
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
            loading={sending}
            startIcon={<icons.email aria-hidden />}
            onClick={() => {
              send(null);
            }}
          >
            {invitation.state === 'invited'
              ? t('profile.invitation.send_again', 'Send it again')
              : t('profile.invitation.send_now', 'Send the invitation now')}
          </Button>
          {invitation.state === 'invited' ? null : (
            <>
              <DatePicker
                label={t('profile.invitation.or_on', 'Or send it on')}
                value={sendOn ?? invitation.sendOn}
                onChange={(d) => {
                  setSendOn(d);
                }}
              />
              <Button
                variant="secondary"
                disabled={sendOn === null}
                loading={sending}
                onClick={() => {
                  send(sendOn);
                }}
              >
                {t('profile.invitation.schedule', 'Schedule')}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
