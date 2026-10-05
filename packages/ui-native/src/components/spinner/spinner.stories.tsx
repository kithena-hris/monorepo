import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Spinner } from './spinner.tsx';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  parameters: designDocs('spinner'),
  args: { size: 24 },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const SIZES = [12, 16, 20, 24, 32, 48];

export const Sizes: Story = {
  render: () => (
    <Inline gap={4} align="end" className="gap-x-[18px]">
      {SIZES.map((size) => (
        <Stack key={size} gap={2} align="center" className="gap-1.5">
          <Spinner size={size} label={`Loading, ${String(size)} points`} />
          <Text variant="caption" tone="muted" mono>
            {String(size)}
          </Text>
        </Stack>
      ))}
    </Inline>
  ),
};

export const InheritingColour: Story = {
  name: 'Inheriting colour',
  parameters: {
    docs: {
      description: {
        story:
          'Inside a control the spinner takes the label’s colour and is hidden from a screen reader, because the control already says it is busy. Beside text it takes the text’s tone.',
      },
    },
  },
  render: () => (
    <Inline gap={2} className="gap-2.5">
      <Button variant="primary" loading>
        Saving
      </Button>
      <Button loading>Saving</Button>
      <Inline gap={2} wrap={false}>
        <Spinner size={16} tone="danger" decorative />
        <Text variant="subhead" weight="medium" tone="danger">
          Retrying
        </Text>
      </Inline>
    </Inline>
  ),
};
