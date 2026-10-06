import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Calendar,
  Clock,
  Euro,
  Landmark,
  Link,
  Mail,
  MapPin,
  Percent,
  Phone,
  Timer,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Field, FieldDescription, FieldError, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input, type InputType } from '../input/input.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { CurrencyField, PhoneField, SearchField } from './typed-fields.tsx';

const meta = {
  title: 'Forms/Typed fields',
  component: SearchField,
  parameters: designDocs('typed-fields'),
} satisfies Meta<typeof SearchField>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

const types: readonly [string, InputType, string, LucideIcon][] = [
  ['Email', 'email', 'priya@reach.co', Mail],
  ['URL', 'url', 'reach.co', Link],
  ['Phone', 'tel', '+49 151 2345 6789', Phone],
  ['Money', 'decimal', '€ 4,280.00', Euro],
  ['Percent', 'decimal', '20 %', Percent],
  ['Date', 'date', '14 Oct 2026', Calendar],
  ['Time', 'time', '09:30', Clock],
  ['Duration', 'duration', '7h 30m', Timer],
  ['IBAN', 'iban', 'DE89 3704 0044 0532 01', Landmark],
  ['Postcode', 'postcode', '10115', MapPin],
];

function Typed({
  label,
  type,
  initial,
  icon,
}: {
  label: string;
  type: InputType;
  initial: string;
  icon: LucideIcon;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        value={value}
        onChange={setValue}
        startAdornment={<Icon icon={icon} size={19} tone="muted" />}
      />
    </Field>
  );
}

export const EveryType: Story = {
  name: 'Every type',
  render: () => (
    <Stack className="gap-3.5">
      {types.map(([label, type, initial, icon]) => (
        <Typed key={label} label={label} type={type} initial={initial} icon={icon} />
      ))}
    </Stack>
  ),
};

function Searches(): React.JSX.Element {
  const [query, setQuery] = useState('Priya');
  const [empty, setEmpty] = useState('');
  return (
    <Stack className="gap-3.5">
      <SearchField value={query} onValueChange={setQuery} label="Search people" autoFocus />
      <SearchField
        value={empty}
        onValueChange={setEmpty}
        label="Search everything"
        placeholder="Search people, teams and documents"
      />
    </Stack>
  );
}

export const SearchStory: Story = {
  name: 'Search',
  render: () => <Searches />,
};

function Money(): React.JSX.Element {
  const [amount, setAmount] = useState('124050');
  const [currency, setCurrency] = useState('EUR');
  const [refund, setRefund] = useState('-8600');
  return (
    <Stack className="gap-3.5">
      <Field>
        <FieldLabel>Amount</FieldLabel>
        <CurrencyField
          value={amount}
          onValueChange={setAmount}
          currency={currency}
          currencies={['EUR', 'GBP', 'USD', 'CHF']}
          onCurrencyChange={setCurrency}
          locale="en-GB"
        />
      </Field>
      <Field>
        <FieldLabel>Refund</FieldLabel>
        <CurrencyField value={refund} onValueChange={setRefund} currency="EUR" locale="en-GB" />
        <FieldDescription>Negative amounts use a true minus sign.</FieldDescription>
      </Field>
    </Stack>
  );
}

export const MoneyStory: Story = {
  name: 'Money',
  render: () => <Money />,
};

function Phones(): React.JSX.Element {
  const [number, setNumber] = useState('151 2345 6789');
  const [short, setShort] = useState('151 234');
  const [country, setCountry] = useState('DE');
  return (
    <Stack className="gap-3.5">
      <Field>
        <FieldLabel>Mobile</FieldLabel>
        <PhoneField
          value={number}
          onValueChange={setNumber}
          country={country}
          onCountryChange={setCountry}
        />
      </Field>
      <Field invalid>
        <FieldLabel>Mobile</FieldLabel>
        <Input type="tel" value={short} onChange={setShort} />
        <FieldError>German mobile numbers have 10 or 11 digits.</FieldError>
      </Field>
    </Stack>
  );
}

export const PhoneNumber: Story = {
  name: 'Phone number',
  render: () => <Phones />,
};

function OnAPhone(): React.JSX.Element {
  const [amount, setAmount] = useState('24800');
  return (
    <Stack className="gap-3.5">
      <Field>
        <FieldLabel>Amount</FieldLabel>
        <CurrencyField
          value={amount}
          onValueChange={setAmount}
          currency="EUR"
          locale="en-GB"
          autoFocus
        />
      </Field>
      <Text variant="subhead" tone="muted">
        Money opens the decimal keypad. Email, phone and URL each open their own keyboard.
      </Text>
    </Stack>
  );
}

export const OnAPhoneStory: Story = {
  name: 'On a phone',
  render: () => <OnAPhone />,
};
