import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Text as CssText, View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Note } from '../../docs/notes.tsx';
import { DataTable, type DataColumn } from '../table/table.tsx';
import { Text } from '../text/text.tsx';
import { Money } from './money.tsx';

const meta = {
  title: 'Components/Money',
  component: Money,
  parameters: designDocs('money'),
  args: { minorUnits: '428000', currency: 'EUR', locale: 'en-GB' },
} satisfies Meta<typeof Money>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { className: 'text-[34px] leading-[1.1] font-bold tracking-[-0.68px]' },
};

/** A label on the left, an amount on the right. */
function Line({
  label,
  children,
  size = 'text-[17px]',
}: {
  label: string;
  children: React.ReactNode;
  size?: string;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <CssText className={`${size} leading-none font-medium text-fg-muted`}>{label}</CssText>
      {children}
    </View>
  );
}

export const Currencies: Story = {
  render: () => (
    <View className="gap-3">
      {(
        [
          ['EUR', 'en-GB', '428000'],
          ['GBP', 'en-GB', '365000'],
          ['USD', 'en-US', '512000'],
          ['JPY', 'ja-JP', '612000'],
          ['CHF', 'de-CH', '640050'],
        ] as const
      ).map(([currency, locale, minor]) => (
        <Line key={currency} label={currency}>
          <Money
            minorUnits={minor}
            currency={currency}
            locale={locale}
            className="text-[17px] leading-none font-medium"
          />
        </Line>
      ))}
    </View>
  ),
};

export const Precision: Story = {
  name: 'Precision a double would lose',
  render: () => (
    <View className="gap-3.5">
      <Line label="0.1 + 0.2 as floats" size="text-[14px]">
        <Text mono className="text-[14px] leading-none font-medium text-danger-fg">
          {String(0.1 + 0.2)}
        </Text>
      </Line>
      <Line label="10 + 20 cents" size="text-[14px]">
        <Text mono className="text-[14px] leading-none font-medium text-success-fg">
          {/* Integer minor units add exactly. */}
          €0.30
        </Text>
      </Line>
      <Line label="Payroll total" size="text-[14px]">
        <Money
          minorUnits="900719925474099"
          currency="EUR"
          locale="en-GB"
          className="text-[14px] leading-none font-medium"
        />
      </Line>
    </View>
  ),
};

export const Negative: Story = {
  render: () => (
    <View className="gap-3">
      <Line label="Refund">
        <Money minorUnits="-8600" currency="EUR" locale="en-GB" className="text-[17px] leading-none font-semibold" />
      </Line>
      <Line label="Overpayment">
        <Money
          minorUnits="-124050"
          currency="EUR"
          locale="en-GB"
          signColored
          className="text-[17px] leading-none font-semibold"
        />
      </Line>
      <Line label="Accounting">
        <Money
          minorUnits="-124050"
          currency="EUR"
          locale="en-GB"
          accounting
          className="text-[17px] leading-none font-semibold"
        />
      </Line>
      <Note>Use a true minus sign. Red is only for amounts that are genuinely a problem.</Note>
    </View>
  ),
};

export const Locales: Story = {
  render: () => (
    <View className="gap-3">
      {(
        [
          ['en-GB', 'English (UK)'],
          ['de-DE', 'Deutsch'],
          ['fr-FR', 'Français'],
          ['ja-JP', '日本語'],
        ] as const
      ).map(([locale, name]) => (
        <Line key={locale} label={name} size="text-callout">
          <Money
            minorUnits="9200050"
            currency="EUR"
            locale={locale}
            className="text-callout leading-none font-medium"
          />
        </Line>
      ))}
    </View>
  ),
};

type Payslip = { month: string; gross: string; net: string };
const PAYSLIPS: Payslip[] = [
  { month: 'September', gross: '766667', net: '428000' },
  { month: 'August', gross: '766667', net: '428000' },
  { month: 'July (bonus)', gross: '1226667', net: '691240' },
  { month: 'June', gross: '725000', net: '405000' },
];
const euro = (minor: string): React.JSX.Element => (
  <Money minorUnits={minor} currency="EUR" locale="en-GB" />
);
const PAYSLIP_COLUMNS: DataColumn<Payslip>[] = [
  { id: 'month', header: 'Payslip', cell: (p) => p.month },
  { id: 'gross', header: 'Gross', numeric: true, cell: (p) => euro(p.gross) },
  { id: 'net', header: 'Net', numeric: true, cardTrailing: true, cell: (p) => euro(p.net) },
];

export const InAColumn: Story = {
  name: 'In a column',
  render: () => (
    <DataTable
      label="Payslips"
      rows={PAYSLIPS}
      columns={PAYSLIP_COLUMNS}
      rowId={(p) => p.month}
      labelled
      onRowPress={() => undefined}
    />
  ),
};
