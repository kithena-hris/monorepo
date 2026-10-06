import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { NumberField, type NumberFieldProps } from './number-field.tsx';

const meta = {
  title: 'Forms/NumberField',
  component: NumberField,
  parameters: designDocs('number-field'),
} satisfies Meta<typeof NumberField>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

/** A number field holding its own value, for stories. */
function Live({
  initial,
  ...props
}: Omit<NumberFieldProps, 'value' | 'onChange'> & { initial: number | null }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <NumberField value={value} onChange={setValue} {...props} />;
}

export const Playground: Story = {
  render: () => <Live label="Days" initial={5} min={0} />,
};

export const NullIsNotZero: Story = {
  name: 'Null is not zero',
  render: () => (
    <Stack gap={3}>
      <Live
        label="Overtime hours"
        initial={null}
        placeholder="Not set"
        hint="Empty means not reported, which is different from 0."
      />
      <Live label="Overtime hours" initial={0} hint="Zero means reported as none." />
    </Stack>
  ),
};

export const DecimalsAndLocale: Story = {
  name: 'Decimals and locale',
  render: () => (
    <Stack gap={3}>
      <Live label="FTE (en-GB)" initial={0.8} locale="en-GB" step={0.1} min={0} max={1} />
      <Live label="FTE (de-DE)" initial={0.8} locale="de-DE" step={0.1} min={0} max={1} />
      <Live
        label="Salary (fr-FR)"
        initial={92000}
        locale="fr-FR"
        precision={2}
        suffix="€"
        hideSteppers
      />
    </Stack>
  ),
};

export const PrefixesSuffixesAndSizes: Story = {
  name: 'Prefixes, suffixes and sizes',
  render: () => (
    <Stack className="gap-2.5">
      <Live label="Bonus" initial={2500} prefix="€" size="sm" step={100} />
      <Live label="Allowance" initial={20} suffix="%" min={0} max={100} />
      <Live label="Notice period" initial={3} suffix="months" size="lg" min={0} />
    </Stack>
  ),
};

export const BoundsAndValidation: Story = {
  name: 'Bounds and validation',
  render: () => (
    <Stack gap={3}>
      <Live
        label="Days off"
        initial={18}
        min={0}
        max={14.5}
        step={0.5}
        error="You have 14.5 days left. Enter 14.5 or fewer."
      />
      <Live
        label="Team size"
        initial={1}
        min={1}
        hint="Minimum 1. The minus button is off at the minimum."
      />
    </Stack>
  ),
};

export const DisabledAndReadOnly: Story = {
  name: 'Disabled and read-only',
  render: () => (
    <Stack gap={3}>
      <Live label="Carry-over" initial={5} disabled />
      <Live label="Accrued" initial={23.5} suffix="days" readOnly hideSteppers />
    </Stack>
  ),
};
