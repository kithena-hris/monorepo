import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { Button } from '../button/button.tsx';
import { AdoptSignatureDialog } from './adopt-signature.tsx';
import { Signature, type SignatureValue } from './signature.tsx';

const meta = {
  title: 'Forms/Signature',
  component: Signature,
  args: {
    value: { kind: 'typed', text: 'Ada Lovelace', style: 'flowing' },
    label: 'Ada Lovelace’s signature',
  },
  decorators: [
    (Story) => (
      <View className="h-24 w-full rounded-lg bg-surface-sunken">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof Signature>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flowing: Story = {};

export const Light: Story = {
  args: { value: { kind: 'typed', text: 'Ada Lovelace', style: 'light' } },
};

export const Bold: Story = {
  args: { value: { kind: 'typed', text: 'Ada Lovelace', style: 'bold' } },
};

export const Initials: Story = { args: { initials: true } };

export const Drawn: Story = {
  args: {
    value: {
      kind: 'drawn',
      path: 'M 40 80 L 70 40 L 95 85 L 120 50 L 150 82 L 190 45 L 230 78 M 250 60 L 330 60',
    },
  },
};

/** Adopting one: the name already typed, in each face, or drawn. */
export const Adopting: Story = {
  render: function Adopting() {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState<SignatureValue | null>(null);
    return (
      <View className="h-full w-full items-center justify-center gap-2">
        {value === null ? null : <Signature value={value} label="Ada Lovelace’s signature" />}
        <Button
          onPress={() => {
            setOpen(true);
          }}
        >
          Adopt your signature
        </Button>
        <AdoptSignatureDialog
          open={open}
          name="Ada Lovelace"
          action="Adopt and sign"
          onOpenChange={setOpen}
          onAdopt={(v) => {
            setValue(v);
            setOpen(false);
          }}
        />
      </View>
    );
  },
};
