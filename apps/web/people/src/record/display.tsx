import { Badge, Money } from '@reach/ui';
import type { JSX } from 'react';

import { isMissing, type AttributeValue, type RecordField } from './model';

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' });

/**
 * One value, read-only, the way a person reads it.
 *
 * Money goes through `Money` from minor units, never a float. An encrypted
 * value shows its last four and says it is encrypted; the plaintext is not in
 * the view model to show. A readable field with nothing in it says so in words,
 * never a blank, because a blank is ambiguous between "not held" and "not
 * printed" (§15.4).
 */
export function DisplayValue({
  field,
  value,
}: {
  readonly field: RecordField;
  readonly value: AttributeValue | undefined;
}): JSX.Element {
  if (value === undefined || value === null || isMissing(value)) {
    return <span className="text-fg-muted">Not provided</span>;
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value === 'string') {
    const option = field.options.find((o) => o.value === value);
    if (option !== undefined) return <>{option.label}</>;
    if (field.dataType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return <>{date.format(Date.parse(`${value}T00:00:00Z`))}</>;
    }
    return <>{value}</>;
  }
  if ('amountMinor' in value) {
    return <Money minorUnits={value.amountMinor} currency={value.currency} />;
  }
  if ('last4' in value) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono">{value.last4 === null ? '••••' : `•••• ${value.last4}`}</span>
        <Badge size="sm">Encrypted</Badge>
      </span>
    );
  }
  return <>{value.map((v) => field.options.find((o) => o.value === v)?.label ?? v).join(', ')}</>;
}
