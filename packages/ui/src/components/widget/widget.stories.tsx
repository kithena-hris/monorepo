import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { icons } from '../../icons';
import { List, ListItem } from '../list-item/list-item';
import { Stat } from '../stat/stat';
import { Widget, WidgetGrid } from './widget';

const meta = {
  title: 'Components/Widget',
  component: Widget,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A dashboard is a `WidgetGrid` of `Widget`s.',
          '',
          'The grid has columns of one fixed width (`md` 19rem, `sm` 13rem) and leaves the rest of the row empty rather than stretching. A widget spans one to four columns and falls back to as many as the container has.',
          '',
          'A `List` inside a widget is its body (`flush`), not a card inside a card.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof Widget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dashboard: Story = {
  args: { title: 'To do' },
  render: () => (
    <WidgetGrid>
      <Widget
        title="To do"
        icon={<icons.inbox />}
        tone="chart-1"
        meta="3"
        action={
          <Button variant="link" size="sm">
            Open Inbox
          </Button>
        }
        flush
        span={2}
      >
        <List>
          <ListItem description="People · Onboarding" icon={<icons.list />}>
            Finish your profile
          </ListItem>
          <ListItem description="Time Off · 26–30 Oct" icon={<icons.approve />}>
            Approve Leo’s time off
          </ListItem>
        </List>
      </Widget>
      <Widget title="Vacation" icon={<icons.vacation />} tone="chart-2">
        <Stat label="Days left" value="11.5" />
      </Widget>
      <Widget
        title="Who is away"
        icon={<icons.calendar />}
        meta={<Badge size="sm">2</Badge>}
        flush
      >
        <List>
          <ListItem description="Back Mon 5 Oct">Hana Kim</ListItem>
          <ListItem description="Back Fri 9 Oct">Ravi Patel</ListItem>
        </List>
      </Widget>
    </WidgetGrid>
  ),
};

export const Tiles: Story = {
  args: { title: 'Tiles' },
  render: () => (
    <WidgetGrid size="sm">
      {['Vacation', 'Personal day', 'Comp time', 'Sick'].map((name) => (
        <Widget key={name} size="sm" title={name}>
          <Stat label="Left" value="11.5" unit="days" />
        </Widget>
      ))}
    </WidgetGrid>
  ),
};
