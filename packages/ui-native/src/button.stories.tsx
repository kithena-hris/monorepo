import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { Button } from './button.tsx';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Request time off' },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'tinted', 'ghost', 'danger'],
    },
    size: { control: 'inline-radio', options: ['md', 'sm'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Loading: Story = { args: { loading: true, children: 'Sending' } };

export const Disabled: Story = { args: { disabled: true } };

function AllVariants(): React.JSX.Element {
  return (
    <View className="gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tinted">Tinted</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Delete request</Button>
      <Button size="sm">Small</Button>
    </View>
  );
}

export const Variants: Story = { render: () => <AllVariants /> };

/** The same set on the dark tokens, so axe checks contrast in both themes. */
export const VariantsDark: Story = { render: () => <AllVariants />, globals: { theme: 'dark' } };
