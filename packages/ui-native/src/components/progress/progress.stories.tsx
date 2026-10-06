import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Wallet } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { CircularProgress, Progress } from './progress.tsx';

const meta = {
  title: 'Components/Progress',
  component: Progress,
  parameters: designDocs('progress'),
  args: { value: 64, label: 'Onboarding', valueLabel: '7 of 11 tasks' },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Indeterminate: Story = {
  render: () => <Progress value={null} label="Importing people" />,
};

export const ARunningJob: Story = {
  name: 'A running job',
  render: () => (
    <Card className="gap-3.5">
      <Inline gap={3} wrap={false}>
        <View className="size-10 items-center justify-center rounded-[12px] bg-accent-subtle">
          <Icon icon={Wallet} tone="accent" />
        </View>
        <View className="flex-1 gap-0.5">
          <Text weight="semibold">September payroll</Text>
          <Text variant="subhead" tone="muted" className="leading-[1.5]">
            Started 14:02 by Zara Ahmed
          </Text>
        </View>
      </Inline>
      <Progress value={72} label="226 of 312 payslips" valueLabel="About 2 min left" />
      <Inline justify="end">
        <Button size="sm">Cancel run</Button>
      </Inline>
    </Card>
  ),
};

export const Tones: Story = {
  render: () => (
    <Stack gap={3} className="gap-3.5">
      <Progress value={64} tone="accent" label="Profile complete" valueLabel="64%" />
      <Progress value={100} tone="success" label="Training done" valueLabel="100%" />
      <Progress value={88} tone="warning" label="Budget used" valueLabel="88%" />
      <Progress value={100} tone="danger" label="Over headcount plan" valueLabel="104%" />
    </Stack>
  ),
};

export const Circular: Story = {
  render: () => (
    <Inline gap={5}>
      <CircularProgress value={25} label="Onboarding" />
      <CircularProgress value={64} tone="success" size={72} label="Training" />
      <CircularProgress value={92} tone="warning" size={56} label="Budget" />
      <CircularProgress value={null} size={40} label="Loading" />
    </Inline>
  ),
};

export const InATableRow: Story = {
  name: 'In a table row',
  render: () => (
    <Card padded={false} className="overflow-hidden">
      {PEOPLE.slice(2, 5).map((person, i) => {
        const done = [40, 100, 72][i] ?? 0;
        return (
          <View key={person.name} className="gap-2 border-b border-border px-4 py-3.5">
            <Inline gap={3} wrap={false}>
              <Avatar name={person.name} size={40} decorative />
              <View className="min-w-0 flex-1">
                <Text weight="semibold" className="text-[16px] leading-[1.3]">
                  {person.name}
                </Text>
                <Text tone="muted" className="text-[14px] leading-[1.3]">
                  {person.role}
                </Text>
              </View>
            </Inline>
            <Inline gap={2} wrap={false} className="gap-2.5">
              <Progress
                value={done}
                hideLabel
                thickness={6}
                tone={done === 100 ? 'success' : 'accent'}
                label={`${person.name}’s onboarding`}
                className="flex-1"
              />
              <Text
                tone="muted"
                weight="medium"
                className="w-[34px] text-right text-[12px] leading-none tabular-nums"
              >
                {`${String(done)}%`}
              </Text>
            </Inline>
          </View>
        );
      })}
    </Card>
  ),
};
