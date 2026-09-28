import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pencil } from 'lucide-react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { Money } from '../money/money';
import { KeyValues } from './key-values';

const meta = {
  title: 'Components/KeyValues',
  component: KeyValues,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Label and value pairs for record details. Keys are quiet and values are clear. A `<dl>`, so each term is announced with its definition.',
          '',
          '`columns` (the default) lines every value up in one column so they can be scanned without the labels. `split` pushes each value to the far edge of its row, the way a phone lists settings. Under a finger `columns` becomes `split` by itself, because a 160px label column leaves a phone a sliver for the value.',
        ].join('\n'),
      },
    },
  },
  args: {
    items: [
      { label: 'Team', value: 'Engineering' },
      { label: 'Manager', value: 'Jonas Weber' },
      { label: 'Location', value: 'Berlin' },
      { label: 'Start date', value: '2 Sep 2024' },
    ],
  },
} satisfies Meta<typeof KeyValues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <KeyValues {...args} className="max-w-xl" />,
};

export const InACard: Story = {
  name: 'In A Card',
  render: () => (
    <Card className="max-w-xl p-5 touch:p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-display text-md font-bold text-fg">Employment</h3>
        <Button size="sm" variant="ghost" startIcon={<Pencil />}>
          Edit
        </Button>
      </div>
      <KeyValues
        items={[
          { label: 'Contract', value: 'Permanent' },
          { label: 'Hours', value: '40 per week' },
          { label: 'Notice', value: '3 months' },
        ]}
      />
    </Card>
  ),
};

export const RichValues: Story = {
  name: 'Rich Values',
  parameters: {
    docs: {
      description: {
        story:
          'A value can be anything inline: an avatar and a name, a status, a link, a row of badges, an amount behind a privacy mark. The value cell wraps rather than growing a second column.',
      },
    },
  },
  render: () => (
    <KeyValues
      className="max-w-xl"
      items={[
        {
          label: 'Manager',
          value: (
            <>
              <Avatar size="xs" name="Jonas Weber" />
              Jonas Weber
            </>
          ),
        },
        {
          label: 'Status',
          value: (
            <Badge size="sm" tone="success" dot>
              Active
            </Badge>
          ),
        },
        {
          label: 'Email',
          value: (
            <a
              href="mailto:priya@reach.co"
              className="relative text-accent-fg underline underline-offset-3 tap-target"
            >
              priya@reach.co
            </a>
          ),
        },
        {
          label: 'Skills',
          value: ['React', 'TypeScript', 'Figma'].map((skill) => (
            <Badge key={skill} size="sm">
              {skill}
            </Badge>
          )),
        },
        {
          label: 'Salary',
          value: (
            <>
              <Badge size="sm" tone="sensitive">
                Private
              </Badge>
              <Money minorUnits="9200000" currency="EUR" locale="en-GB" />
            </>
          ),
        },
      ]}
    />
  ),
};

export const Split: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'For a narrow panel, a hover card or a table’s detail row, where a label column would squeeze the values.',
      },
    },
  },
  render: () => (
    <KeyValues
      layout="split"
      className="max-w-xs"
      items={[
        { label: 'Local time', value: '14:32 in Berlin' },
        { label: 'Manager', value: 'Nora Becker' },
        { label: 'Days off left', value: '12.5' },
      ]}
    />
  ),
};
