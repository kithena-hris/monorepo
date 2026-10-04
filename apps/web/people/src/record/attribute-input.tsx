import {
  Combobox,
  CurrencyField,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  InlineCell,
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
  type ComboboxProps,
} from '@reach/ui';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLInputTypeAttribute,
  type InputHTMLAttributes,
  type JSX,
  type KeyboardEvent,
} from 'react';

import { FileInput, isFileField } from './files';
import { isMissing, type AttributeValue, type RecordField } from './model';
import { SensitiveMark } from './pending';

/** The `type` a line of text takes for each data type that is one. */
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
  // A form gives these a box of several lines; a grid cell has room for one.
  long_text: 'text',
  address: 'text',
};

/** Types whose value is typed exactly, never capitalised or corrected. */
const VERBATIM = new Set<RecordField['dataType']>([
  'email',
  'url',
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
  'org_unit_ref',
  'legal_entity_ref',
  'location_ref',
]);

/** Past this many choices a list is searched (`Combobox`) rather than scrolled (`Select`). */
const SEARCHED_FROM = 15;

/**
 * What a line of text takes for a data type: its `type`, the keyboard a phone
 * offers, autofill, and no correcting of a value typed exactly. The same for a
 * form's `Input` and a grid's `InlineCell`, so neither forgets.
 */
function lineProps(
  dataType: RecordField['dataType'],
):
  | Pick<
      InputHTMLAttributes<HTMLInputElement>,
      'type' | 'inputMode' | 'autoCapitalize' | 'autoCorrect' | 'spellCheck' | 'autoComplete'
    >
  | undefined {
  const type = INPUT_TYPE[dataType];
  if (type === undefined) return undefined;
  return {
    type,
    ...(VERBATIM.has(dataType)
      ? { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }
      : {}),
    ...(dataType === 'decimal' || dataType === 'percentage'
      ? { inputMode: 'decimal' as const }
      : {}),
    ...(dataType === 'email' ? { autoComplete: 'email' } : {}),
    ...(dataType === 'address' ? { autoComplete: 'street-address' } : {}),
  };
}

const text = (value: AttributeValue): string => (typeof value === 'string' ? value : '');

type Option = { readonly value: string; readonly label: string };

/**
 * Finds people by name, a page at a time, as the viewer may read them
 * (PEO-122). The shell supplies it; a screen without it picks from the
 * options it was handed.
 */
export type SearchPeople = (text: string) => Promise<readonly Option[]>;

export const PeopleSearch = createContext<SearchPeople | null>(null);

/**
 * A person picked by typing their name: People searches everybody, so the
 * 50,000th person is as reachable as the first. `known` names whoever is
 * already chosen, so the trigger reads a name rather than an id. Inside a
 * `FieldControl`, the field's label and description reach the trigger.
 */
