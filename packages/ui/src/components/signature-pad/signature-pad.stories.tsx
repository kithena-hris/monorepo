import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SignaturePad } from './signature-pad';

const meta = {
  title: 'Forms/SignaturePad',
  component: SignaturePad,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A signature drawn with a pointer, kept as the strokes (an SVG path), not a picture. Always offered beside typing a name, which is the accessible path.',
      },
    },
  },
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
