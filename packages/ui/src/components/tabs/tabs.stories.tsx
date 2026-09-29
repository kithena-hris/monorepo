import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, Clock, X } from 'lucide-react';
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
  args: { defaultValue: 'overview', activationMode: 'automatic', orientation: 'horizontal' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const views = [
  { value: 'overview', label: 'Overview', body: 'Role, team, manager and contact details.' },
  { value: 'timeoff', label: 'Time off', body: 'Balances, accruals and pending requests.' },
  { value: 'documents', label: 'Documents', body: 'Signed contract and right-to-work evidence.' },
];

export const Playground: Story = {
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        {views.map((view) => (
          <TabsTrigger key={view.value} value={view.value}>
            {view.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {views.map((view) => (
        <TabsContent key={view.value} value={view.value} className="text-sm text-fg-muted">
          {view.body}
        </TabsContent>
      ))}
    </Tabs>
  ),
};

export const WithIconsAndCounts: Story = {
  name: 'With icons and counts',
  args: { defaultValue: 'pending' },
  parameters: {
    docs: {
      description: {
        story:
          'A count belongs on a tab only when the number is actionable: four requests are waiting. "Declined" has none worth counting, so it shows none. On a phone a set that does not fit scrolls sideways rather than squeezing.',
      },
    },
  },
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        <TabsTrigger value="pending">
          <Clock />
          Pending
          <Badge tone="accent" size="sm">
            4
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="approved">
          <Check />
          Approved
          <Badge size="sm">12</Badge>
        </TabsTrigger>
        <TabsTrigger value="declined">
          <X />
          Declined
        </TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="text-sm text-fg-muted">
        Four requests are waiting for your decision.
      </TabsContent>
      <TabsContent value="approved" className="text-sm text-fg-muted">
        Twelve requests approved this month.
      </TabsContent>
      <TabsContent value="declined" className="text-sm text-fg-muted">
        Nothing declined this month.
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
          'Arrow keys move the focus. Enter or Space opens the tab, which suits tabs that load slowly: arrowing across three tabs should not fire three fetches.',
      },
    },
  },
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        {views.map((view) => (
          <TabsTrigger key={view.value} value={view.value}>
            {view.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {views.map((view) => (
        <TabsContent key={view.value} value={view.value} className="text-sm text-fg-muted">
          Loaded only once you confirmed the selection. {view.body}
        </TabsContent>
      ))}
    </Tabs>
  ),
};

export const Controlled: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The parent owns the value and syncs it to the URL, so the view survives a refresh and can be linked to: `?view=month`. Shown as pill tabs, the form a period switch usually takes.',
      },
    },
  },
  render: function ControlledStory(args) {
    const [view, setView] = useState('month');
    return (
      <div className="max-w-2xl space-y-3">
        <Tabs
          {...args}
          value={view}
          onValueChange={(next) => {
            setView(next);
            args.onValueChange?.(next);
          }}
        >
          <TabsList variant="pill" aria-label="Period">
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="quarter">Quarter</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-sm text-fg-muted">
          <code className="font-mono">?view={view}</code>
        </p>
      </div>
    );
  },
};

export const PillsUnderLines: Story = {
  name: 'Pills under line tabs',
  parameters: {
    docs: {
      description: {
        story:
          'Line tabs for the area, and pills for the view inside it. Never put two rows of line tabs on top of each other: they read as one row that broke.',
      },
    },
  },
  render: (args) => (
    <Tabs {...args} className="max-w-2xl">
      <TabsList>
        {views.map((view) => (
          <TabsTrigger key={view.value} value={view.value}>
            {view.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview">
        <Tabs defaultValue="personal">
          <TabsList variant="pill" aria-label="Overview section">
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="pay">Pay</TabsTrigger>
          </TabsList>
          <TabsContent value="personal" className="text-sm text-fg-muted">
            Name, pronouns, contact details and emergency contacts.
          </TabsContent>
          <TabsContent value="employment" className="text-sm text-fg-muted">
            Contract, hours, manager and team.
          </TabsContent>
          <TabsContent value="pay" className="text-sm text-fg-muted">
            Salary, allowances and bank details.
          </TabsContent>
        </Tabs>
      </TabsContent>
      {views.slice(1).map((view) => (
        <TabsContent key={view.value} value={view.value} className="text-sm text-fg-muted">
          {view.body}
        </TabsContent>
      ))}
    </Tabs>
  ),
};
