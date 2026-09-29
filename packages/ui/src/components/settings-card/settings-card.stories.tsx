import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileText, Link, Shield } from 'lucide-react';

import { Badge } from '../badge/badge';
import { SettingsCard } from './settings-card';

const meta = {
  title: 'Components/Settings card',
  component: SettingsCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A link to one area of settings that summarises its current state, so admins can see what’s set without opening it. The whole card is one `<a>`; a badge marks the one that needs attention.',
      },
    },
  },
  args: {
    href: '#fields',
    icon: <FileText />,
    title: 'Employee fields',
    description: 'The details kept on each person, who sees them and when they’re asked.',
    meta: '18 fields · version 7',
  },
} satisfies Meta<typeof SettingsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <SettingsCard {...args} className="max-w-lg" />,
};

export const WithAStatus: Story = {
  name: 'With a status',
  render: () => (
    <div className="grid max-w-3xl gap-2.5">
      <SettingsCard
        href="#fields"
        icon={<FileText />}
        title="Employee fields"
        description="The details kept on each person."
        meta="18 fields · version 7"
        badge={
          <Badge size="sm" tone="warning">
            1 draft
          </Badge>
        }
      />
      <SettingsCard
        href="#roles"
        icon={<Shield />}
        title="Roles"
        description="Who has HR, administrator and finance access."
        meta="Nobody in finance"
        badge={
          <Badge size="sm" tone="warning">
            Needs attention
          </Badge>
        }
      />
    </div>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <SettingsCard
      href="#integrations"
      icon={<Link />}
      title="Integrations"
      description="Chat apps, webhooks and identity provider sync."
      meta="Nothing connected yet"
      className="max-w-lg"
    />
  ),
};
