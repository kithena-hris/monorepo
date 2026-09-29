import type { Meta, StoryObj } from '@storybook/react-vite';
import { Lock } from 'lucide-react';
import { useState } from 'react';

import { KeyValues } from '../key-values/key-values';
import { MaskedValue } from './masked-value';

const meta = {
  title: 'Components/Masked value',
  component: MaskedValue,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Sensitive values stay hidden until someone asks with a reason. They reveal for a limited time, and every reveal is logged by whoever handles `onReveal`.',
          '',
          'Masked shows what is safe to show (the year, the last four), so the reader knows a value is there. Revealed sits on a warning wash with its countdown, read from the clock each second, and hides itself when the time runs out.',
        ].join('\n'),
      },
    },
  },
  args: { masked: '•• ••• 1994', label: 'date of birth' },
} satisfies Meta<typeof MaskedValue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Masked: Story = {
  args: { onReveal: () => undefined },
};

export const RevealedWithACountdown: Story = {
  name: 'Revealed, with a countdown',
  render: (args) => {
    const [expiresAt] = useState(() => Date.now() + 14 * 60_000 + 52_000);
    return (
      <MaskedValue {...args} value="14 Mar 1994" expiresAt={expiresAt} onHide={() => undefined} />
    );
  },
};

/** Its own component, so the story's source reads as one line rather than a tree of props. */
function ProfileRow() {
  const [shown, setShown] = useState(false);
  return (
    <KeyValues
      layout="aligned"
      className="max-w-xl"
      items={[
        { label: 'Legal name', value: 'Adam Novak' },
        {
          id: 'dob',
          label: (
            <span className="flex items-center gap-1.5">
              Date of birth <Lock aria-hidden className="size-3 text-fg-subtle" />
            </span>
          ),
          value: (
            <MaskedValue
              masked="•• ••• 1994"
              label="date of birth"
              value={shown ? '14 Mar 1994' : null}
              expiresAt={shown ? Date.now() + 15 * 60_000 : null}
              onReveal={() => {
                setShown(true);
              }}
              onHide={() => {
                setShown(false);
              }}
            />
          ),
        },
      ]}
    />
  );
}

export const InAProfileRow: Story = {
  name: 'In a profile row',
  render: () => <ProfileRow />,
};
