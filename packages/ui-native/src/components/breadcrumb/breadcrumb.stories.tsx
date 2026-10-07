import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { settled, Stage } from '../../docs/stage.tsx';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../dropdown-menu/dropdown-menu.tsx';
import { Text } from '../text/text.tsx';
import { Breadcrumb, BreadcrumbBack } from './breadcrumb.tsx';

const meta = {
  title: 'Components/Breadcrumb',
  component: Breadcrumb,
  parameters: designDocs('breadcrumb'),
  args: { items: [] },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

const go = (): void => undefined;
const trail = (...labels: string[]): { label: string; onPress: () => void }[] =>
  labels.map((label) => ({ label, onPress: go }));

export const Playground: Story = {
  args: { items: trail('People', 'Engineering', 'Priya Shah') },
};

export const CollapsingOnAPhone: Story = {
  name: 'Collapsing on a phone',
  render: () => {
    const items = trail('Home', 'People', 'Engineering', 'Platform', 'Priya Shah');
    return (
      <View className="gap-3">
        <Breadcrumb items={items} label="Full trail" />
        <Breadcrumb items={items} maxItems={4} label="Collapsed trail" />
        <BreadcrumbBack label="Platform" onPress={go} />
        <Text variant="subhead" tone="muted" className="font-normal leading-[1.5]">
          Under 640 the middle collapses into a menu, and on a phone only the back link remains.
        </Text>
      </View>
    );
  },
};

export const ADifferentSeparator: Story = {
  name: 'A different separator',
  render: () => (
    <View className="gap-3">
      <Breadcrumb
        items={trail('People', 'Engineering', 'Priya Shah')}
        separator="slash"
        label="People trail"
      />
      <Breadcrumb
        items={trail('Settings', 'Billing', 'Invoices')}
        separator="dot"
        label="Billing trail"
      />
    </View>
  ),
};

export const WithALongLabel: Story = {
  name: 'With a long label',
  args: {
    items: trail('People', 'Engineering', 'Principal Staff Engineer, Platform Infrastructure'),
  },
};

function SectionMenu({ host }: { host: string }): React.JSX.Element {
  const [team, setTeam] = useState('Engineering');
  return (
    <Breadcrumb
      portalHost={host}
      items={[
        { label: 'People', onPress: go },
        {
          label: team,
          defaultMenuOpen: true,
          menu: (
            <DropdownMenuRadioGroup value={team} onValueChange={setTeam}>
              {['Engineering', 'Design', 'Sales'].map((name) => (
                <DropdownMenuRadioItem key={name} value={name}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ),
        },
        { label: 'Priya Shah' },
      ]}
    />
  );
}

export const WithSectionMenu: Story = {
  name: 'With Section Menu',
  render: () => <Stage height={300} trigger={(host) => <SectionMenu host={host} />} />,
  play: settled,
};
