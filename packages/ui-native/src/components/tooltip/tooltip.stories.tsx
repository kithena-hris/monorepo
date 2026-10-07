import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Bell, Download, Info } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Kbd } from '../kbd/kbd.tsx';
import { Text } from '../text/text.tsx';
import { Tooltip } from './tooltip.tsx';

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  parameters: designDocs('tooltip'),
  // axe runs once the tooltips have faded in.
  play: settled,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { content: 'Export as CSV', defaultOpen: true, children: <View /> },
  render: (args) => (
    <View className="items-start pt-10">
      <Tooltip content={args.content} defaultOpen>
        <Button startIcon={<Icon icon={Download} />} accessibilityLabel={args.content} />
      </Tooltip>
    </View>
  ),
};

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export const Sides: Story = {
  args: { content: '', children: <View /> },
  render: () => (
    <View className="flex-row flex-wrap justify-between gap-y-14 px-12 py-10">
      {SIDES.map((side) => {
        const name = `${side.charAt(0).toUpperCase()}${side.slice(1)}`;
        return (
          <View key={side} className="w-1/2 items-center">
            <Tooltip content={name} side={side} defaultOpen>
              <Button size="sm" accessibilityLabel={name} startIcon={<Icon icon={Info} />} />
            </Tooltip>
          </View>
        );
      })}
    </View>
  ),
};

export const OnAnIconButton: Story = {
  name: 'On an icon-only control',
  args: { content: '', children: <View /> },
  render: () => (
    <View className="items-start gap-4 pt-16 pl-6">
      <Tooltip
        content="Notifications"
        defaultOpen
        shortcut={
          <>
            <Kbd inverted>G</Kbd>
            <Kbd inverted>N</Kbd>
          </>
        }
      >
        <Button startIcon={<Icon icon={Bell} />} accessibilityLabel="Notifications" />
      </Tooltip>
      <Text variant="subhead" tone="muted" className="-ml-6 self-stretch leading-[1.5]">
        The tooltip text matches the accessibility label. On a phone a long press opens it.
      </Text>
    </View>
  ),
};

export const WhatNotToPutInOne: Story = {
  name: 'What not to put in one',
  parameters: designNote('tooltip', 'What not to put in one'),
  args: { content: '', children: <View /> },
  render: () => (
    <View className="gap-2.5">
      <Text variant="caption" weight="semibold" tone="muted">
        Don’t
      </Text>
      <View className="items-start pt-24">
        <Tooltip
          content="Carry-over days expire on 31 March unless your manager extends them, see the policy for details."
          side="top"
          defaultOpen
        >
          <Button size="sm" accessibilityLabel="Carry-over" startIcon={<Icon icon={Info} />} />
        </Tooltip>
      </View>
      <Text variant="caption" weight="semibold" tone="muted">
        Do
      </Text>
      <View className="items-start pt-10">
        <Tooltip content="Carry-over" side="top" defaultOpen>
          <Button size="sm" accessibilityLabel="Carry-over" startIcon={<Icon icon={Info} />} />
        </Tooltip>
      </View>
    </View>
  ),
};
