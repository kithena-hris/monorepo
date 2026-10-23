import { AssistantCard, Badge, Button, Spinner, icons } from '@reach/ui';
import { useState, type JSX } from 'react';

import { shortDate } from '../shared';
import type { Read } from '../types';
import { t } from '../i18n';

/**
 * A certificate that unlocks leave (J4): the event it records and its date,
 * each with its page, and the leave of your own it entitles you to, asked
 * for on Time Off's own request page from that day. The record's details it
 * changes are the answers card's (J1).
 */

export interface CertificateLeave {
  readonly event: string | null;
  readonly date: string | null;
  readonly page: number | null;
  readonly leaveType: { readonly key: string; readonly name: string } | null;
}

export interface CertificateProps {
  readonly onCertificateLeave?:
    ((documentId: string) => Promise<Read<CertificateLeave>>) | undefined;
}

export function Certificate({
  documentId,
  onCertificateLeave,
  onNavigate,
}: {
  readonly documentId: string;
  readonly onNavigate?: ((href: string) => void) | undefined;
} & CertificateProps): JSX.Element | null {
  const [read, setRead] = useState<Read<CertificateLeave> | 'reading' | null>(null);
  if (onCertificateLeave === undefined) return null;
  if (read === null) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        startIcon={<icons.leave aria-hidden />}
        onClick={() => {
          setRead('reading');
          void onCertificateLeave(documentId).then(setRead);
        }}
      >
        {t(
          'document.certificate.leave_this_certificate_entitles_you_to',
          'Leave this certificate entitles you to',
        )}
      </Button>
    );
  }
  if (read === 'reading')
    return (
      <Spinner
        size="sm"
        label={t(
          'document.certificate.kithena_is_reading_the_certificate',
          'Kithena is reading the certificate',
        )}
      />
    );
  if (!read.ok) return <p className="text-sm text-danger-fg">{read.message}</p>;
  const { event, date, page, leaveType } = read.data;
  const href =
    leaveType === null
      ? null
      : `/time-off/request?type=${encodeURIComponent(leaveType.key)}${date === null ? '' : `&from=${date}`}`;
  return (
    <AssistantCard
      title={t(
        'document.certificate.what_this_certificate_unlocks',
        'What this certificate unlocks',
      )}
      level={2}
      note={t('document.certificate.read_for_you_alone', 'Read for you alone.')}
    >
      <p className="text-sm">
        {event === null
          ? t('document.certificate.it_does_not_say_what_it', 'It does not say what it records.')
          : event}
        {date === null ? '' : ` · ${shortDate(date)}`}{' '}
        {page === null ? null : (
          <Badge size="sm" tone="neutral">
            {t('document.certificate.p', 'p. {{page}}', { page: String(page) })}
          </Badge>
        )}
      </p>
      {href === null || leaveType === null ? (
        <p className="text-sm text-fg-muted">
          {t(
            'document.certificate.none_of_your_leave_types_is',
            'None of your leave types is for it.',
          )}
        </p>
      ) : (
        <Button variant="primary" size="sm" className="self-start" asChild>
          <a
            href={href}
            onClick={(e) => {
              if (onNavigate === undefined) return;
              e.preventDefault();
              onNavigate(href);
            }}
          >
            {t('document.certificate.request', 'Request {{name}}{{value}}', {
              name: leaveType.name,
              value: date === null ? '' : ` from ${shortDate(date)}`,
            })}
          </a>
        </Button>
      )}
    </AssistantCard>
  );
}
