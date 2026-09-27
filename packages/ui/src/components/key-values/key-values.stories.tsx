import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '../badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { KeyValues } from './key-values';

const meta = {
  title: 'Components/KeyValues',
  component: KeyValues,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Configured values read back as label and value: a summary somebody reads before deciding whether to open the thing and change it.',
          '',
          'A `<dl>`, so each label is announced with its value. Labels sit above their values, so a long value wraps under its own label, and `columns` spreads pairs across the width the container has rather than the window.',
        ].join('\n'),
      },
    },
  },
  args: {
    items: [
      { label: 'Default time zone', value: 'Europe/Madrid' },
      { label: 'Cohort minimum', value: '10 people' },
      { label: 'Legal entities', value: '2' },
    ],
  },
} satisfies Meta<typeof KeyValues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Three to a row where the container is wide enough; one on a phone. */
export const InACard: Story = {
  args: { columns: 3 },
  render: (args) => (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Organisation</CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValues {...args} />
      </CardContent>
    </Card>
  ),
};

/** A value can be any content: a badge, a count, a sentence that wraps. */
export const RichValues: Story = {
  args: {
    columns: 2,
    items: [
      { label: 'Published', value: 'Version 4, 12 September 2026' },
      { label: 'Unpublished changes', value: <Badge tone="attention">3 changes</Badge> },
      {
        label: 'Provisioning',
        value: 'Okta, linked to 214 people; the token was last rotated 30 days ago',
      },
      { label: 'Webhooks', value: 'None' },
    ],
  },
};
