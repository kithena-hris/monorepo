import { Alert, Stack } from '@reach/ui';
import type { JSX } from 'react';

/**
 * A person's doubted identifiers still open (PEO-125), as the record shows
 * them: one HR sent back is theirs to correct; one with HR is only a note.
 * Never the value, and never on a field the viewer cannot read — People left
 * those out before this arrived.
 */
export interface IdentifierReview {
  readonly key: string;
  readonly label: string;
  readonly state: 'pending' | 'sent_back';
  readonly findings: readonly { readonly level: string; readonly code: string; readonly message: string }[];
  /** What HR wrote when sending it back. */
  readonly note: string | null;
}

export function ReviewNotices({
  reviews,
}: {
  readonly reviews: readonly IdentifierReview[] | undefined;
}): JSX.Element | null {
  if (reviews === undefined || reviews.length === 0) return null;
  return (
    <Stack gap={3}>
      {reviews.map((r) =>
        r.state === 'sent_back' ? (
          <Alert key={r.key} tone="warning" title={`HR asked for ${r.label} to be corrected`}>
            {r.note ?? 'Please check it against the original document and save it again.'}{' '}
            {r.findings.map((f) => f.message).join(' ')}
          </Alert>
        ) : (
          <Alert key={r.key} tone="info" title={`${r.label} is with HR for review`}>
            {r.findings.map((f) => f.message).join(' ')} Whatever HR decides is final.
          </Alert>
        ),
      )}
    </Stack>
  );
}
