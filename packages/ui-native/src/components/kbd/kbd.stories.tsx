import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Search } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { StandInTip } from '../../docs/stand-ins.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';
import { Kbd, KbdGroup } from './kbd.tsx';

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
  parameters: designDocs('kbd'),
  args: { children: 'K' },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Inline>
      <Kbd {...args} />
    </Inline>
  ),
};

export const NamedKeys: Story = {
  name: 'Named keys',
  render: () => (
    <Inline gap={1} className="gap-1.5">
      {['⌘', '⌥', '⇧', '⌃', '↵', '⌫', 'esc', 'tab', 'space', '↑', '↓', '←', '→'].map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </Inline>
  ),
};

export const Combinations: Story = {
  render: () => (
    <Stack gap={2} className="gap-2.5">
      {(
        [
          [['⌘', 'K'], 'Search'],
          [['⌘', '↵'], 'Submit'],
          [['⇧', '?'], 'Shortcuts'],
          [['G', 'P'], 'Go to People'],
        ] as const
      ).map(([keys, label]) => (
        <Inline key={label} gap={2} className="gap-2.5">
          <KbdGroup keys={keys} />
          <Text variant="subhead" tone="muted" className="leading-[1.5]">
            {label}
          </Text>
        </Inline>
      ))}
    </Stack>
  ),
};

export const InASearchField: Story = {
  name: 'In a search field',
  parameters: {
    docs: {
      description: {
        story:
          'On a phone the shortcut is left out of the field: there is no keyboard to press it on. `touch="hide"` does that for a screen that also serves a tablet.',
      },
    },
  },
  render: function SearchStory() {
    const [query, setQuery] = useState('');
    return <SearchField value={query} onValueChange={setQuery} placeholder="Search everything" />;
  },
};

export const InATooltip: Story = {
  name: 'In a tooltip',
  render: () => (
    <Inline gap={2} className="gap-2.5">
      <Button variant="secondary" startIcon={<Icon icon={Search} />} accessibilityLabel="Search" />
      <StandInTip side="right" extra={<KbdGroup keys={['⌘', 'K']} inverted />}>
        Search
      </StandInTip>
    </Inline>
  ),
};
