import { Alert, Button, Stack } from '@reach/ui';
import type { JSX } from 'react';
import { t } from '../i18n';

/**
 * A person's doubted identifiers still open (PEO-125), as the record shows
 * them: one HR could not accept is theirs to correct, with HR's reason; one
 * with HR is only a note. Never the value, and never on a field the viewer
 * cannot read — People left those out before this arrived.
 */
export interface IdentifierReview {
  readonly key: string;
  readonly label: string;
  readonly state: 'pending' | 'sent_back';
  readonly findings: readonly {
    readonly level: string;
    readonly code: string;
    readonly message: string;
  }[];
  /** Why HR could not accept it, as they wrote it. */
  readonly note: string | null;
}

/** "Wrong letter" and "Wrong letter." both read as one sentence. */
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

export function ReviewNotices({
  reviews,
  onCorrect,
}: {
  readonly reviews: readonly IdentifierReview[] | undefined;
  /** Open the field to correct it. Absent where the viewer cannot edit here. */
  readonly onCorrect?: (key: string) => void;
}): JSX.Element | null {
  if (reviews === undefined || reviews.length === 0) return null;
  return (
    <Stack gap={3}>
      {reviews.map((r) =>
        r.state === 'sent_back' ? (
          <Alert
            key={r.key}
            tone="warning"
            title={t(
              'record.review-notices.hr_could_not_accept_your',
              'HR could not accept your {{label}}',
              { label: r.label },
            )}
            action={
              onCorrect === undefined ? undefined : (
                <Button
                  size="sm"
                  aria-label={t('record.review-notices.correct', 'Correct {{label}}', {
                    label: r.label,
                  })}
                  onClick={() => {
                    onCorrect(r.key);
                  }}
                >
                  {t('record.review-notices.correct_it', 'Correct it')}
                </Button>
              )
            }
          >
            {r.note === null
              ? t(
                  'record.review-notices.please_check_it_against_the_original',
                  'Please check it against the original document and correct it.',
                )
              : t('record.review-notices.please_correct_it', '{{sentence}} Please correct it.', {
                  sentence: sentence(r.note),
                })}{' '}
            {r.findings.map((f) => f.message).join(' ')}
          </Alert>
        ) : (
          <Alert
            key={r.key}
            tone="info"
            title={t(
              'record.review-notices.is_with_hr_for_review',
              '{{label}} is with HR for review',
              { label: r.label },
            )}
          >
            {r.findings.map((f) => f.message).join(' ')}{' '}
            {t(
              'record.review-notices.whatever_hr_decides_is_final',
              'Whatever HR decides is final.',
            )}
          </Alert>
        ),
      )}
    </Stack>
  );
}
