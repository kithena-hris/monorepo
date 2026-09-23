import {
  CurrencyField,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PhoneField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TagsInput,
  Textarea,
} from '@reach/ui';
import type { HTMLInputTypeAttribute, JSX } from 'react';

import type { AttributeValue, RecordField } from './model';

/** The `type` a plain text input takes for each data type that is one. */
const INPUT_TYPE: Partial<Record<RecordField['dataType'], HTMLInputTypeAttribute>> = {
  text: 'text',
  email: 'email',
  url: 'url',
  number: 'number',
  decimal: 'text',
  percentage: 'text',
  duration: 'text',
  national_id: 'text',
  bank_account: 'text',
  datetime: 'datetime-local',
};

/** Types whose value is typed exactly, never capitalised or corrected. */
const VERBATIM = new Set<RecordField['dataType']>([
  'national_id',
  'bank_account',
  'decimal',
  'percentage',
]);

/** Types chosen from a list the shell supplies: the list types and the references. */
const PICKED = new Set<RecordField['dataType']>([
  'select',
  'country',
  'currency',
  'language',
  'time_zone',
  'person_ref',
  'org_unit_ref',
  'legal_entity_ref',
]);

const text = (value: AttributeValue): string => (typeof value === 'string' ? value : '');

/**
 * One attribute's control, chosen by its data type.
 *
 * Every control is Reach's, so the phone-keyboard work — `inputMode`,
 * `autoComplete`, verbatim entry — comes from the type rather than from each
 * form remembering it (§8.3). A type with no control of its own here (a
 * document, an image) is filled in on the profile rather than in a form.
 */
export function AttributeInput({
  field,
  value,
  problem,
  onChange,
}: {
  readonly field: RecordField;
  readonly value: AttributeValue;
  readonly problem?: string | undefined;
  readonly onChange: (value: AttributeValue) => void;
}): JSX.Element | null {
  const invalid = problem !== undefined;
  // A field this viewer reads but may not change is shown read-only with its
  // owner named, not hidden (§8.3).
  const owner =
    field.readOnly && field.ownedBy !== undefined ? `Changed by ${field.ownedBy}.` : null;
  const note = [field.description, owner].filter((x) => x !== null).join(' ');
  const described = note === '' ? null : <FieldDescription>{note}</FieldDescription>;
  const error = <FieldError>{problem}</FieldError>;
  const disabled = field.readOnly;

  // Controls that carry their own label: they are the whole field.
  if (field.dataType === 'date') {
    return (
      <div className="flex flex-col gap-1.5">
        <DatePicker
          label={field.required ? `${field.label} (required)` : field.label}
          value={typeof value === 'string' && value !== '' ? value : null}
          disabled={disabled}
          onChange={(next) => {
            onChange(next);
          }}
        />
        {field.description === null ? null : (
          <p className="text-xs text-fg-muted">{field.description}</p>
        )}
        {invalid ? <p className="text-xs text-danger-fg">{problem}</p> : null}
      </div>
    );
  }
  if (field.dataType === 'multi_select' || field.dataType === 'tags') {
    const allowed = new Set(field.options.map((o) => o.value));
    return (
      <TagsInput
        label={field.required ? `${field.label} (required)` : field.label}
        value={Array.isArray(value) ? (value as readonly string[]) : []}
        disabled={disabled}
        invalid={invalid}
        hint={problem ?? field.description ?? undefined}
        {...(field.dataType === 'multi_select'
          ? { validate: (v: string) => (allowed.has(v) ? null : 'Not one of the options.') }
          : {})}
        onChange={onChange}
      />
    );
  }

  let control: JSX.Element | null;
  if (field.dataType === 'boolean') {
    return (
      <Field
        orientation="horizontal"
        invalid={invalid}
        disabled={disabled}
        required={field.required}
      >
        <FieldLabel>{field.label}</FieldLabel>
        <FieldControl>
          <Switch checked={value === true} disabled={disabled} onCheckedChange={onChange} />
        </FieldControl>
        {described}
        {error}
      </Field>
    );
  } else if (PICKED.has(field.dataType)) {
    return (
      <Field invalid={invalid} disabled={disabled} required={field.required}>
        <FieldLabel>{field.label}</FieldLabel>
        <Select
          value={text(value)}
          disabled={disabled}
          onValueChange={(next) => {
            onChange(next);
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {described}
        {error}
      </Field>
    );
  } else if (field.dataType === 'long_text' || field.dataType === 'address') {
    control = (
      <Textarea
        value={text(value)}
        disabled={disabled}
        {...(field.dataType === 'address' ? { autoComplete: 'street-address' } : {})}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    );
  } else if (field.dataType === 'phone') {
    control = (
      <PhoneField
        value={text(value)}
        disabled={disabled}
        onValueChange={(next) => {
          onChange(next);
        }}
      />
    );
  } else if (field.dataType === 'money') {
    const currency =
      value !== null && typeof value === 'object' && 'currency' in value
        ? value.currency
        : (field.currency ?? 'EUR');
    control = (
      <CurrencyField
        currency={currency}
        value={
          value !== null && typeof value === 'object' && 'amountMinor' in value
            ? value.amountMinor
            : ''
        }
        disabled={disabled}
        onValueChange={(amountMinor) => {
          onChange(amountMinor === '' ? null : { amountMinor, currency });
        }}
      />
    );
  } else {
    const type = INPUT_TYPE[field.dataType];
    if (type === undefined) return null;
    control = (
      <Input
        type={type}
        value={text(value)}
        disabled={disabled}
        {...(VERBATIM.has(field.dataType)
          ? { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }
          : {})}
        {...(field.dataType === 'decimal' || field.dataType === 'percentage'
          ? { inputMode: 'decimal' as const }
          : {})}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    );
  }

  return (
    <Field invalid={invalid} disabled={disabled} required={field.required}>
      <FieldLabel>{field.label}</FieldLabel>
      <FieldControl>{control}</FieldControl>
      {described}
      {error}
    </Field>
  );
}
