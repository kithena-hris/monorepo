import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarClock, FilePlus2, Layers, ShieldCheck, TrendingUp } from 'lucide-react';

import { Button } from '../button/button';
import { Card } from '../card/card';
import { IconList, IconListItem } from './icon-list';

const meta = {
  title: 'Components/Icon list',
  component: IconList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Points that each lead with a glyph in a tinted tile: a title, a line of explanation, and optionally one action.',
          '',
          'Close together, they are one argument: the reasons something was flagged. `divided`, they are a sequence of separate things: every step a plan will take, each with its own way in.',
          '',
          'Not a `List`, whose rows are places to go and truncate. These are statements, so they wrap. The tile is decoration; the title carries the meaning.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof IconList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reasons: Story = {
  render: () => (
    <Card padded className="max-w-140">
      <IconList>
        <IconListItem
          icon={<TrendingUp />}
          tone="warning"
          description="Raises in the team this year had a median of 4%, and the largest was 12%."
        >
          A 38% raise
        </IconListItem>
        <IconListItem
          icon={<Layers />}
          tone="warning"
          description="It is over the top of the level’s band."
        >
          Above the band
        </IconListItem>
        <IconListItem
          icon={<CalendarClock />}
          tone="warning"
          description="It lands in a payroll that is already closing."
        >
          Less than 5 days’ notice
        </IconListItem>
      </IconList>
    </Card>
  ),
};

export const Divided: Story = {
  render: () => (
    <Card padded className="max-w-170 py-1.5">
      <IconList divided>
        <IconListItem
          icon={<FilePlus2 />}
          tone="accent"
          description="Published together, as one new version."
          action={
            <Button variant="ghost" size="xs">
              Open draft
            </Button>
          }
        >
          Create 3 settings
        </IconListItem>
        <IconListItem icon={<ShieldCheck />} tone="success" description="Nothing else changes.">
          Check every row first
        </IconListItem>
        <IconListItem icon={<Layers />} description="Its values aren’t kept.">
          Leave one column out
        </IconListItem>
      </IconList>
    </Card>
  ),
};
