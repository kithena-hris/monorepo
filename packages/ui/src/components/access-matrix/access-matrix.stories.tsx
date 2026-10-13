import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Globe,
  MessageSquareQuote,
  Network,
  User,
  UserRoundCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';

import { Alert } from '../feedback/feedback';
import { Field, FieldControl, FieldLabel } from '../field/field';
import { Switch } from '../switch/switch';
import { AccessMatrix, AccessStrip, type AccessAudience, type AccessValue } from './access-matrix';

const audiences: readonly AccessAudience[] = [
  { id: 'self', label: 'The employee', description: 'The person it’s about', icon: <User /> },
  {
    id: 'manager',
    label: 'Their manager',
    description: 'Direct manager',
    icon: <UserRoundCheck />,
  },
  { id: 'above', label: 'Managers above', description: 'Up to the top', icon: <Network /> },
  { id: 'hr', label: 'HR', description: 'Your HR team', icon: <Users /> },
  { id: 'finance', label: 'Finance', description: 'For payroll', icon: <Wallet /> },
];

/** The strip also shows the directory: one more glyph, which nobody changes. */
const withEveryone: readonly AccessAudience[] = [
  ...audiences,
  {
    id: 'everyone',
    label: 'Everyone',
    description: 'In the directory',
    icon: <Globe />,
    canChange: false,
  },
];

function Live({
  initial,
  highlight,
  everyone = false,
}: {
  readonly initial: AccessValue;
  readonly highlight?: string;
  readonly everyone?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [all, setAll] = useState(everyone);
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Field orientation="horizontal" className="justify-between gap-3">
        <FieldLabel>Everyone can see it</FieldLabel>
        <FieldControl>
          <Switch checked={all} onCheckedChange={setAll} />
        </FieldControl>
      </Field>
      <AccessMatrix
        audiences={audiences}
        value={value}
        allSee={all}
        onChange={setValue}
        {...(highlight === undefined ? {} : { highlight })}
      />
    </div>
  );
}

const meta = {
  title: 'Forms/Access matrix',
  component: AccessMatrix,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Who can see a value and who can change it, as one grid of checkboxes. What is ticked follows from the value alone: changing always includes seeing, so a Can change tick ticks and locks the Can see box beside it, and `allSee` ticks and locks every Can see box. Implied ticks are paler and say why.',
          '',
          'A `<table>` of Reach checkboxes, so each box is announced with its row and column. `AccessStrip` is the same rule, read-only, for a list row: light for sees, solid for changes.',
        ].join('\n'),
      },
    },
  },
  args: { audiences, value: { see: ['self', 'manager'], change: ['hr'] } },
} satisfies Meta<typeof AccessMatrix>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <Live initial={{ see: ['self', 'manager'], change: ['hr'] }} />,
};

export const EveryoneCanSeeIt: Story = {
  name: 'Everyone can see it',
  render: () => (
    <Live
      initial={{
        see: ['self'],
        change: ['self', 'hr'],
      }}
      everyone
    />
  ),
};

export const HrAndFinanceOnly: Story = {
  name: 'HR and Finance only',
  render: () => (
    <Live initial={{ see: ['hr', 'finance'], change: ['hr', 'finance'] }} highlight="finance" />
  ),
};

export const WithAPlainWordsSummary: Story = {
  name: 'With a plain-words summary',
  render: () => (
    <div className="flex max-w-xl flex-col gap-2.5">
      <AccessMatrix
        audiences={audiences.slice(0, 4)}
        value={{ see: ['self', 'manager'], change: ['hr'] }}
        footer={false}
      />
      <Alert tone="accent" title="In plain words" icon={<MessageSquareQuote />}>
        The employee and their manager can see it. Only HR can change it.
      </Alert>
    </div>
  ),
};

export const CompactInAList: Story = {
  name: 'Compact, in a list',
  render: () => (
    <ul className="flex max-w-md flex-col gap-3">
      {(
        [
          ['Employee number', { see: ['self', 'manager'], change: ['hr'] }],
          ['Bank account', { see: ['self'], change: ['self', 'finance'] }],
          ['Work email', { see: ['everyone'], change: ['hr'] }],
        ] as const
      ).map(([name, value]) => (
        <li key={name} className="flex items-center gap-3">
          <span className="text-sm font-semibold">{name}</span>
          <AccessStrip audiences={withEveryone} value={value} className="ms-auto" />
        </li>
      ))}
      <li className="text-sm text-fg-muted">Light = sees. Solid = changes.</li>
    </ul>
  ),
};