export function PersonPicker({
  label,
  value,
  known,
  disabled = false,
  size = 'md',
  onChange,
  ...control
}: Pick<ComboboxProps, 'id' | 'aria-describedby' | 'aria-invalid'> & {
  readonly label: string;
  readonly value: string;
  readonly known: readonly Option[];
  readonly disabled?: boolean;
  readonly size?: 'sm' | 'md';
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const search = useContext(PeopleSearch);
  const [found, setFound] = useState<readonly Option[]>([]);
  const [chosen, setChosen] = useState<Option | null>(null);
  const [loading, setLoading] = useState(false);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const find = (query: string): void => {
    if (search === null) return;
    clearTimeout(timer.current);
    const turn = ++asked.current;
    setLoading(true);
    // One request per pause in typing, and only the latest answer is drawn.
    timer.current = setTimeout(() => {
      void search(query)
        .catch(() => [])
        .then((options) => {
          if (turn !== asked.current) return;
          setFound(options);
          setLoading(false);
        });
    }, 200);
  };

  const options = [...known, ...(chosen === null ? [] : [chosen]), ...found].filter(
    (o, i, all) => all.findIndex((x) => x.value === o.value) === i,
  );
  return (
    <Combobox
      {...control}
      label={label}
      options={options}
      value={value === '' ? null : value}
      disabled={disabled}
      size={size}
      placeholder="Choose a person"
      searchPlaceholder="Type a name"
      emptyMessage={search === null ? 'No matches.' : 'Nobody by that name.'}
      loading={loading}
      {...(search === null ? {} : { onSearchChange: find })}
      onChange={(next) => {
        const id = typeof next === 'string' ? next : '';
        setChosen(options.find((o) => o.value === id) ?? null);
        onChange(id);
      }}
    />
  );
}

/** Where a control is drawn in a grid: small, and a line of text is the sheet's own cell. */
export interface CellPlace {
  readonly id?: string;
  /** Our checks doubt it (PEO-125): marked, and said with the cell. */
  readonly warning?: string | undefined;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * One attribute's bare control, chosen by its data type: the one mapping from
 * a field's type to what is drawn to fill it in, for a form (inside a
 * `FieldControl`, which hands it `id` and the descriptions) and for a grid
 * cell (`cell`, named by `label`, at the small size).
 *
 * | data type | control |
 * | --- | --- |
 * | date | `DatePicker` |
 * | select, country, currency, language, time zone, an org reference | `Select`; `Combobox`, searched, past 15 choices; disabled and said when People sent none |
 * | multi_select | `Combobox` with `multiple` |
 * | tags | `TagsInput` |
 * | person_ref | `PersonPicker`, searching People |
 * | boolean | `Switch` |
 * | money | `CurrencyField` in the field's currency |
 * | phone | `PhoneField` |
 * | long_text, address | `Textarea` (one line in a cell) |
 * | number, decimal, percentage | a line with the number keypad |
 * | email, url, national_id, bank_account | a line typed exactly, never corrected |
 * | text, duration, datetime | a line of their own `type` |
 *
 * Every control is Reach's, so the phone-keyboard work — `inputMode`,
 * `autoComplete`, verbatim entry — comes from the type rather than from each
 * screen remembering it (§8.3). Null for a type with no control of its own
 * here (a file, which `AttributeInput` uploads).
 */
export function AttributeControl({
  field,
  value,
  onChange,
  label,
  cell,
  disabled = false,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  readonly field: RecordField;
  readonly value: AttributeValue;
  readonly onChange: (value: AttributeValue) => void;
  /** What the control is called; in a form, the `FieldLabel` names it as well. */
  readonly label: string;
  readonly cell?: CellPlace;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly 'aria-required'?: boolean;
}): JSX.Element | null {
  const size = cell === undefined ? 'md' : 'sm';
  const named = cell === undefined ? {} : { 'aria-label': label };
  const invalid = ariaInvalid ?? (cell?.warning === undefined ? undefined : true);
  // Only what was given: an absent id is no id at all, not `id={undefined}`.
  const control: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean } = {};
  const controlId = id ?? cell?.id;
  if (controlId !== undefined) control.id = controlId;
  if (describedBy !== undefined) control['aria-describedby'] = describedBy;
  if (invalid !== undefined) control['aria-invalid'] = invalid;
  switch (field.dataType) {
    case 'date':
      return (
        <DatePicker
          {...control}
          label={label}
          size={size}
          value={typeof value === 'string' && value !== '' ? value : null}
          disabled={disabled}
          {...(cell === undefined ? {} : { placeholder: 'Missing' })}
          onChange={(next) => {
            onChange(next);
          }}
        />
      );
    case 'multi_select':
      return (
        <Combobox
          {...control}
          multiple
          chips={cell === undefined}
          label={label}
          size={size}
          options={field.options}
          value={Array.isArray(value) ? (value as readonly string[]) : []}
          disabled={disabled}
          placeholder={cell === undefined ? 'Choose' : 'Missing'}
          onChange={(next) => {
            onChange(Array.isArray(next) ? (next as readonly string[]) : []);
          }}
        />
      );
    case 'tags':
      return (
        <TagsInput
          label={label}
          hideLabel
          size={size}
          value={Array.isArray(value) ? (value as readonly string[]) : []}
          disabled={disabled}
          invalid={invalid === true}
          onChange={onChange}
        />
      );
    case 'boolean':
      return (
        <Switch
          {...control}
          {...named}
          aria-required={ariaRequired}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      );
    case 'person_ref':
      return (
        <PersonPicker
          {...control}
          label={label}
          size={size}
          value={text(value)}
          known={field.options}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'phone':
      return (
        <PhoneField
          {...control}
          aria-required={ariaRequired}
          label={label}
          size={size}
          autoComplete="tel"
          value={text(value)}
          disabled={disabled}
          onValueChange={(next) => {
            onChange(next);
          }}
        />
      );
    case 'money': {
      const currency =
        value !== null && typeof value === 'object' && 'currency' in value
          ? value.currency
          : (field.currency ?? 'EUR');
      return (
        <CurrencyField
          {...control}
          {...named}
          aria-required={ariaRequired}
          size={size}
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
    }
    default:
      break;
  }
  if (PICKED.has(field.dataType)) {
    const empty = field.options.length === 0;
    // A long list (countries, time zones, languages) is searched, not scrolled.
    if (field.options.length > SEARCHED_FROM) {
      return (
        <Combobox
          {...control}
          label={label}
          size={size}
          options={field.options}
          value={text(value) === '' ? null : text(value)}
          disabled={disabled}
          placeholder={cell === undefined ? 'Choose' : 'Missing'}
          searchPlaceholder="Type to search"
          onChange={(next) => {
            onChange(typeof next === 'string' ? next : null);
          }}
        />
      );
    }
    return (
      <Select
        value={text(value)}
        // A list with nothing in it says so rather than opening empty.
        disabled={disabled || empty}
        onValueChange={(next) => {
          onChange(next);
        }}
      >
        <SelectTrigger
          {...control}
          {...named}
          aria-required={ariaRequired}
          size={size}
          {...(cell === undefined ? {} : { className: 'min-w-32' })}
        >
          <SelectValue
            placeholder={empty ? 'Nothing to choose from' : cell === undefined ? 'Choose' : 'Missing'}
          />
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
  if (cell === undefined && (field.dataType === 'long_text' || field.dataType === 'address')) {
    return (
      <Textarea
        {...control}
        aria-required={ariaRequired}
        value={text(value)}
        disabled={disabled}
        {...(field.dataType === 'address' ? { autoComplete: 'street-address' } : {})}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    );
  }
  const line = lineProps(field.dataType);
  if (line === undefined) return null;
  if (cell !== undefined) {
    const shown = text(value);
    return (
      <InlineCell
        {...line}
        {...(control.id === undefined ? {} : { id: control.id })}
        aria-label={label}
        value={shown}
        disabled={disabled}
        {...(cell.warning !== undefined
          ? { status: 'invalid' as const, message: cell.warning }
          : shown === ''
            ? { status: 'missing' as const }
            : {})}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...(cell.onKeyDown === undefined ? {} : { onKeyDown: cell.onKeyDown })}
        containerClassName="min-w-32"
      />
    );
  }
  return (
    <Input
      {...line}
      {...control}
      aria-required={ariaRequired}
      value={text(value)}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}

/**
 * One attribute as a form field: its label, the control its data type takes
 * (`AttributeControl`), and what is said under it — required and missing, who
 * owns it, a doubt our checks raised, what is wrong with it. A document or an
 * image is uploaded as soon as it is chosen, where the shell supplies the
 * upload (`FieldFiles`).
 */
export function AttributeInput({
  field,
  value,
  problem,
  warning,
  onChange,
}: {
  readonly field: RecordField;
  readonly value: AttributeValue;
  readonly problem?: string | undefined;
  /** Our checks doubt this value; it can still be saved (PEO-125). */
  readonly warning?: string | undefined;
  readonly onChange: (value: AttributeValue) => void;
}): JSX.Element | null {
  const invalid = problem !== undefined;
  // A field this viewer reads but may not change is shown read-only with its
  // owner named, not hidden (§8.3).
  const owner =
    field.keptIn !== undefined
      ? `Kept in ${field.keptIn}; change it there.`
      : field.readOnly && field.ownedBy !== undefined
        ? `Changed by ${field.ownedBy}.`
        : null;
  // Required of this person and still empty: said in words, in the
  // description the control points at, so it is announced with the field.
  const gap =
    field.missing === true && isMissing(value)
      ? field.readOnly
        ? `${field.ownedBy ?? 'HR'} fills this in.`
        : 'Required, and not provided yet.'
      : null;
  const note = [gap, field.description, owner].filter((x) => x !== null).join(' ');
  // A caution about a value that was accepted (PEO-125) is read with the
  // field's own help, in the one description the control points at.
  const described =
    warning !== undefined || gap !== null ? (
      <FieldDescription tone="warning">
        {[note, warning ?? ''].filter((x) => x !== '').join(' ')}
      </FieldDescription>
    ) : note === '' ? null : (
      <FieldDescription>{note}</FieldDescription>
    );
  const disabled = field.readOnly;

  // An image or a document: chosen, uploaded, and held as the file's id.
  if (isFileField(field)) {
    return (
      <FileInput
        field={field}
        value={typeof value === 'string' && value !== '' ? value : null}
        invalid={invalid}
        description={[note, problem ?? ''].filter((x) => x !== '').join(' ')}
        onChange={onChange}
      />
    );
  }

  // A list of free entries carries its own label and hint.
  if (field.dataType === 'tags') {
    return (
      <div className="flex flex-col gap-1.5">
        <SensitiveMark field={field} />
        <TagsInput
          label={field.required ? `${field.label} (required)` : field.label}
          value={Array.isArray(value) ? (value as readonly string[]) : []}
          disabled={disabled}
          invalid={invalid}
          hint={problem ?? field.description ?? undefined}
          onChange={onChange}
        />
      </div>
    );
  }

  return (
    <Field
      {...(field.dataType === 'boolean' ? { orientation: 'horizontal' as const } : {})}
      invalid={invalid}
      disabled={disabled}
      required={field.required}
      missing={gap !== null}
      sensitive={field.sensitive === true}
    >
      <FieldLabel>{field.label}</FieldLabel>
      <FieldControl>
        <AttributeControl
          field={field}
          value={value}
          label={field.label}
          disabled={disabled}
          onChange={onChange}
        />
      </FieldControl>
      {described}
      <FieldError>{problem}</FieldError>
    </Field>
  );
}
