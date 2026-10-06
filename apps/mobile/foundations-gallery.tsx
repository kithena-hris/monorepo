import {
  AutoGrid,
  Avatar,
  Button,
  Card,
  Container,
  Icon,
  Inline,
  ReachLogo,
  ReachMark,
  Reveal,
  ScrollArea,
  Separator,
  Split,
  Stack,
  Stagger,
  Text,
} from '@reach/ui-native';
import { Calendar, House, Receipt, Search, Settings, Users, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

const TYPE = [
  ['display', 'Display'],
  ['large', 'Large title'],
  ['title1', 'Title 1'],
  ['title2', 'Title 2'],
  ['title3', 'Title 3'],
  ['headline', 'Headline'],
  ['body', 'Body'],
  ['callout', 'Callout'],
  ['subhead', 'Subhead'],
  ['footnote', 'Footnote'],
  ['caption', 'Caption'],
] as const;

const ICONS = [House, Users, Calendar, Wallet, Receipt, Search, Settings];

const PEOPLE = ['Priya Shah', 'Jonas Weber', 'Amara Okafor'];

/** A labelled block, for the layout primitives. */
function Block({ children }: { children: string }): React.JSX.Element {
  return (
    <View className="rounded-[12px] bg-accent-subtle p-3">
      <Text variant="footnote" tone="accent" weight="semibold">
        {children}
      </Text>
    </View>
  );
}

/** The Storybook's Foundations: type, icons, the marks, motion and the layout primitives. */
export function FoundationsGallery(): React.JSX.Element {
  const [shown, setShown] = useState(true);
  return (
    <Stack gap={6}>
      <Stack gap={1}>
        {TYPE.map(([variant, label]) => (
          <Text key={variant} variant={variant}>
            {label}
          </Text>
        ))}
        <Text tabular>Tabular 1,111.11 · 8,888.88</Text>
      </Stack>

      <Inline gap={4}>
        {ICONS.map((icon, i) => (
          <Icon key={i} icon={icon} size={24} />
        ))}
        <Icon icon={Calendar} size={24} tone="accent" label="Time off" />
      </Inline>

      <Inline gap={4}>
        <ReachMark size={40} tile />
        <ReachMark size={40} />
        <ReachLogo />
      </Inline>

      <Stack gap={2}>
        <Button
          size="sm"
          onPress={() => {
            setShown(!shown);
          }}
        >
          {shown ? 'Hide' : 'Show'}
        </Button>
        <Reveal open={shown}>
          <Block>Revealed without a layout jump</Block>
        </Reveal>
        {PEOPLE.map((name, i) => (
          <Stagger key={name} index={i}>
            <Card className="flex-row items-center gap-2.5 p-2.5">
              <Avatar name={name} size={32} decorative />
              <Text weight="semibold">{name}</Text>
            </Card>
          </Stagger>
        ))}
      </Stack>

      <Stack gap={3}>
        <Split gap={3} aside={<Block>Aside</Block>}>
          <Block>Main</Block>
        </Split>
        <AutoGrid minItemWidth={100} gap={3}>
          {['One', 'Two', 'Three', 'Four'].map((label) => (
            <Block key={label}>{label}</Block>
          ))}
        </AutoGrid>
        <Container gutter={false}>
          <Block>Container</Block>
        </Container>
        <Separator />
        <Card padded={false}>
          <ScrollArea className="h-[120px]" fade="surface" accessibilityLabel="Teams">
            {['Engineering', 'Design', 'Sales', 'Finance', 'Support', 'People'].map((team) => (
              <Text key={team} className="px-4 py-2.5">
                {team}
              </Text>
            ))}
          </ScrollArea>
        </Card>
      </Stack>
    </Stack>
  );
}
