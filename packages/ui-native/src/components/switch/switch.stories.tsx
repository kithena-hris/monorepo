import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { cn } from '../../lib/cn.ts';
import { Inline, Stack } from '../layout/layout.tsx';
import { Switch, type SwitchProps } from './switch.tsx';

const meta = {
  title: 'Forms/Switch',
  component: Switch,
  parameters: designDocs('switch'),
} satisfies Meta<typeof Switch>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial,
  ...props
}: Omit<SwitchProps, 'checked' | 'onCheckedChange'> & { initial: boolean }): React.JSX.Element {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onCheckedChange={setChecked} {...props} />;
}

export const Playground: Story = {
  render: () => (
    <Inline gap={4}>
      <Live initial accessibilityLabel="Email notifications" />
      <Live initial={false} accessibilityLabel="Text messages" />
    </Inline>
  ),
};

export const WithALabel: Story = {
  name: 'With a label',
  render: () => (
    <Live initial description="A summary every Monday at 9:00">
      Email notifications
    </Live>
  ),
};

const settings = [
  ['Requests to approve', true],
  ['Team birthdays', false],
  ['Payday reminders', true],
  ['Product news', false],
] as const;

export const ASettingsList: Story = {
  name: 'A settings list',
  render: () => (
    <View className="overflow-hidden rounded-m-card bg-surface shadow-sm">
      {settings.map(([label, initial], i) => (
        <View
          key={label}
          className={cn(
            'min-h-[60px] justify-center px-4',
            i < settings.length - 1 && 'border-b border-border',
          )}
        >
          <Live initial={initial}>{label}</Live>
        </View>
      ))}
    </View>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Stack className="gap-3.5">
      <Live initial disabled description="Required by your organisation">
        Two-factor sign-in
      </Live>
      <Live initial={false} disabled>
        Public profile
      </Live>
    </Stack>
  ),
};

/** Turning it on saves; the save fails; the switch goes back and says so. */
function Committing(): React.JSX.Element {
  return (
    <Stack className="gap-3.5">
      <Switch checked loading onCheckedChange={() => undefined} description="Saving…">
        Share calendar
      </Switch>
      <Live initial={false} error="Couldn’t save. We turned it back off.">
        Share calendar
      </Live>
    </Stack>
  );
}

export const CommittingAndFailing: Story = {
  name: 'Committing, and failing',
  render: () => <Committing />,
};
