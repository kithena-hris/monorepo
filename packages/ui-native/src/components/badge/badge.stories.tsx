import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Bell, ChevronRight, EyeOff, Inbox, Lock, MessageCircle } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { PEOPLE, STATUS_TONE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Separator } from '../separator/separator.tsx';
import { Text } from '../text/text.tsx';
import { Badge } from './badge.tsx';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  parameters: designDocs('badge'),
  args: { children: 'Active', tone: 'success' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  render: () => (
    <Inline gap={2}>
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="accent">Accent</Badge>
      <Badge tone="success">Success</Badge>
      <Badge tone="warning">Warning</Badge>
      <Badge tone="danger">Danger</Badge>
      <Badge tone="info">Info</Badge>
    </Inline>
  ),
};

export const Sensitive: Story = {
  parameters: designNote('badge', 'Sensitive'),
  render: () => (
    <Inline gap={2}>
      <Badge icon={Lock}>Salary</Badge>
      <Badge icon={Lock} tone="danger">
        Medical
      </Badge>
      <Badge icon={EyeOff} variant="outline">
        HR only
      </Badge>
    </Inline>
  ),
};

/** A count pinned to the corner of a control, ringed in the page colour so it lifts off the button. */
function Counted({
  icon,
  label,
  count,
  offset = '-top-0.5 -right-0.5',
}: {
  icon: typeof Bell;
  label: string;
  count?: string;
  offset?: string;
}): React.JSX.Element {
  return (
    <View>
      <Button startIcon={<Icon icon={icon} />} accessibilityLabel={label} />
      <View pointerEvents="none" className={`absolute ${offset}`}>
        {count ? (
          <Badge size="xs" tone="danger" variant="solid" className="border-2 border-canvas">
            {count}
          </Badge>
        ) : (
          <View className="size-3.5 rounded-full border-2 border-canvas bg-danger" />
        )}
      </View>
    </View>
  );
}

export const Attention: Story = {
  render: () => (
    <Inline gap={2} className="gap-2.5">
      <Badge tone="danger" variant="solid">
        Action needed
      </Badge>
      <Badge tone="warning" variant="solid">
        3 overdue
      </Badge>
      <Badge tone="accent" variant="solid">
        New
      </Badge>
      <Counted icon={Bell} label="Notifications, 3 unread" count="3" />
    </Inline>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Inline gap={2}>
      <Badge size="sm" tone="accent">
        Small
      </Badge>
      <Badge tone="accent">Medium</Badge>
      <Badge size="lg" tone="accent">
        Large
      </Badge>
    </Inline>
  ),
};

const STATUSES = ['Active', 'On leave', 'Onboarding', 'Offboarding', 'Invited'] as const;

export const WithADot: Story = {
  name: 'With a dot',
  render: () => (
    <Inline gap={2}>
      {STATUSES.map((status) => (
        <Badge key={status} size="sm" dot tone={STATUS_TONE[status]}>
          {status}
        </Badge>
      ))}
    </Inline>
  ),
};

export const InATableRow: Story = {
  name: 'In a table row',
  parameters: {
    docs: {
      description: {
        story:
          'On a phone a table row is a card: the person first, the status and the type underneath.',
      },
    },
  },
  render: () => (
    <Card padded={false}>
      {PEOPLE.slice(0, 3).map((p, i) => (
        <View key={p.name}>
          {i > 0 ? <Separator /> : null}
          <Stack gap={2} className="px-4 py-3">
            <Inline gap={3} wrap={false}>
              <Avatar name={p.name} size="lg" decorative />
              <View className="flex-1">
                <Text variant="callout" weight="semibold" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text variant="subhead" tone="muted" numberOfLines={1}>
                  {p.role}
                </Text>
              </View>
              <Icon icon={ChevronRight} size={16} tone="subtle" />
            </Inline>
            <Inline gap={2}>
              <Badge size="sm" dot tone={STATUS_TONE[p.status]}>
                {p.status}
              </Badge>
              <Badge size="sm">{p.team === 'Sales' ? 'Contractor' : 'Permanent'}</Badge>
            </Inline>
          </Stack>
        </View>
      ))}
    </Card>
  ),
};

export const Removable: Story = {
  name: 'Removable, as a chip',
  parameters: {
    docs: {
      description: {
        story:
          'With `onRemove` a badge is a filter someone can take away. Its remove button is labelled and has a 44-point target. A chip with an avatar is the Chip component’s.',
      },
    },
  },
  render: () => (
    <Inline gap={2}>
      <Badge size="lg" tone="accent" onRemove={() => undefined}>
        Engineering
      </Badge>
      <Badge size="lg" onRemove={() => undefined}>
        Berlin
      </Badge>
      <Badge size="lg" onRemove={() => undefined}>
        Priya Shah
      </Badge>
    </Inline>
  ),
};

export const OnIconsAndAvatars: Story = {
  name: 'On icons and avatars',
  parameters: {
    docs: {
      description: {
        story:
          'A count on a control, a dot when the number does not matter, and a status on a person. The control’s label says the count; the dot is never the only way to know.',
      },
    },
  },
  render: () => (
    <Inline gap={4}>
      <Counted icon={Bell} label="Notifications, 3 unread" count="3" />
      <Counted icon={MessageCircle} label="Messages, new" offset="top-1 right-1" />
      <Counted
        icon={Inbox}
        label="Inbox, more than 99 unread"
        count="99+"
        offset="-top-1 -right-2"
      />
      <Avatar name="Priya Shah" status="success" statusLabel="Online" />
      <Avatar name="Jonas Weber" status="warning" statusLabel="Away" />
      <Avatar name="Amara Okafor" status="neutral" statusLabel="Offline" />
    </Inline>
  ),
};
