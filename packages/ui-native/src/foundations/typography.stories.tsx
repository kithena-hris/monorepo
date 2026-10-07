import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { Button } from '../components/button/button.tsx';
import { Inline, Stack } from '../components/layout/layout.tsx';
import { Text, type TextProps } from '../components/text/text.tsx';
import { designDocs } from '../docs/design.ts';
import { TypeTable } from '../docs/type-scale.tsx';

const meta = {
  title: 'Foundations/Typography',
  component: Text,
  parameters: designDocs('typography'),
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Display to Caption, the platform’s own text styles. Line heights are ratios, so the same length on both platforms; Display through Title 3 are headings to a screen reader.',
      },
    },
  },
  render: () => <TypeTable />,
};

const WEIGHTS = [
  ['400', 'regular', 'Regular'],
  ['500', 'medium', 'Medium'],
  ['600', 'semibold', 'Semibold'],
  ['700', 'bold', 'Bold'],
] as const;

export const Weights: Story = {
  render: () => (
    <Stack gap={2} className="gap-2.5">
      {WEIGHTS.map(([value, weight, name]) => (
        <Inline key={value} gap={4} wrap={false} align="baseline">
          <Text variant="caption" tone="muted" mono className="w-10">
            {value}
          </Text>
          <Text variant="title2" weight={weight} accessibilityRole="text">
            {`${name} · Aa 123`}
          </Text>
        </Inline>
      ))}
    </Stack>
  ),
};

const TONES: readonly [NonNullable<TextProps['tone']>, string, string][] = [
  ['default', 'Primary text', '--reach-color-fg'],
  ['muted', 'Secondary text', '--reach-color-fg-muted'],
  ['subtle', 'Placeholder, meta', '--reach-color-fg-subtle'],
  ['disabled', 'Disabled', '--reach-color-fg-disabled'],
  ['accent', 'Links', '--reach-color-accent-fg'],
  ['danger', 'Errors', '--reach-color-danger-fg'],
  ['success', 'Positive change', '--reach-color-success-fg'],
];

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`subtle` is darker than the design’s third ink so it clears 4.5:1 on every fill it sits on; disabled text is exempt from contrast, as WCAG allows.',
      },
    },
  },
  render: () => (
    <Stack gap={2} className="gap-2.5">
      {TONES.map(([tone, use, token]) => (
        <Inline key={tone} justify="between" wrap={false} align="baseline">
          {tone === 'disabled' ? (
            /*
             * On a genuinely disabled control, not as prose: WCAG exempts
             * inactive controls from 4.5:1, which is the only reason this ink
             * may be this faint. As live text the gate fails it, as it should.
             */
            <Button variant="link" disabled>
              {use}
            </Button>
          ) : (
            <Text tone={tone} weight="medium">
              {use}
            </Text>
          )}
          <Text variant="caption" weight="regular" tone="muted" mono>
            {token}
          </Text>
        </Inline>
      ))}
    </Stack>
  ),
};

export const Numbers: Story = {
  render: () => (
    <Stack gap={3}>
      <Inline gap={10} align="start">
        <Stack gap={1}>
          <Text variant="caption" weight="semibold" tone="muted">
            Tabular
          </Text>
          <Text variant="title2" weight="semibold" tabular accessibilityRole="text">
            {'1,111.11\n8,888.88'}
          </Text>
        </Stack>
        <Stack gap={1}>
          <Text variant="caption" weight="semibold" tone="muted">
            Proportional
          </Text>
          <Text variant="title2" weight="semibold" accessibilityRole="text">
            {'1,111.11\n8,888.88'}
          </Text>
        </Stack>
      </Inline>
      <Text variant="subhead" tone="muted">
        Use tabular figures wherever numbers line up in columns or change live.
      </Text>
    </Stack>
  ),
};

function Bullet({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Inline gap={2} wrap={false} align="start">
      <View aria-hidden>
        <Text tone="muted" className="leading-[1.6]">
          •
        </Text>
      </View>
      <Text tone="muted" className="flex-1 leading-[1.6]">
        {children}
      </Text>
    </Inline>
  );
}

export const Prose: Story = {
  render: () => (
    <View>
      <Text variant="title2">Parental leave</Text>
      <Text tone="muted" className="mt-2.5 leading-[1.6]">
        Everyone at Reach gets up to{' '}
        <Text weight="bold" className="leading-[1.6]">
          14 weeks
        </Text>{' '}
        of paid parental leave in the first year. You can take it in one block or split it.
      </Text>
      <View className="mt-3 pl-1">
        <Bullet>Tell your manager 8 weeks before</Bullet>
        <Bullet>
          Book it in{' '}
          <Text tone="accent" className="leading-[1.6]">
            Time off
          </Text>
        </Bullet>
      </View>
    </View>
  ),
};

export const MeasureAndTruncation: Story = {
  name: 'Measure And Truncation',
  parameters: {
    docs: {
      description: {
        story:
          '`numberOfLines` truncates with an ellipsis. Always show the full text somewhere else, because truncation hides information.',
      },
    },
  },
  render: () => (
    <Stack gap={3} className="gap-3.5">
      <Text tone="muted" className="leading-[1.55]">
        Keep lines under 72 characters. Longer lines are harder to track back to the start,
        especially in policies and descriptions people actually need to read.
      </Text>
      <Text variant="subhead" weight="semibold" numberOfLines={1} className="max-w-[240px]">
        Principal Staff Engineer, Platform Infrastructure
      </Text>
      <Text variant="subhead" tone="muted" numberOfLines={2} className="max-w-[300px]">
        Two-line clamp for descriptions in cards. Always show the full text somewhere, in a tooltip
        or on the detail page, because truncation hides information.
      </Text>
    </Stack>
  ),
};
