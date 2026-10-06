import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Stack } from '../layout/layout.tsx';
import { Switch } from '../switch/switch.tsx';
import { Text } from '../text/text.tsx';
import { Checkbox, type CheckedState } from './checkbox.tsx';

const meta = {
  title: 'Forms/Checkbox',
  component: Checkbox,
  parameters: designDocs('checkbox'),
} satisfies Meta<typeof Checkbox>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial,
  ...props
}: Omit<React.ComponentProps<typeof Checkbox>, 'checked' | 'onCheckedChange'> & {
  initial: CheckedState;
}): React.JSX.Element {
  const [checked, setChecked] = useState<CheckedState>(initial);
  return <Checkbox checked={checked} onCheckedChange={setChecked} {...props} />;
}

export const Playground: Story = {
  render: () => <Live initial>Send me a weekly summary</Live>,
};

const states: readonly [string, CheckedState, Partial<React.ComponentProps<typeof Checkbox>>][] = [
  ['Off', false, {}],
  ['On', true, {}],
  ['Mixed', 'indeterminate', {}],
  ['Focus', false, {}],
  ['Disabled', true, { disabled: true }],
  ['Required', false, { invalid: true }],
];

export const CheckboxStates: Story = {
  name: 'Checkbox states',
  render: () => (
    <View className="flex-row flex-wrap gap-3">
      {states.map(([name, initial, props]) => (
        <Stack key={name} gap={2} className="w-[110px]">
          <Live initial={initial} accessibilityLabel={name} {...props} />
          <Text variant="subhead" tone="muted">
            {name}
          </Text>
        </Stack>
      ))}
    </View>
  ),
  // The focus ring is keyboard focus's: put it there, as a Tab would.
  play: ({ canvasElement }) => {
    // No DOM types in a React Native package: the little of it this needs.
    type Focusable = { focus: (options: { focusVisible: boolean }) => void };
    const canvas = canvasElement as unknown as {
      querySelector: (selector: string) => Focusable | null;
    };
    canvas.querySelector('[aria-label="Focus"]')?.focus({ focusVisible: true });
  },
};

function Team(): React.JSX.Element {
  const [members, setMembers] = useState({ Platform: true, Payroll: true, Mobile: false });
  const values = Object.values(members);
  const all: CheckedState = values.every(Boolean)
    ? true
    : values.some(Boolean)
      ? 'indeterminate'
      : false;
  return (
    <Stack className="gap-2.5">
      <Checkbox
        checked={all}
        onCheckedChange={(on) => {
          setMembers({ Platform: on, Payroll: on, Mobile: on });
        }}
      >
        All of Engineering
      </Checkbox>
      <Stack className="gap-2.5 pl-7">
        {(Object.keys(members) as (keyof typeof members)[]).map((team) => (
          <Checkbox
            key={team}
            checked={members[team]}
            onCheckedChange={(on) => {
              setMembers({ ...members, [team]: on });
            }}
          >
            {team}
          </Checkbox>
        ))}
      </Stack>
    </Stack>
  );
}

export const Indeterminate: Story = {
  render: () => <Team />,
};

function Either(): React.JSX.Element {
  const [notify, setNotify] = useState(true);
  return (
    <Stack gap={3}>
      <Card>
        <Stack gap={3}>
          <Text variant="footnote" weight="semibold" tone="muted">
            Checkbox · saved with the form
          </Text>
          <Live initial>Include in payroll run</Live>
          <Button variant="primary" size="sm" className="self-start">
            Save
          </Button>
        </Stack>
      </Card>
      <Card>
        <Stack gap={3}>
          <Text variant="footnote" weight="semibold" tone="muted">
            Switch · applies straight away
          </Text>
          <Switch checked={notify} onCheckedChange={setNotify}>
            Email notifications
          </Switch>
        </Stack>
      </Card>
    </Stack>
  );
}

export const CheckboxOrSwitch: Story = {
  name: 'Checkbox or switch?',
  render: () => <Either />,
};
