import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { ArrowRight, ArrowUpRight, Download, Ellipsis, Plus, Search, X } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Card, CardDescription, CardTitle } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Button } from './button.tsx';

const meta = {
  title: 'Components/Button',
  component: Button,
  parameters: designDocs('button'),
  args: { children: 'Request time off', variant: 'primary' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'primary',
        'tinted',
        'secondary',
        'outline',
        'ghost',
        'danger',
        'danger-soft',
        'invert',
        'link',
      ],
    },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <Inline gap={2}>
      <Button variant="primary">Primary</Button>
      <Button variant="tinted">Tinted</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="danger-soft">Danger soft</Button>
      <Button variant="invert">Invert</Button>
      <Button variant="link">Link</Button>
    </Inline>
  ),
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Two sizes under a finger: 52 by default, 36 compact. Both keep a 44-point target.',
      },
    },
  },
  render: () => (
    <Inline gap={2}>
      <Button variant="primary" size="sm">
        Compact
      </Button>
      <Button variant="primary">Default</Button>
    </Inline>
  ),
};

export const WithIcons: Story = {
  name: 'With icons',
  parameters: {
    docs: {
      description: {
        story:
          'An icon-only button needs an `accessibilityLabel`. Keyboard shortcuts are not shown on a phone.',
      },
    },
  },
  render: () => (
    <Inline gap={2}>
      <Button variant="primary" startIcon={<Icon icon={Plus} />}>
        New request
      </Button>
      <Button startIcon={<Icon icon={Download} />}>Export</Button>
      <Button endIcon={<Icon icon={ArrowRight} />}>Next</Button>
      <Button startIcon={<Icon icon={Ellipsis} />} accessibilityLabel="More actions" />
      <Button startIcon={<Icon icon={Search} />}>Search</Button>
    </Inline>
  ),
};

export const Loading: Story = {
  parameters: designNote('button', 'Loading'),
  render: () => (
    <Inline gap={2}>
      <Button variant="primary" loading>
        Saving
      </Button>
      <Button loading>Exporting</Button>
    </Inline>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Stack gap={3}>
      <Inline gap={2}>
        <Button variant="primary" disabled>
          Submit
        </Button>
        <Button disabled>Export</Button>
      </Inline>
      <Text variant="subhead" tone="muted">
        Say why nearby: “Add a start date to submit.”
      </Text>
    </Stack>
  ),
};

export const FullWidth: Story = {
  name: 'Full width',
  render: () => (
    <Stack gap={2}>
      <Button variant="primary" fullWidth>
        Continue
      </Button>
      <Button fullWidth>Cancel</Button>
    </Stack>
  ),
};

export const AsALink: Story = {
  name: 'As a link',
  parameters: {
    docs: {
      description: {
        story: 'With `href` a button opens the address and a screen reader hears a link.',
      },
    },
  },
  render: () => (
    <Inline gap={3}>
      <Button variant="link" href="https://example.com/policy">
        View policy
      </Button>
      <Button href="https://example.com/drive" endIcon={<Icon icon={ArrowUpRight} size={16} />}>
        Open in Drive
      </Button>
    </Inline>
  ),
};

export const InContext: Story = {
  name: 'In context',
  render: () => (
    <Card>
      <Stack gap={3}>
        <CardTitle>Approve 5 days off?</CardTitle>
        <CardDescription>Amara Okafor · 14–18 Oct</CardDescription>
        <Inline gap={2} wrap={false}>
          <Button className="flex-1" fullWidth>
            Decline
          </Button>
          <Button variant="primary" className="flex-1" fullWidth>
            Approve
          </Button>
        </Inline>
      </Stack>
    </Card>
  ),
};

export const UnderAFinger: Story = {
  name: 'Under a finger',
  parameters: {
    docs: {
      description: {
        story:
          'Every button is at least 44 points to a finger. A smaller icon-only button grows its touch area, not its drawing; the dashed ring is that area.',
      },
    },
  },
  render: () => (
    <Stack gap={3}>
      <Inline gap={3}>
        <Button size="sm" startIcon={<Icon icon={X} />} accessibilityLabel="Close" />
        <View className="size-m-tap items-center justify-center rounded-full border-[1.5px] border-dashed border-accent">
          <Button size="xs" startIcon={<Icon icon={X} />} accessibilityLabel="Dismiss" />
        </View>
        <Text variant="subhead" tone="muted">
          44 × 44 minimum target, even when the button looks smaller
        </Text>
      </Inline>
      <Button variant="primary" fullWidth>
        Pinned at the bottom, full width
      </Button>
    </Stack>
  ),
};
