import { Badge, Button } from '@reach/ui';
import type { JSX } from 'react';

import type { Outcome } from '../load';
import { DisplayValue, longDate } from './display';
import type { PendingValue, RecordField } from './model';

/**
 * A value waiting for HR's approval, beside the field it would change
 * (PEO-077). Never in place of the value: the record reads what is in force,
 * and this says what is asked for, from when, by whom, and until when it
 * waits. Its requester may take it back here.
 */
export function PendingNote({
  field,
  pending,
  onWithdraw,
}: {
  readonly field: RecordField;
  readonly pending: PendingValue;
  readonly onWithdraw?: ((changeId: string) => Promise<Outcome>) | undefined;
}): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <Badge tone="warning" size="sm">
        Pending approval
      </Badge>
      <span>
        {pending.kind === 'correction' ? 'Correction to ' : ''}
        <DisplayValue field={field} value={pending.value} />, from {longDate(pending.effectiveFrom)}
        , asked by {pending.requestedBy}; waits until {longDate(pending.expiresAt.slice(0, 10))}.
      </span>
      {pending.mine && onWithdraw !== undefined ? (
        <Button
          size="sm"
          aria-label={`Withdraw the change to ${field.label}`}
          onClick={() => {
            void onWithdraw(pending.id);
          }}
        >
          Withdraw
        </Button>
      ) : null}
    </span>
  );
}

/** The sensitive marker beside a label drawn outside a `Field` (PEO-077). */
export function SensitiveMark({ field }: { readonly field: RecordField }): JSX.Element | null {
  return field.sensitive === true ? (
    <Badge tone="sensitive" size="sm">
      Sensitive
    </Badge>
  ) : null;
}
