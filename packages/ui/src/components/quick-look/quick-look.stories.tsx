import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageCircle } from 'lucide-react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
import { CompletenessMeter } from '../completeness-meter/completeness-meter';
import { KeyValues } from '../key-values/key-values';
import { QuickLook } from './quick-look';

const meta = {
  title: 'Components/Quick look',
  component: QuickLook,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A peek at a record beside the list. Space on a row opens it, ↑↓ moves through records, ↵ opens the full page and Esc closes it. The heading is a polite live region, so moving on is heard.',
      },
    },
  },
  args: {
    title: 'Adam Novak',
    description: 'Backend engineer · Engineering',
  },
} satisfies Meta<typeof QuickLook>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <QuickLook
      {...args}
      className="max-w-sm"
      media={<Avatar name="Adam Novak" size="2xl" status="success" statusLabel="Active" />}
      href="#adam"
      onClose={() => undefined}
      onPrevious={() => undefined}
      onNext={() => undefined}
      actions={
        <>
          <Button size="sm" startIcon={<MessageCircle aria-hidden />}>
            Message
          </Button>
          <Button size="sm" variant="primary">
            Profile
          </Button>
        </>
      }
    >
      <KeyValues
        items={[
          { label: 'Manager', value: 'Marco Ruiz' },
          { label: 'Location', value: 'Madrid · 19:55' },
          { label: 'Started', value: '2 Sep 2024' },
          { label: 'Employee no.', value: 'ES-00087' },
        ]}
      />
      <CompletenessMeter
        value={82}
        size={44}
        title="2 details missing"
        description="Emergency contact, bank account"
      />
    </QuickLook>
  ),
};
