import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { AutoGrid, Inline, Stack } from '../components/layout/layout.tsx';
import { Text } from '../components/text/text.tsx';
import { designDocs } from '../docs/design.ts';
import { TypeTable } from '../docs/type-scale.tsx';
import { durations } from '../lib/motion.ts';

const meta = {
  title: 'Foundations/Tokens',
  parameters: designDocs('tokens'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/*
 * Every class is written out whole: Tailwind compiles the class names it can
 * see in the source, and `bg-${name}` is a name it cannot.
 */
const SEMANTIC = [
  ['Background', 'bg-canvas', '--reach-color-canvas'],
  ['Surface', 'bg-surface', '--reach-color-surface'],
  ['Raised', 'bg-surface-raised', '--reach-color-surface-raised'],
  ['Fill', 'bg-surface-sunken', '--reach-color-surface-sunken'],
  ['Fill strong', 'bg-surface-active', '--reach-color-surface-active'],
  ['Line', 'bg-border-strong', '--reach-color-border-strong'],
  ['Ink', 'bg-fg', '--reach-color-fg'],
  ['Ink 2', 'bg-fg-muted', '--reach-color-fg-muted'],
  ['Ink 3', 'bg-fg-subtle', '--reach-color-fg-subtle'],
  ['Accent', 'bg-accent', '--reach-color-accent'],
  ['Accent soft', 'bg-accent-subtle', '--reach-color-accent-subtle'],
  ['Accent text', 'bg-accent-fg', '--reach-color-accent-fg'],
  ['Success', 'bg-success', '--reach-color-success'],
  ['Warning', 'bg-warning', '--reach-color-warning'],
  ['Danger', 'bg-danger', '--reach-color-danger'],
  ['Info', 'bg-info', '--reach-color-info'],
] as const;

export const SemanticColor: Story = {
  name: 'Semantic colour',
  parameters: {
    docs: {
      description: {
        story:
          'The names a component may use (`bg-canvas`, `text-fg-muted`), each a `--reach-color-*` token from the same `tokens.css` the web reads. Each re-points under `.dark`, so a component never learns which theme it is in.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={96} gap={3}>
      {SEMANTIC.map(([name, fill, token]) => (
        <Stack key={token} gap={2}>
          <View aria-hidden className={`h-14 rounded-sm border border-border ${fill}`} />
          <Text variant="caption" weight="semibold">
            {name}
          </Text>
          <Text variant="caption" weight="regular" tone="muted" mono numberOfLines={1}>
            {token.replace('--reach-color-', '')}
          </Text>
        </Stack>
      ))}
    </AutoGrid>
  ),
};

const NEUTRAL = [
  'bg-[var(--reach-neutral-0)]',
  'bg-[var(--reach-neutral-50)]',
  'bg-[var(--reach-neutral-100)]',
  'bg-[var(--reach-neutral-200)]',
  'bg-[var(--reach-neutral-300)]',
  'bg-[var(--reach-neutral-400)]',
  'bg-[var(--reach-neutral-500)]',
  'bg-[var(--reach-neutral-600)]',
  'bg-[var(--reach-neutral-700)]',
  'bg-[var(--reach-neutral-800)]',
  'bg-[var(--reach-neutral-900)]',
  'bg-[var(--reach-neutral-950)]',
];

const BRAND = [
  'bg-[var(--reach-brand-50)]',
  'bg-[var(--reach-brand-100)]',
  'bg-[var(--reach-brand-200)]',
  'bg-[var(--reach-brand-300)]',
  'bg-[var(--reach-brand-400)]',
  'bg-[var(--reach-brand-500)]',
  'bg-[var(--reach-brand-600)]',
  'bg-[var(--reach-brand-700)]',
  'bg-[var(--reach-brand-800)]',
  'bg-[var(--reach-brand-900)]',
  'bg-[var(--reach-brand-950)]',
];

function Ramp({ name, steps }: { name: string; steps: readonly string[] }): React.JSX.Element {
  return (
    <Inline gap={1} wrap={false}>
      <Text variant="caption" weight="semibold" tone="muted" className="w-16">
        {name}
      </Text>
      {steps.map((step) => (
        <View
          key={step}
          aria-hidden
          className={`h-7 flex-1 rounded-xs border border-border ${step}`}
        />
      ))}
    </Inline>
  );
}

export const PrimitiveScales: Story = {
  name: 'Primitive scales',
  parameters: {
    docs: {
      description: {
        story:
          'The two ramps Reach ships, in OKLCH, so a lightness step is a perceptual step. Status colours are semantic tokens with no ramp of their own.',
      },
    },
  },
  render: () => (
    <Stack gap={2}>
      <Ramp name="Neutral" steps={NEUTRAL} />
      <Ramp name="Indigo" steps={BRAND} />
      <Text variant="subhead" tone="muted" className="mt-2.5">
        Primitives feed the semantic tokens. Components never reference a primitive directly.
      </Text>
    </Stack>
  ),
};

export const Type: Story = {
  render: () => <TypeTable />,
};

const ELEVATION = [
  ['Flat', ''],
  ['1 · Cards', 'shadow-sm'],
  ['2 · Popovers', 'shadow-md'],
  ['3 · Menus', 'shadow-lg'],
  ['4 · Dialogs', 'shadow-xl'],
] as const;

export const Elevation: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Four steps of shadow, each a tight contact shadow and a soft ambient one; in dark, a hairline ring, because a shadow on black says nothing. Glass is for bars that content scrolls under.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={130} gap={4}>
      {ELEVATION.map(([name, shadow]) => (
        <View key={name} className={`h-24 justify-end rounded-[18px] bg-surface p-3.5 ${shadow}`}>
          <Text variant="footnote" weight="semibold">
            {name}
          </Text>
        </View>
      ))}
      <View className="h-24 justify-end rounded-[18px] border border-glass-line bg-glass p-3.5 shadow-md">
        <Text variant="footnote" weight="semibold">
          Glass · Bars
        </Text>
      </View>
    </AutoGrid>
  ),
};

const SHAPE = [
  ['xs', 'rounded-xs', '6px'],
  ['sm', 'rounded-sm', '10px'],
  ['md', 'rounded-md', '14px'],
  ['lg', 'rounded-lg', '20px'],
  ['xl', 'rounded-xl', '28px'],
  ['full', 'rounded-full', '999px'],
] as const;

export const Shape: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'On a phone a card takes `rounded-m-card` (22) and a sheet `rounded-m-sheet` (40); controls are fully round.',
      },
    },
  },
  render: () => (
    <Inline gap={5}>
      {SHAPE.map(([name, radius, value]) => (
        <Stack key={name} gap={2} align="center">
          <View
            aria-hidden
            className={`size-16 border-2 border-accent bg-accent-subtle ${radius}`}
          />
          <Text variant="caption" weight="semibold">
            {name}
          </Text>
          <Text variant="caption" weight="regular" tone="muted" mono>
            {value}
          </Text>
        </Stack>
      ))}
    </Inline>
  ),
};

const USES = {
  instant: 'State changes',
  fast: 'Presses, exits',
  normal: 'Popovers, fades',
  slow: 'Distance travelled',
} as const satisfies Record<keyof typeof durations, string>;

export const Motion: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The durations both libraries read from `@reach/ui/motion`. The web publishes them as `--animate-duration-*`; the phone hands the same numbers to Reanimated.',
      },
    },
  },
  render: () => (
    <Stack gap={3} className="gap-3.5">
      {(Object.keys(USES) as (keyof typeof USES)[]).map((name) => (
        <Stack key={name} gap={2}>
          <Text variant="caption" mono>
            {`--animate-duration-${name}`}
          </Text>
          <View
            aria-hidden
            className="h-2 rounded-full bg-accent"
            style={{
              width: `${String((durations[name] / durations.slow) * 100)}%` as `${number}%`,
            }}
          />
          <Text variant="footnote" tone="muted">
            {`${String(durations[name])}ms · ${USES[name]}`}
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};
