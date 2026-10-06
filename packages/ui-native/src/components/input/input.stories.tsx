import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { CircleCheck, Mail, Search } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { Spinner } from '../spinner/spinner.tsx';
import { Text } from '../text/text.tsx';
import { Input, Textarea, type InputProps } from './input.tsx';

const meta = {
  title: 'Forms/Input',
  component: Input,
  parameters: designDocs('input'),
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An input holding its own text, for stories. */
function Live({ initial = '', ...props }: InputProps & { initial?: string }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <Input value={value} onChange={setValue} {...props} />;
}

export const Playground: Story = {
  render: () => <Live placeholder="Type something" />,
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      <Live size="sm" placeholder="Compact · 44" />
      <Live placeholder="Default · 56" />
    </Stack>
  ),
};

export const States: Story = {
  render: () => (
    <Stack className="gap-2.5">
      <Live placeholder="Default" />
      <Live initial="Focused" accessibilityLabel="Focused" autoFocus />
      <Live initial="Invalid" accessibilityLabel="Invalid" invalid />
      <Live initial="Caution" accessibilityLabel="Caution" caution />
      <Live initial="Disabled" accessibilityLabel="Disabled" disabled />
      <Live initial="Read-only" accessibilityLabel="Read-only" readOnly />
    </Stack>
  ),
};

export const Adornments: Story = {
  render: () => (
    <Stack className="gap-2.5">
      <Live
        type="search"
        placeholder="Search"
        startAdornment={<Icon icon={Search} size={19} tone="muted" />}
      />
      <Live
        type="email"
        initial="priya@reach.co"
        accessibilityLabel="Email"
        startAdornment={<Icon icon={Mail} size={19} tone="muted" />}
        endAdornment={<Icon icon={CircleCheck} size={19} tone="success" label="Valid" />}
      />
      <Live
        initial="Loading…"
        accessibilityLabel="Looking up"
        endAdornment={<Spinner size={16} label="Checking" />}
      />
    </Stack>
  ),
};

function Counted(): React.JSX.Element {
  const [value, setValue] = useState(
    'Happy to cover Amara’s design reviews while she’s out. I’ll check in with Omar on Friday.',
  );
  return (
    <Stack className="gap-1.5">
      <Textarea
        value={value}
        onChange={setValue}
        maxLength={500}
        accessibilityLabel="Handover note"
        autoFocus
      />
      <Text variant="caption" tone="subtle" weight="regular" tabular className="self-end">
        {value.length} / 500
      </Text>
    </Stack>
  );
}

export const TextareaStory: Story = {
  name: 'Textarea',
  render: () => <Counted />,
};
