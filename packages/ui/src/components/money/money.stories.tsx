import type { Meta, StoryObj } from '@storybook/react-vite';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/table';
import { Money } from './money';

const meta = {
  title: 'Components/Money',
  component: Money,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Money crosses the wire as an integer string in minor units and must not become a float on the way to the screen either. `Number("20000000000.15")` is already wrong before it reaches the formatter.',
          '',
          '`Intl.NumberFormat` accepts a decimal *string* and formats it exactly, so the only arithmetic here is shifting a decimal point through string operations.',
          '',
          'Presentation only: this component neither adds, converts, nor rounds. Sum in the domain with `decimal.js` and pass the result.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    minorUnits: {
      description:
        'Integer amount in minor units, as a string or bigint. `"420050"` is 4 200.50 in a two-decimal currency. A float here is a bug.',
      control: 'text',
      table: { type: { summary: 'string | bigint' }, category: 'Value' },
    },
    currency: {
      description: 'ISO 4217 code. Decides the symbol, the placement and the default exponent.',
      control: 'select',
      options: ['EUR', 'USD', 'GBP', 'JPY', 'INR', 'BHD'],
      table: { type: { summary: 'string' }, category: 'Value' },
    },
    exponent: {
      description:
        "Minor-unit exponent. Defaults to the currency's own. 2 for EUR, 0 for JPY, 3 for BHD. Override only for a scale the currency itself does not define.",
      control: { type: 'number', min: 0, max: 4 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: "currency's own" },
        category: 'Value',
      },
    },
    locale: {
      description: 'Formatting locale. Decides grouping, decimal mark and symbol position.',
      control: 'select',
      options: ['en-IE', 'en-US', 'de-DE', 'fr-FR', 'ja-JP', 'en-IN'],
      table: { type: { summary: 'string | undefined' }, category: 'Formatting' },
    },
    hideCurrency: {
      description: 'Drop the symbol, for a column already headed with the currency.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Formatting',
      },
    },
    signColored: {
      description:
        'Colour negatives in the danger tone. Off by default: a refund or a deduction is not an error.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Formatting',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    minorUnits: '420050',
    currency: 'EUR',
    locale: 'en-IE',
    hideCurrency: false,
    signColored: false,
  },
} satisfies Meta<typeof Money>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Change the currency and watch the exponent follow it: the same `minorUnits` renders as 4 200.50 in EUR and 420 050 in JPY, because those are different amounts of money.',
      },
    },
  },
  render: (args) => (
    <p className="text-2xl font-semibold">
      <Money {...args} />
    </p>
  ),
};

export const Currencies: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The exponent comes from the currency, not from a hardcoded 2. JPY has no minor unit; assuming otherwise inflates every yen amount by a hundred.',
      },
    },
  },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Currency</TableHead>
          <TableHead>Minor units</TableHead>
          <TableHead numeric>Rendered</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(
          [
            ['EUR', '420050', 'en-IE'],
            ['USD', '420050', 'en-US'],
            ['JPY', '580000', 'ja-JP'],
            ['INR', '35000000', 'en-IN'],
            ['BHD', '4200500', 'en-BH'],
          ] as const
        ).map(([currency, minorUnits, locale]) => (
          <TableRow key={currency}>
            <TableCell>{currency}</TableCell>
            <TableCell>
              <code className="font-mono text-xs text-fg-muted">{minorUnits}</code>
            </TableCell>
            <TableCell numeric>
              <Money minorUnits={minorUnits} currency={currency} locale={locale} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const PrecisionADoubleWouldLose: Story = {
  name: 'Precision a double would lose',
  render: () => (
    <div className="space-y-2 text-sm">
      <p className="text-fg-muted">
        Minor units <code className="font-mono text-xs">2000000000015</code>, formatted exactly:
      </p>
      <p className="text-xl font-semibold">
        <Money minorUnits="2000000000015" currency="EUR" locale="en-IE" />
      </p>
      <p className="text-fg-muted">
        Via <code className="font-mono text-xs">Number()</code> this reads 20,000,000,000.150002.
      </p>
    </div>
  ),
};

export const Negative: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Plain, sign-coloured, and without the symbol. `signColored` is opt-in because a negative amount is usually a deduction or a refund, not a failure: colouring every one of them red trains people to ignore red.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-6">
      <Money minorUnits="-125000" currency="EUR" locale="en-IE" />
      <Money minorUnits="-125000" currency="EUR" locale="en-IE" signColored />
      <Money minorUnits="425000" currency="EUR" locale="en-IE" hideCurrency />
    </div>
  ),
};

export const Locales: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The same amount in the same currency, formatted for five locales. Grouping, decimal mark and symbol position all move, which is why no part of this may be assembled by hand.',
      },
    },
  },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Locale</TableHead>
          <TableHead numeric>€4 200.50</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {['en-IE', 'en-US', 'de-DE', 'fr-FR', 'en-IN'].map((locale) => (
          <TableRow key={locale}>
            <TableCell>
              <code className="font-mono text-xs">{locale}</code>
            </TableCell>
            <TableCell numeric>
              <Money minorUnits="420050" currency="EUR" locale={locale} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const InAColumn: Story = {
  name: 'In a column',
  parameters: {
    docs: {
      description: {
        story:
          'What the tabular figures are actually for. Every decimal point lands on the same x-position, so a mis-keyed order of magnitude is visible without reading a single digit.',
      },
    },
  },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Line</TableHead>
          <TableHead numeric>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(
          [
            ['Base salary', '1420000'],
            ['Housing allowance', '95000'],
            ['Overtime', '7325'],
            ['Pension deduction', '-142000'],
            ['Correction, July', '-1150'],
          ] as const
        ).map(([label, amount]) => (
          <TableRow key={label}>
            <TableCell>{label}</TableCell>
            <TableCell numeric>
              <Money minorUnits={amount} currency="EUR" locale="en-IE" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
