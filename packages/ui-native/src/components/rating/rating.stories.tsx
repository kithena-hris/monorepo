import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Field, FieldLabel } from '../field/field.tsx';
import { Textarea } from '../input/input.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Rating, type RatingProps } from './rating.tsx';

const meta = {
  title: 'Forms/Rating',
  component: Rating,
  parameters: designDocs('rating'),
} satisfies Meta<typeof Rating>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

const meanings = ['Below', 'Partly meets', 'Meets', 'Exceeds', 'Outstanding'] as const;

function Live({
  initial,
  ...props
}: Omit<RatingProps, 'value' | 'onChange'> & { initial: number }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <Rating value={value} onChange={setValue} {...props} />;
}

export const Playground: Story = {
  render: () => <Live initial={3} label="Interview performance" />,
};

export const WithMeanings: Story = {
  name: 'With meanings',
  render: () => (
    <Stack gap={3}>
      <Live
        initial={4}
        label="Performance"
        valueLabels={[
          'Below expectations',
          'Partly meets expectations',
          'Meets expectations',
          'Exceeds expectations',
          'Outstanding',
        ]}
        showValue
      />
      <Text variant="subhead" tone="muted">
        1 Below · 2 Partly meets · 3 Meets · 4 Exceeds · 5 Outstanding
      </Text>
    </Stack>
  ),
};

export const FromTheKeyboard: Story = {
  name: 'From the keyboard',
  render: () => (
    <Stack gap={3}>
      <Live initial={3} label="Interview performance" />
      <Text variant="footnote" tone="muted">
        ← → change · 0 clear
      </Text>
    </Stack>
  ),
  // Where a Tab lands: the group, its ring on the chosen star.
  play: ({ canvasElement }) => {
    type Focusable = { focus: (options: { focusVisible: boolean }) => void };
    const canvas = canvasElement as unknown as {
      querySelector: (selector: string) => Focusable | null;
    };
    canvas.querySelector('[role="radiogroup"]')?.focus({ focusVisible: true });
  },
};

export const DisplayingAnAverage: Story = {
  name: 'Displaying an average',
  render: () => (
    <Inline gap={2} wrap={false}>
      <Rating value={4.3} label="Average rating" readOnly size={22} />
      <Text weight="bold" tabular>
        4.3
      </Text>
      <Text variant="subhead" tone="muted">
        from 18 reviews
      </Text>
    </Inline>
  ),
};

export const SizesAndSymbols: Story = {
  name: 'Sizes and symbols',
  render: () => (
    <Stack gap={3}>
      <Live initial={4} label="Small" size={16} />
      <Live initial={4} label="Medium" size={24} />
      <Live initial={4} label="Large" size={36} />
      <Live initial={3} label="How much you enjoyed it" size={28} symbol="heart" tone="danger" />
    </Stack>
  ),
};

function Review(): React.JSX.Element {
  const [comments, setComments] = useState(
    'Priya led the payroll migration and unblocked two teams.',
  );
  return (
    <Card>
      <Stack gap={4}>
        <Text variant="title3" weight="bold">
          Mid-year review
        </Text>
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted">
            Delivery
          </Text>
          <Live initial={4} label="Delivery" valueLabels={meanings} showValue />
        </Stack>
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted">
            Collaboration
          </Text>
          <Live initial={5} label="Collaboration" valueLabels={meanings} showValue />
        </Stack>
        <Field>
          <FieldLabel>Comments</FieldLabel>
          <Textarea value={comments} onChange={setComments} />
        </Field>
        <Button variant="primary" fullWidth>
          Submit review
        </Button>
      </Stack>
    </Card>
  );
}

export const InAReviewForm: Story = {
  name: 'In a review form',
  render: () => <Review />,
};
