import { cn, dateFormat, Money, Text } from '@reach/ui-native';

import { isEmpty, type RecordField, type Value } from './api';
import { t } from '../i18n';

const date = dateFormat({ dateStyle: 'long', timeZone: 'UTC' });

/** A calendar date, "14 March 1994": a date has no zone, so it is read as UTC. */
export const longDate = (iso: string): string => date.format(Date.parse(`${iso}T00:00:00Z`));

/**
 * One value, read-only, as the web's `DisplayValue` draws it: money from minor
 * units, an encrypted value masked to its last four, an option by its label,
 * a date in words. Nothing held says so in words, never a blank.
 */
export function DisplayValue({
  field,
  value,
  className,
}: {
  field: RecordField;
  value: Value | undefined;
  /** Placement and emphasis from where it is drawn: struck through, in a history. */
  className?: string | undefined;
}): React.JSX.Element {
  if (value === undefined || isEmpty(value)) {
    return (
      <Text tone="subtle" className={className}>
        {t('people.display.not_provided_yet', 'Not provided yet')}
      </Text>
    );
  }
  if (typeof value === 'boolean')
    return (
      <Text weight="medium" className={className}>
        {value ? t('people.display.yes', 'Yes') : t('people.display.no', 'No')}
      </Text>
    );
  // A signature is drawn where it is signed; here, only whether there is one.
  if (field.dataType === 'signature' && typeof value === 'string' && value !== '') {
    return (
      <Text weight="medium" className={className}>
        {t('people.display.on_file', 'On file')}
      </Text>
    );
  }
  if (typeof value === 'string') {
    const option = field.options.find((o) => o.value === value);
    const shown =
      option?.label ??
      (field.dataType === 'date' && value === 'indefinite'
        ? 'Indefinite'
        : field.dataType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? longDate(value)
          : value);
    return (
      <Text weight="medium" className={className}>
        {shown}
      </Text>
    );
  }
  if (value !== null && 'amountMinor' in value) {
    return <Money minorUnits={value.amountMinor} currency={value.currency} className={className} />;
  }
  if (value !== null && 'last4' in value) {
    // Masked as People sent it: the plaintext is not here to show.
    return (
      <Text weight="medium" className={cn('font-mono tracking-widest', className)}>
        {value.last4 === null ? '••••' : `•••• ${value.last4}`}
      </Text>
    );
  }
  return (
    <Text weight="medium" className={className}>
      {(value as readonly string[])
        .map((v) => field.options.find((o) => o.value === v)?.label ?? v)
        .join(', ')}
    </Text>
  );
}
