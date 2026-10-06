import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Copy, MessageCircle, Users } from 'lucide-react-native';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { StandInKeyValues, settled } from '../../docs/stage.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import { HoverCard, HoverCardAction, HoverCardContent, HoverCardTrigger } from './hover-card.tsx';

const meta = {
  title: 'Components/Hover card',
  component: HoverCardContent,
  parameters: designDocs('hover-card'),
  // axe runs once the card has faded in.
  play: settled,
} satisfies Meta<typeof HoverCardContent>;

export default meta;
type Story = StoryObj<typeof meta>;

type Person = (typeof PEOPLE)[number];

/**
 * The person's name as a link: a press opens the profile, a long press peeks.
 * The trigger's ref and handlers reach the pressable.
 */
function NameLink({
  name,
  ...trigger
}: {
  name: string;
} & ComponentProps<typeof Pressable>): React.JSX.Element {
  return (
    <Pressable {...trigger} accessibilityRole="link" accessibilityHint="Long press for a preview">
      <Text weight="semibold" tone="accent">
        {name}
      </Text>
    </Pressable>
  );
}

function Preview({
  person,
  status = 'success',
  statusLabel = 'Online',
  facts,
}: {
  person: Person;
  status?: 'success' | 'info';
  statusLabel?: string;
  facts: readonly (readonly [string, string])[];
}): React.JSX.Element {
  return (
    <>
      <View className="flex-row items-center gap-3">
        <Avatar name={person.name} size={48} status={status} statusLabel={statusLabel} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text weight="bold" className="text-[16px]">
            {person.name}
          </Text>
          <Text variant="subhead" tone="muted">
            {`${person.role} · ${person.team}`}
          </Text>
        </View>
      </View>
      <StandInKeyValues pairs={facts} />
      <View className="flex-row gap-2">
        <Button size="sm" startIcon={<Icon icon={MessageCircle} />} className="flex-1">
          Message
        </Button>
        <Button size="sm" variant="primary" className="flex-1">
          Profile
        </Button>
      </View>
    </>
  );
}

const jonas = PEOPLE[1] as Person;
const amara = PEOPLE[2] as Person;
const priya = PEOPLE[0] as Person;

export const Playground: Story = {
  render: () => (
    <View className="min-h-[330px] items-start">
      <View className="flex-row items-baseline">
        <Text>Approved by </Text>
        <HoverCard defaultOpen>
          <HoverCardTrigger>
            <NameLink name={jonas.name} />
          </HoverCardTrigger>
          <HoverCardContent label={jonas.name}>
            <Preview
              person={jonas}
              facts={[
                ['Local time', `14:32 in ${jonas.location}`],
                ['Manager', 'Nora Becker'],
              ]}
            />
          </HoverCardContent>
        </HoverCard>
      </View>
    </View>
  ),
};

export const SomeoneAway: Story = {
  name: 'Someone away',
  render: () => (
    <View className="min-h-[330px] items-start">
      <HoverCard defaultOpen>
        <HoverCardTrigger>
          <NameLink name={amara.name} />
        </HoverCardTrigger>
        <HoverCardContent label={amara.name}>
          <Preview
            person={amara}
            status="info"
            statusLabel="Away"
            facts={[
              ['Away', 'Back Mon 21 Oct'],
              ['Manager', 'Nora Becker'],
            ]}
          />
        </HoverCardContent>
      </HoverCard>
    </View>
  ),
};

export const LongPressPreview: Story = {
  name: 'Long-press preview',
  render: () => (
    <View className="min-h-[520px] items-start">
      <HoverCard defaultOpen>
        <HoverCardTrigger>
          <NameLink name={priya.name} />
        </HoverCardTrigger>
        <HoverCardContent
          label={priya.name}
          actions={
            <>
              <HoverCardAction icon={MessageCircle}>Message</HoverCardAction>
              <HoverCardAction icon={Copy}>Copy email</HoverCardAction>
              <HoverCardAction icon={Users}>View team</HoverCardAction>
            </>
          }
        >
          <Preview
            person={priya}
            facts={[
              ['Local time', `14:32 in ${priya.location}`],
              ['Manager', 'Nora Becker'],
            ]}
          />
        </HoverCardContent>
      </HoverCard>
    </View>
  ),
};
