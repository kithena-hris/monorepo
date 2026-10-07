import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Inline, Stack } from '../layout/layout.tsx';
import { NumberField } from '../number-field/number-field.tsx';
import { Text } from '../text/text.tsx';
import { Slider, type SliderProps } from './slider.tsx';

const meta = {
  title: 'Forms/Slider',
  component: Slider,
  parameters: designDocs('slider'),
} satisfies Meta<typeof Slider>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial,
  ...props
}: Omit<SliderProps, 'value' | 'onValueChange'> & { initial: number[] }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <Slider value={value} onValueChange={setValue} {...props} />;
}

export const Playground: Story = {
  render: () => <Live initial={[60]} label="Completion" tip={(v) => `${String(v)}%`} />,
};

function Band(): React.JSX.Element {
  const [band, setBand] = useState([40, 75]);
  return (
    <Stack gap={3}>
      <Slider
        value={band}
        onValueChange={setBand}
        label="Salary band"
        thumbLabels={['Lowest salary', 'Highest salary']}
        min={20}
        max={120}
        tip={(v) => `€${String(v)}k`}
      />
      <Text variant="subhead" tone="muted">
        Salary band: €{band[0]}k to €{band[1]}k
      </Text>
    </Stack>
  );
}

export const TwoThumbRange: Story = {
  name: 'Two-thumb range',
  render: () => <Band />,
};

export const DiscreteSteps: Story = {
  name: 'Discrete steps',
  render: () => (
    <Live
      initial={[3]}
      label="Seniority"
      min={0}
      max={5}
      showTicks
      labels={['0', '1', '2', '3', '4', '5']}
    />
  ),
};

function Paired(): React.JSX.Element {
  const [value, setValue] = useState(80);
  return (
    <Inline gap={4} wrap={false}>
      <View className="flex-1">
        <Slider
          value={[value]}
          onValueChange={([v]) => {
            setValue(v ?? 0);
          }}
          label="Allocation"
        />
      </View>
      <View className="w-[110px]">
        <NumberField
          label="Allocation"
          value={value}
          onChange={(v) => {
            setValue(v ?? 0);
          }}
          min={0}
          max={100}
          precision={0}
          suffix="%"
          hideSteppers
          hideLabel
        />
      </View>
    </Inline>
  );
}

export const PairedWithANumberInput: Story = {
  name: 'Paired with a number input',
  render: () => <Paired />,
};

export const Vertical: Story = {
  render: () => (
    <Inline className="justify-center gap-10 py-2" wrap={false}>
      <Live initial={[70]} label="Volume" orientation="vertical" />
      <Live initial={[20, 60]} label="Range" orientation="vertical" />
      <Live initial={[40]} label="Brightness" orientation="vertical" tip />
    </Inline>
  ),
};

export const Disabled: Story = {
  render: () => <Live initial={[45]} label="Completion" disabled />,
};
