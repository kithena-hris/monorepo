import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '../field/field';
import { KeyRecorder } from './key-recorder';

const meta = {
  title: 'Forms/KeyRecorder',
  component: KeyRecorder,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A field that records a keyboard shortcut.',
          '',
          'Press it and it listens: one chord, or two in a row (G then D), or one with a modifier (⌘⇧K), which is taken at once. What is pressed while it listens goes nowhere else, so recording a key that already does something does not do it.',
          '',
          '### It never traps the keyboard',
          '',
          'Escape cancels; Tab, or leaving it, cancels and moves on as usual (WCAG 2.1.2).',
          '',
          '### Refusing keys is the caller’s',
          '',
          'It reports what was pressed. Whether that clashes with another shortcut is the app’s to decide, and to say on the `Field`: the error names the clash, and the keys it holds stay what they were.',
        ].join('\n'),
      },
    },
  },
  args: { value: ['g', 'd'], onValueChange: () => undefined },
} satisfies Meta<typeof KeyRecorder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [keys, setKeys] = useState<readonly string[]>(args.value);
    return (
      <Field className="w-72">
        <FieldLabel>Go to inbox</FieldLabel>
        <FieldControl>
          <KeyRecorder {...args} value={keys} onValueChange={setKeys} />
        </FieldControl>
        <FieldDescription>Press to record new keys: one, or two in a row.</FieldDescription>
      </Field>
    );
  },
};

export const Refused: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Keys that clash: the field is invalid, the error names what the keys already do, and the recorder keeps the keys it had.',
      },
    },
  },
  render: (args) => (
    <Field className="w-72" invalid>
      <FieldLabel>Go to inbox</FieldLabel>
      <FieldControl>
        <KeyRecorder {...args} value={['g', 'n']} />
      </FieldControl>
      <FieldError>G then P already opens Projects. Choose another.</FieldError>
    </Field>
  ),
};
