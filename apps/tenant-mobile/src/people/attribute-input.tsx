import {
  Combobox,
  CurrencyField,
  DatePicker,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TagsInput,
  Textarea,
  type InputType,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';

import { ask, useSigned, type RecordField, type Value } from './api';

/** Types typed on one line, and the keyboard each wants (the web's `INPUT_TYPE`). */
const LINE: Partial<Record<string, InputType>> = {
  text: 'text',
  number: 'number',
  decimal: 'decimal',
  percentage: 'decimal',
  email: 'email',
  phone: 'tel',
  url: 'url',
  national_id: 'iban',
  bank_account: 'iban',
  datetime: 'text',
  duration: 'duration',
};

/** Types chosen from a list People supplies: the list types and the references. */
const PICKED = new Set([
  'select',
  'country',
  'currency',
  'language',
  'time_zone',
  'org_unit_ref',
  'legal_entity_ref',
  'location_ref',
]);

/** Past this many choices a list is searched rather than scrolled, as on the web. */
const SEARCHED_FROM = 15;

const text = (value: Value | undefined): string => (typeof value === 'string' ? value : '');

/**
 * A person, picked by typing their name: People searches everybody it lets
 * this viewer read (`PeoplePicker`), so the 50,000th person is as reachable as
 * the first. The field's own options name whoever is chosen already.
 */
function PersonPicker({
  field,
  value,
  onChange,
  disabled,
}: {
  field: RecordField;
  value: string;
  onChange: (value: string | null) => void;
  disabled: boolean;
}): React.JSX.Element {
  const signed = useSigned();
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState(field.options);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void ask<{ options: { value: string; label: string }[] }>(signed, 'PeoplePicker', {
        search: search.slice(0, 200),
      }).then((answer) => {
        if (!live) return;
        setLoading(false);
        if (answer.ok) {
          // Whoever is chosen stays nameable while the list shows others.
          const chosen = field.options.filter((o) => o.value === value);
          setOptions([...chosen, ...answer.data.options.filter((o) => o.value !== value)]);
        }
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [signed, search, field.options, value]);
  return (
    <Combobox
      label={field.label}
      options={options}
      value={value === '' ? null : value}
      onChange={(next) => {
        onChange(typeof next === 'string' ? next : null);
      }}
      onSearchChange={setSearch}
      loading={loading}
      placeholder="Choose a person"
      searchPlaceholder="Type a name"
      disabled={disabled}
      clearable
    />
  );
}

/** The control a field's data type takes, holding the value as the web's form does. */
function Control({
  field,
  value,
  onChange,
  disabled,
}: {
  field: RecordField;
  value: Value | undefined;
  onChange: (value: Value) => void;
  disabled: boolean;
}): React.JSX.Element {
  switch (field.dataType) {
    case 'date':
      return (
        <DatePicker
          label={field.label}
          value={text(value) === '' ? null : text(value)}
          onChange={(next) => {
            onChange(next);
          }}
          disabled={disabled}
        />
      );
    case 'boolean':
      return (
        <Switch
          checked={value === true}
          onCheckedChange={onChange}
          disabled={disabled}
          accessibilityLabel={field.label}
        />
      );
    case 'multi_select':
      return (
        <Combobox
          label={field.label}
          multiple
          chips
          options={field.options}
          value={Array.isArray(value) ? value : []}
          onChange={(next) => {
            onChange(Array.isArray(next) ? [...(next as readonly string[])] : []);
          }}
          placeholder="Choose"
          disabled={disabled}
        />
      );
    case 'tags':
      return (
        <TagsInput
          label={field.label}
          hideLabel
          value={Array.isArray(value) ? value : []}
          onChange={(next) => {
            onChange([...next]);
          }}
          disabled={disabled}
        />
      );
    case 'person_ref':
      return (
        <PersonPicker field={field} value={text(value)} onChange={onChange} disabled={disabled} />
      );
    case 'money': {
      const money =
        value !== null && value !== undefined && typeof value === 'object' && 'amountMinor' in value
          ? value
          : { amountMinor: '', currency: field.currency ?? 'EUR' };
      return (
        <CurrencyField
          value={money.amountMinor}
          currency={money.currency === '' ? (field.currency ?? 'EUR') : money.currency}
          onValueChange={(amountMinor) => {
            onChange(
              amountMinor === ''
                ? null
                : { amountMinor, currency: money.currency || (field.currency ?? 'EUR') },
            );
          }}
          disabled={disabled}
        />
      );
    }
    case 'long_text':
    case 'address':
      return (
        <Textarea
          value={text(value)}
          onChange={onChange}
          disabled={disabled}
          {...(field.dataType === 'address'
            ? {
                autoComplete: 'street-address' as const,
                textContentType: 'fullStreetAddress' as const,
              }
            : {})}
        />
      );
    default:
      break;
  }
  if (PICKED.has(field.dataType)) {
    if (field.options.length > SEARCHED_FROM) {
      return (
        <Combobox
          label={field.label}
          options={field.options}
          value={text(value) === '' ? null : text(value)}
          onChange={(next) => {
            onChange(typeof next === 'string' ? next : null);
          }}
          placeholder="Choose"
          searchPlaceholder="Type to search"
          disabled={disabled}
        />
      );
    }
    const empty = field.options.length === 0;
    return (
      <Select value={text(value)} onValueChange={onChange} disabled={disabled || empty}>
        <SelectTrigger accessibilityLabel={field.label}>
          <SelectValue placeholder={empty ? 'Nothing to choose from' : 'Choose'} />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  // A sealed value's plaintext is not here: typing replaces it, leaving it keeps it.
  const sealed =
    value !== null && value !== undefined && typeof value === 'object' && 'last4' in value
      ? value
      : null;
  return (
    <Input
      type={LINE[field.dataType] ?? 'text'}
      value={sealed === null ? text(value) : ''}
      onChange={onChange}
      disabled={disabled}
      {...(sealed === null
        ? {}
        : { placeholder: sealed.last4 === null ? '••••' : `•••• ${sealed.last4}` })}
    />
  );
}

/**
 * One field as a form field: its label, its control, and what is said under
 * it — required, who owns it when this viewer cannot change it, a doubt the
 * checks raised, a problem. As the web's `AttributeInput`.
 */
export function AttributeInput({
  field,
  value,
  onChange,
  warning,
  problem,
}: {
  field: RecordField;
  value: Value | undefined;
  onChange: (value: Value) => void;
  warning?: string | undefined;
  problem?: string | undefined;
}): React.JSX.Element {
  const kept = field.keptIn === null ? null : `Kept in ${field.keptIn}: change it there.`;
  const owned = field.readOnly
    ? field.ownedBy === null
      ? 'You can see this but not change it.'
      : `Changed by ${field.ownedBy}.`
    : null;
  const hint = kept ?? owned ?? field.description;
  return (
    <Field
      invalid={problem !== undefined}
      required={field.required}
      disabled={field.readOnly || field.keptIn !== null}
      sensitive={field.sensitive === true}
    >
      <FieldLabel>{field.label}</FieldLabel>
      <Control
        field={field}
        value={value}
        onChange={onChange}
        disabled={field.readOnly || field.keptIn !== null}
      />
      {warning === undefined ? null : <FieldDescription tone="warning">{warning}</FieldDescription>}
      {hint === null ? null : <FieldDescription>{hint}</FieldDescription>}
      {problem === undefined ? null : <FieldError>{problem}</FieldError>}
    </Field>
  );
}
