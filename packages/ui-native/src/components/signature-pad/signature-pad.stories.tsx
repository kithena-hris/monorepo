import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { SignaturePad } from './signature-pad.tsx';

const meta = {
  title: 'Forms/SignaturePad',
  component: SignaturePad,
  args: { value: '', onValueChange: () => undefined, label: 'Draw your signature' },
} satisfies Meta<typeof SignaturePad>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: (args) => {
    const [value, setValue] = useState('');
    return <SignaturePad {...args} value={value} onValueChange={setValue} />;
  },
};

export const Drawn: Story = {
  args: {
    value: 'M 40 80 L 70 40 L 95 85 L 120 50 L 150 82 L 190 45 L 230 78 M 250 60 L 330 60',
  },
};
