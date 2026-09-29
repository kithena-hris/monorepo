import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Globe,
  GripVertical,
  Hash,
  Landmark,
  List,
  Lock,
  Network,
  Sparkles,
  Type,
  User,
  UserRoundCheck,
  Users,
  Wallet,
} from 'lucide-react';

import { AccessStrip, type AccessAudience } from '../access-matrix/access-matrix';
import { Badge } from '../badge/badge';
import { FieldRow } from './field-row';

const audiences: readonly AccessAudience[] = [
  { id: 'self', label: 'The employee', icon: <User /> },
  { id: 'manager', label: 'Their manager', icon: <UserRoundCheck /> },
  { id: 'above', label: 'Managers above', icon: <Network /> },
  { id: 'hr', label: 'HR', icon: <Users /> },
  { id: 'finance', label: 'Finance', icon: <Wallet /> },
  { id: 'everyone', label: 'Everyone', icon: <Globe /> },
];

function Assistant({ on }: { readonly on: boolean }) {
  return (
    <span
      role="img"
      aria-label={on ? 'The assistant can read it' : 'Not shared with the assistant'}
      title={on ? 'The assistant can read it' : 'Not shared with the assistant'}
      className={on ? 'text-accent-fg' : 'text-icon-muted'}
    >
      <Sparkles aria-hidden className="size-4" />
    </span>
  );
}

const meta = {
  title: 'Components/Field row',
  component: FieldRow,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One field in the schema editor: its type, when it’s asked, who can see and change it, and whether the assistant can read it. A changed field has a warning edge and says so in words; the selected one has a ring.',
      },
    },
  },
  args: {
    icon: <Hash />,
    title: 'Employee number',
    description: 'HR fills it in',
    code: 'employee_number',
  },
} satisfies Meta<typeof FieldRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <FieldRow
      {...args}
      onOpen={() => undefined}
      handle={<GripVertical aria-hidden className="size-4" />}
      badges={
        <Badge size="sm" variant="outline">
          Built in
        </Badge>
      }
      access={
        <AccessStrip audiences={audiences} value={{ see: ['self', 'manager'], change: ['hr'] }} />
      }
      trailing={<Assistant on={false} />}
      className="max-w-3xl"
    />
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-2">
      <FieldRow
        icon={<Type />}
        title="Job title"
        description="At sign-up"
        code="job_title"
        onOpen={() => undefined}
        badges={
          <Badge size="sm" tone="accent">
            Required
          </Badge>
        }
        access={<AccessStrip audiences={audiences} value={{ see: ['everyone'], change: ['hr'] }} />}
        trailing={<Assistant on />}
      />
      <FieldRow
        icon={<List />}
        title="Cost centre"
        description="HR fills it in"
        code="cost_centre"
        changed
        onOpen={() => undefined}
        badges={
          <Badge size="sm" tone="warning">
            New in v8
          </Badge>
        }
        access={
          <AccessStrip audiences={audiences} value={{ see: ['hr', 'finance'], change: ['hr'] }} />
        }
        trailing={<Assistant on={false} />}
      />
      <FieldRow
        icon={<Landmark />}
        title="Bank account"
        description="During onboarding"
        code="bank_account"
        selected
        onOpen={() => undefined}
        badges={
          <>
            <Badge size="sm">
              <Lock aria-hidden />
              Encrypted
            </Badge>
            <Badge size="sm" tone="warning">
              Needs approval
            </Badge>
          </>
        }
        access={
          <AccessStrip
            audiences={audiences}
            value={{ see: ['self', 'finance'], change: ['self', 'finance'] }}
          />
        }
        trailing={<Assistant on={false} />}
      />
    </div>
  ),
};
