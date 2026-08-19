import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, FileText, User, Wallet } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../badge/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  subcomponents: { TabsList, TabsTrigger, TabsContent },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Peer views of the same subject.',
          '',
          '**Tabs are not navigation and not a wizard.** If the panels have an order the user must follow, use a stepper. If they are separate pages, use routes: otherwise a refresh drops the user back on the first tab and a link to "the compensation view" cannot exist.',
          '',
          '### Notes',
          '',
          '- The list is a real tablist: arrow keys move, Home/End jump, and the panel is associated with its trigger.',
          '- `activationMode="manual"` decouples focus from selection, which matters when a panel is expensive to render: arrowing across five tabs should not fire five fetches.',
          '- A count badge belongs on the trigger only when the number is actionable. "Documents (0)" is noise.',
          '- Disabled tabs stay visible so the set of views is stable; the reason belongs in the panel or a tooltip, not in the absence of a tab.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    defaultValue: {
      description: 'Uncontrolled starting tab.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Value' },
    },
    value: {
      description: 'Controlled selected tab. Pair with `onValueChange`.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Value' },
    },
    orientation: {
      description: 'Drives which arrow keys move between triggers.',
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
      table: {
        type: { summary: "'horizontal' | 'vertical'" },
        defaultValue: { summary: 'horizontal' },
        category: 'Behaviour',
      },
    },
    activationMode: {
      description:
        '`automatic` selects on focus; `manual` waits for Enter or Space. Use `manual` when a panel is expensive.',
      control: 'inline-radio',
      options: ['automatic', 'manual'],
      table: {
        type: { summary: "'automatic' | 'manual'" },
        defaultValue: { summary: 'automatic' },
        category: 'Behaviour',
      },
    },
    onValueChange: { action: 'tab changed', table: { category: 'Events' } },
  },
  args: { defaultValue: 'profile', activationMode: 'automatic', orientation: 'horizontal' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="compensation">Compensation</TabsTrigger>
        <TabsTrigger value="timeoff">Time off</TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="text-sm text-fg-muted">
        Identity, contact details and reporting line.
      </TabsContent>
      <TabsContent value="compensation" className="text-sm text-fg-muted">
        Effective-dated salary and allowance records.
      </TabsContent>
      <TabsContent value="timeoff" className="text-sm text-fg-muted">
        Balances, accruals and pending requests.
      </TabsContent>
    </Tabs>
  ),
};

export const WithIconsAndCounts: Story = {
  name: 'With icons and counts',
  parameters: {
    docs: {
      description: {
        story:
          'The count on "Time off" is actionable, two requests are waiting. The disabled tab names its own condition rather than disappearing.',
      },
    },
  },
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        <TabsTrigger value="profile">
          <User />
          Profile
        </TabsTrigger>
        <TabsTrigger value="compensation">
          <Wallet />
          Compensation
        </TabsTrigger>
        <TabsTrigger value="timeoff">
          <CalendarDays />
          Time off
          <Badge tone="warning" size="sm">
            2
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="documents" disabled>
          <FileText />
          Documents
        </TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="text-sm text-fg-muted">
        Identity, contact details and reporting line.
      </TabsContent>
      <TabsContent value="compensation" className="text-sm text-fg-muted">
        Effective-dated salary and allowance records.
      </TabsContent>
      <TabsContent value="timeoff" className="text-sm text-fg-muted">
        Two requests are awaiting your approval.
      </TabsContent>
      <TabsContent value="documents" className="text-sm text-fg-muted">
        Requires the Documents module.
      </TabsContent>
    </Tabs>
  ),
};

export const ManualActivation: Story = {
  name: 'Manual activation',
  args: { activationMode: 'manual' },
  parameters: {
    docs: {
      description: {
        story:
          'Arrow across the triggers: focus moves but the panel does not change until Enter or Space. The right default when each panel costs a network round trip.',
      },
    },
  },
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="compensation">Compensation</TabsTrigger>
        <TabsTrigger value="timeoff">Time off</TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="text-sm text-fg-muted">
        Focus moved here without loading anything.
      </TabsContent>
      <TabsContent value="compensation" className="text-sm text-fg-muted">
        Loaded only once you confirmed the selection.
      </TabsContent>
      <TabsContent value="timeoff" className="text-sm text-fg-muted">
        Same again.
      </TabsContent>
    </Tabs>
  ),
};

export const Controlled: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Selected tab owned by the caller, how you would sync it to a query parameter so the view survives a refresh and can be linked to.',
      },
    },
  },
  render: function ControlledStory(args) {
    const [tab, setTab] = useState('compensation');
    return (
      <div className="max-w-2xl space-y-3">
        <Tabs
          {...args}
          value={tab}
          onValueChange={(next) => {
            setTab(next);
            args.onValueChange?.(next);
          }}
        >
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="compensation">Compensation</TabsTrigger>
            <TabsTrigger value="timeoff">Time off</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="text-sm text-fg-muted">
            Identity and reporting line.
          </TabsContent>
          <TabsContent value="compensation" className="text-sm text-fg-muted">
            Effective-dated salary records.
          </TabsContent>
          <TabsContent value="timeoff" className="text-sm text-fg-muted">
            Balances and accruals.
          </TabsContent>
        </Tabs>
        <p className="font-mono text-xs text-fg-muted">?tab={tab}</p>
      </div>
    );
  },
};
