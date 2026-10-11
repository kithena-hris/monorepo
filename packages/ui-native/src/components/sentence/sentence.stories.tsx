import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Sentence } from './sentence.tsx';

const meta = {
  title: 'Components/Sentence',
  component: Sentence,
  parameters: designDocs('sentence'),
  args: {
    parts: [
      { id: 'who', text: 'HR' },
      ' fills it in. ',
      { id: 'see', text: 'The employee, their manager and HR' },
      ' can see it.',
    ],
  },
} satisfies Meta<typeof Sentence>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

function Choosing() {
  const [open, setOpen] = useState<string | null>('see');
  return (
    <Sentence
      onPartPress={(id) => {
        setOpen((was) => (was === id ? null : id));
      }}
      parts={[
        { id: 'who', text: 'HR', active: open === 'who' },
        ' fills it in. ',
        { id: 'see', text: 'The employee, their manager and HR', active: open === 'see' },
        ' can see it. It’s ',
        { id: 'sensitive', text: 'not sensitive', disabled: true },
        '.',
      ]}
    />
  );
}

export const OnePartOpen: Story = {
  name: 'One part open',
  render: () => <Choosing />,
};
