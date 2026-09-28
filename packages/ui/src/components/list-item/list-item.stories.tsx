import type { Meta, StoryObj } from '@storybook/react-vite';
import { Calendar, Check, Ellipsis, FileText, X } from 'lucide-react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Switch } from '../switch/switch';
import { List, ListItem } from './list-item';

const meta = {
  title: 'Components/List item',
  component: ListItem,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'The row that most lists are built from. The content in the middle is always the same, and what goes before and after it changes.',
          '',
          '`List` is the rounded group; `ListItem` is one row in it. A row that opens something passes its link or button as the child with `asChild`, so the whole row is one target named by its title. Such a row holds a chevron or a value after the text, never a second control.',
        ].join('\n'),
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-md">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    leading: { control: false, table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    description: {
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    supporting: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    meta: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    trailing: { control: false, table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    chevron: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'Content' } },
    selected: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    disabled: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    asChild: {
      description: 'The row becomes its child, a link or a button, whose text is the title.',
      control: false,
      table: { type: { summary: 'boolean' }, category: 'Behaviour' },
    },
  },
} satisfies Meta<typeof ListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const people = [
  { name: 'Priya Shah', role: 'Product designer', status: ['Active', 'success'] },
  { name: 'Jonas Weber', role: 'Engineering manager', status: ['On leave', 'info'] },
  { name: 'Amara Okafor', role: 'People partner', status: ['Onboarding', 'accent'] },
  { name: 'Mei Tanaka', role: 'Finance lead', status: ['Active', 'success'] },
] as const;

export const OneLine: Story = {
  name: 'One line',
  render: () => (
    <List>
      {['Personal', 'Employment', 'Pay'].map((section) => (
        <ListItem key={section} asChild chevron>
          <a href={`#${section.toLowerCase()}`} className="min-h-11 touch:min-h-13">
            {section}
          </a>
        </ListItem>
      ))}
    </List>
  ),
};

export const TwoLines: Story = {
  name: 'Two lines',
  render: () => (
    <List>
      {people.slice(0, 3).map(({ name, role, status }) => (
        <ListItem
          key={name}
          leading={<Avatar name={name} size="lg" />}
          description={role}
          trailing={
            <Badge tone={status[1]} size="sm" dot>
              {status[0]}
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
          leading={<Avatar name={author} size="lg" />}
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
      <ListItem leading={<Avatar name="Priya Shah" size="lg" />} description="People">
        Avatar
      </ListItem>
      <ListItem
        leading={
          <span className="grid size-7.5 place-items-center rounded-xs bg-chart-3 text-fg-on-solid dark:text-fg-on-invert">
            <Calendar aria-hidden="true" className="size-4" />
          </span>
        }
        description="Settings and destinations"
      >
        Icon tile
      </ListItem>
      <ListItem
        leading={<FileText aria-hidden="true" className="size-5 text-fg-muted" />}
        description="Files"
      >
        Plain icon
      </ListItem>
      <ListItem
        leading={<Checkbox defaultChecked aria-label="Select Checkbox row" />}
        description="Selection"
      >
        Checkbox
      </ListItem>
    </List>
  ),
};

export const TrailingOptions: Story = {
  name: 'Trailing options',
  render: () => (
    <List>
      <ListItem asChild description="Opens something" chevron>
        <a href="#chevron">Chevron</a>
      </ListItem>
      <ListItem description="Read-only detail" trailing={<span className="text-sm">Berlin</span>}>
        Value
      </ListItem>
      <ListItem
        description="Applies straight away"
        trailing={<Switch defaultChecked aria-label="Switch row setting" />}
      >
        Switch
      </ListItem>
      <ListItem
        description="One action"
        trailing={
          <Button variant="primary" size="sm">
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
        asChild
        selected
        leading={<Avatar name="Priya Shah" size="lg" />}
        description="Selected"
        trailing={<Check aria-hidden="true" className="size-4.5 text-accent-fg" />}
      >
        <button type="button" aria-pressed="true">
          Priya Shah
        </button>
      </ListItem>
      <ListItem asChild leading={<Avatar name="Jonas Weber" size="lg" />} description="Default">
        <button type="button" aria-pressed="false">
          Jonas Weber
        </button>
      </ListItem>
      <ListItem
        disabled
        leading={<Avatar name="Yuki Sato" size="lg" />}
        description="Invited, not active yet"
      >
        Yuki Sato
      </ListItem>
    </List>
  ),
};

export const HoverActions: Story = {
  name: 'Hover actions',
  parameters: {
    docs: {
      description: {
        story:
          'At a desk, a row’s quick actions appear on hover and on keyboard focus. There is no hover under a finger, so there they are always shown.',
      },
    },
  },
  render: () => (
    <List>
      {(
        [
          ['Amara Okafor', 'Vacation · 14–18 Oct'],
          ['Mei Tanaka', 'Expense · €248.00'],
        ] as const
      ).map(([name, request]) => (
        <ListItem
          key={name}
          leading={<Avatar name={name} size="lg" />}
          description={request}
          trailing={
            <span className="flex gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                startIcon={<Check aria-hidden="true" />}
                aria-label={`Approve ${name}`}
              />
              <Button
                variant="ghost"
                size="sm"
                startIcon={<X aria-hidden="true" />}
                aria-label={`Decline ${name}`}
              />
              <Button
                variant="ghost"
                size="sm"
                startIcon={<Ellipsis aria-hidden="true" />}
                aria-label={`More for ${name}`}
              />
            </span>
          }
          className="hover:bg-surface-sunken"
        >
          {name}
        </ListItem>
      ))}
    </List>
  ),
};

export const WithSectionHeaders: Story = {
  name: 'With section headers',
  render: () => (
    <div className="flex flex-col gap-4">
      {(
        [
          ['Today', people.slice(0, 2)],
          ['Yesterday', people.slice(2, 4)],
        ] as const
      ).map(([heading, group]) => (
        <section key={heading} aria-labelledby={`list-${heading}`} className="flex flex-col gap-2">
          <h3
            id={`list-${heading}`}
            className="px-1 text-xs font-semibold text-fg-subtle touch:px-4"
          >
            {heading}
          </h3>
          <List>
            {group.map(({ name, role }) => (
              <ListItem key={name} leading={<Avatar name={name} size="md" />} description={role}>
                {name}
              </ListItem>
            ))}
          </List>
        </section>
      ))}
    </div>
  ),
};
