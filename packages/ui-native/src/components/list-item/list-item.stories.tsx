import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Archive, Calendar, Check, FileText, Trash2 } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { PEOPLE, STATUS_TONE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Checkbox } from '../checkbox/checkbox.tsx';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { Switch } from '../switch/switch.tsx';
import { Text } from '../text/text.tsx';
import { List, ListItem } from './list-item.tsx';

/** The row's own checkbox, named by the row it sits in. */
function RowCheckbox(): React.JSX.Element {
  const [on, setOn] = useState(true);
  return <Checkbox checked={on} onCheckedChange={setOn} accessibilityLabel="Checkbox" />;
}

function RowSwitch(): React.JSX.Element {
  const [on, setOn] = useState(true);
  return <Switch checked={on} onCheckedChange={setOn} accessibilityLabel="Switch" />;
}

const meta = {
  title: 'Components/List item',
  component: ListItem,
  parameters: designDocs('list-item'),
  args: { children: 'Personal' },
} satisfies Meta<typeof ListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneLine: Story = {
  name: 'One line',
  render: () => (
    <List>
      {['Personal', 'Employment', 'Pay'].map((section) => (
        <ListItem key={section} chevron onPress={() => undefined}>
          {section}
        </ListItem>
      ))}
    </List>
  ),
};

export const TwoLines: Story = {
  name: 'Two lines',
  render: () => (
    <List>
      {PEOPLE.slice(0, 3).map(({ name, role, status }) => (
        <ListItem
          key={name}
          leading={<Avatar name={name} size="lg" decorative />}
          description={role}
          trailing={
            <Badge tone={STATUS_TONE[status]} size="sm" dot>
              {status}
            </Badge>
          }
        >
          {name}
        </ListItem>
      ))}
    </List>
  ),
};

export const ThreeLines: Story = {
  name: 'Three lines',
  render: () => (
    <List>
      {(
        [
          [
            'Nora Becker',
            'Parental leave policy',
            'Everyone gets up to 14 weeks of paid leave in the first year, starting 1 January.',
          ],
          [
            'Mei Tanaka',
            'Q3 expenses',
            'We came in 4% under budget, mostly thanks to fewer flights.',
          ],
        ] as const
      ).map(([author, title, body]) => (
        <ListItem
          key={title}
          leading={<Avatar name={author} size="lg" decorative />}
          meta="2h"
          description={author}
          supporting={body}
        >
          {title}
        </ListItem>
      ))}
    </List>
  ),
};

export const LeadingOptions: Story = {
  name: 'Leading options',
  render: () => (
    <List>
      <ListItem leading={<Avatar name="Priya Shah" size={40} decorative />} description="People">
        Avatar
      </ListItem>
      <ListItem icon={Calendar} iconTone={3} description="Settings and destinations">
        Icon tile
      </ListItem>
      <ListItem leading={<Icon icon={FileText} tone="muted" />} description="Files">
        Plain icon
      </ListItem>
      <ListItem leading={<RowCheckbox />} description="Selection">
        Checkbox
      </ListItem>
    </List>
  ),
};

export const TrailingOptions: Story = {
  name: 'Trailing options',
  render: () => (
    <List>
      <ListItem description="Opens something" chevron onPress={() => undefined}>
        Chevron
      </ListItem>
      <ListItem
        description="Read-only detail"
        trailing={
          <Text variant="callout" tone="muted">
            Berlin
          </Text>
        }
      >
        Value
      </ListItem>
      <ListItem description="Applies straight away" trailing={<RowSwitch />}>
        Switch
      </ListItem>
      <ListItem
        description="One action"
        trailing={
          <Button size="xs" variant="primary" onPress={() => undefined}>
            Approve
          </Button>
        }
      >
        Button
      </ListItem>
    </List>
  ),
};

export const SelectedAndDisabled: Story = {
  name: 'Selected and disabled',
  render: () => (
    <List>
      <ListItem
        selected
        leading={<Avatar name="Priya Shah" size={36} decorative />}
        description="Selected"
        trailing={<Icon icon={Check} size={18} tone="accent" />}
      >
        Priya Shah
      </ListItem>
      <ListItem leading={<Avatar name="Jonas Weber" size={36} decorative />} description="Default">
        Jonas Weber
      </ListItem>
      <ListItem
        disabled
        leading={<Avatar name="Yuki Sato" size={36} decorative />}
        description="Invited, not active yet"
      >
        Yuki Sato
      </ListItem>
    </List>
  ),
};

export const SwipeActions: Story = {
  name: 'Swipe actions',
  parameters: {
    docs: {
      description: {
        story:
          'Swipe left to reveal actions, and a full swipe runs the first one. VoiceOver and TalkBack offer the same actions on the row.',
      },
    },
  },
  render: function SwipeStory() {
    const [done, setDone] = useState<string | null>(null);
    return (
      <Stack gap={2} className="gap-2.5">
        <List>
          {([['Amara Okafor', 'Vacation · 14–18 Oct']] as const).map(([name, request]) => (
            <ListItem
              key={name}
              leading={<Avatar name={name} size="lg" decorative />}
              description={request}
              defaultSwipeOpen
              swipeActions={[
                {
                  label: 'Archive',
                  name: `Archive ${name}’s request`,
                  icon: Archive,
                  onSelect: () => {
                    setDone(`Archived ${name}’s request`);
                  },
                },
                {
                  label: 'Delete',
                  name: `Delete ${name}’s request`,
                  tone: 'danger',
                  icon: Trash2,
                  onSelect: () => {
                    setDone(`Deleted ${name}’s request`);
                  },
                },
              ]}
            >
              {name}
            </ListItem>
          ))}
        </List>
        <Text variant="subhead" tone="muted" accessibilityRole="text" className="leading-[1.5]">
          {done ??
            'Swipe left to reveal actions, and a full swipe runs the first one. The same actions are in the long-press menu.'}
        </Text>
      </Stack>
    );
  },
};

export const WithSectionHeaders: Story = {
  name: 'With section headers',
  render: () => (
    <Stack gap={4}>
      {(
        [
          ['Today', PEOPLE.slice(0, 2)],
          ['Yesterday', PEOPLE.slice(2, 4)],
        ] as const
      ).map(([heading, group]) => (
        <Stack key={heading} gap={2}>
          <Text
            variant="caption"
            weight="semibold"
            tone="subtle"
            accessibilityRole="header"
            className="px-4 text-[12px] leading-none"
          >
            {heading}
          </Text>
          <List>
            {group.map(({ name, role }) => (
              <ListItem
                key={name}
                leading={<Avatar name={name} size={36} decorative />}
                description={role}
              >
                {name}
              </ListItem>
            ))}
          </List>
        </Stack>
      ))}
    </Stack>
  ),
};
