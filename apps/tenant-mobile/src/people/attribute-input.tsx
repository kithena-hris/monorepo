import {
  Button,
  Combobox,
  CurrencyField,
  DatePicker,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Icon,
  Inline,
  Input,
  Select,
  SelectContent,
  SignatureInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  useToast,
  type InputType,
} from '@reach/ui-native';
import { useFonts } from 'expo-font';
import { ScanLine, Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { fullName } from '../account-card';
import { SIGNATURE_FACES } from '../signature-faces';
import { markOf } from '../signature-mark';
import { ask, useSigned, type RecordField, type Value } from './api';
import { ibanCheck, nifSuggestion } from './checks';
import { scanIdCard } from './readers';
import { uploadFile } from './media';

/** Types whose value is a file People keeps: uploaded when chosen, its id saved like any value. */
export const FILE_TYPES = new Set(['document_ref', 'image']);

/** A document or an image for a field: chosen, uploaded at once, its id the field's new value. */
function FilePicker({
  field,
  value,
  personId,
  onChange,
  disabled,
}: {
  field: RecordField;
  value: Value | undefined;
  personId: string | null;
  onChange: (value: Value) => void;
  disabled: boolean;
}): React.JSX.Element {
  const signed = useSigned();
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const held = typeof value === 'string' && value !== '';
  return (
    <Stack gap={2}>
      <Text tone={held ? 'default' : 'subtle'}>
        {chosen ?? (held ? 'A file is kept' : 'No file yet')}
      </Text>
      <Button
        size="sm"
        disabled={disabled}
        loading={busy}
        loadingLabel="Uploading"
        onPress={() => {
          setBusy(true);
          setProblem(null);
          void uploadFile(
            signed,
            personId,
            field.key,
            field.dataType === 'image' ? 'image' : 'document',
          ).then((up) => {
            setBusy(false);
            if (up === null) return;
            if (!up.ok) {
              setProblem(up.message);
              return;
            }
            setChosen(up.value.name);
            onChange(up.value.id);
          });
        }}
      >
        {held || chosen !== null ? 'Replace file' : 'Choose a file'}
      </Button>
      {problem === null ? null : (
        <Text variant="footnote" tone="danger">
          {problem}
        </Text>
      )}
    </Stack>
  );
}

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

/** Reach's `SignatureInput`, drawn in the handwriting faces once they are in. */
function SignatureField(props: React.ComponentProps<typeof SignatureInput>): React.JSX.Element {
  useFonts(SIGNATURE_FACES);
  return <SignatureInput {...props} />;
}

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
  personId,
}: {
  field: RecordField;
  value: Value | undefined;
  onChange: (value: Value) => void;
  disabled: boolean;
  personId: string | null;
}): React.JSX.Element {
  const signed = useSigned();
  if (FILE_TYPES.has(field.dataType)) {
    return (
      <FilePicker
        field={field}
        value={value}
        personId={personId}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  switch (field.dataType) {
    case 'signature':
      return (
        <SignatureField
          label={field.label}
          name={personId === null ? fullName(signed.person) : ''}
          value={markOf(text(value))}
          disabled={disabled}
          onChange={(mark) => {
            onChange(mark === null ? null : JSON.stringify(mark));
          }}
        />
      );
    case 'date': {
      // An open-ended date's answer when there is none: People's `INDEFINITE`.
      const indefinite = value === 'indefinite';
      const picker = (
        <DatePicker
          label={field.label}
          value={text(value) === '' || indefinite ? null : text(value)}
          {...(indefinite ? { placeholder: 'Indefinite' } : {})}
          onChange={(next) => {
            onChange(next);
          }}
          disabled={disabled}
        />
      );
      if (field.openEnded !== true) return picker;
      return (
        <Stack gap={2}>
          {picker}
          <Inline justify="between">
            <Text>No end date (indefinite)</Text>
            <Switch
              checked={indefinite}
              onCheckedChange={(on) => {
                onChange(on ? 'indefinite' : null);
              }}
              disabled={disabled}
              accessibilityLabel="No end date (indefinite)"
            />
          </Inline>
        </Stack>
      );
    }
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
 * "Scan your card" (v3 P15): the number read from a photo on the company's
 * own host, offered when typing it is the slow way. The photo isn't kept.
 */
export function ScanIdButton({ onValue }: { onValue: (value: string) => void }): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <View className="gap-1.5">
      <Button
        fullWidth
        startIcon={<Icon icon={ScanLine} />}
        loading={busy}
        loadingLabel="Reading the card"
        onPress={() => {
          setBusy(true);
          void scanIdCard(signed).then((read) => {
            setBusy(false);
            if (read === null) return;
            if (!read.ok) {
              toast({ title: 'That did not work', description: read.message, tone: 'danger' });
              return;
            }
            if (read.data.value === null) {
              toast({
                title: 'No number found',
                description: 'Hold the card flat, in good light, and try again.',
                tone: 'warning',
              });
              return;
            }
            onValue(read.data.value);
          });
        }}
      >
        Scan your card
      </Button>
      <Text variant="footnote" tone="subtle" className="text-center">
        Only the number is read from the photo. The photo isn’t kept.
      </Text>
    </View>
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
  personId = null,
}: {
  field: RecordField;
  value: Value | undefined;
  onChange: (value: Value) => void;
  warning?: string | undefined;
  problem?: string | undefined;
  /** Whose record, for a file's upload: null is the viewer's own. */
  personId?: string | null;
}): React.JSX.Element {
  const kept = field.keptIn === null ? null : `Kept in ${field.keptIn}: change it there.`;
  const owned = field.readOnly
    ? field.ownedBy === null
      ? 'You can see this but not change it.'
      : `Changed by ${field.ownedBy}.`
    : null;
  const hint = kept ?? owned ?? field.description;
  // Worked out as it is typed (design v3 P15, P20): the right NIF letter, a bank's name.
  const typed = typeof value === 'string' ? value : '';
  const nif = field.dataType === 'national_id' ? nifSuggestion(typed) : null;
  const iban = field.dataType === 'bank_account' ? ibanCheck(typed) : null;
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
        personId={personId}
      />
      {warning === undefined ? null : <FieldDescription tone="warning">{warning}</FieldDescription>}
      {nif === null ? null : (
        <>
          <FieldDescription tone="warning">{`For ${nif.slice(0, -1)} the letter should be ${nif.at(-1) ?? ''}.`}</FieldDescription>
          <Button
            variant="tinted"
            fullWidth
            startIcon={<Icon icon={Sparkles} tone="accent" />}
            onPress={() => {
              onChange(nif);
            }}
          >
            {`Use ${nif}`}
          </Button>
        </>
      )}
      {field.dataType === 'national_id' && !field.readOnly && field.keptIn === null ? (
        <ScanIdButton onValue={onChange} />
      ) : null}
      {iban === null ? null : (
        <FieldDescription tone={iban.valid ? 'muted' : 'warning'}>
          {iban.valid
            ? `${iban.bank === null ? '' : `${iban.bank} · `}the number checks out`
            : 'The check digits don’t match: look at the number again.'}
        </FieldDescription>
      )}
      {hint === null ? null : <FieldDescription>{hint}</FieldDescription>}
      {problem === undefined ? null : <FieldError>{problem}</FieldError>}
    </Field>
  );
}
