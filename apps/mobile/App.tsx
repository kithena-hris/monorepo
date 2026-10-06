import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  ChipGroup,
  ChipGroupItem,
  CopyField,
  FloatingButton,
  Icon,
  Inline,
  ReachLogo,
  ReachProvider,
  SegmentedControl,
  SegmentedControlItem,
  Separator,
  Spinner,
  Stack,
  Text,
} from '@reach/ui-native';
import { StatusBar } from 'expo-status-bar';
import { Download, Lock, Moon, Plus, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { Appearance, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import './global.css';

const PEOPLE = ['Priya Shah', 'Jonas Weber', 'Amara Okafor', 'Lucas Moreau', 'Mei Tanaka'];

/**
 * A small gallery of the primitives, rendered by Metro on a device, so every
 * component is proven natively and not only on react-native-web.
 */
export default function App(): React.JSX.Element {
  // Starts in the system's scheme; the button flips it.
  const [dark, setDark] = useState(Appearance.getColorScheme() === 'dark');
  return (
    <ReachProvider theme={dark ? 'dark' : 'light'}>
      <Gallery
        dark={dark}
        onToggle={() => {
          setDark(!dark);
        }}
      />
      <StatusBar style={dark ? 'light' : 'dark'} />
    </ReachProvider>
  );
}

function Gallery({ dark, onToggle }: { dark: boolean; onToggle: () => void }): React.JSX.Element {
  // Inside ReachProvider, which owns the safe-area context.
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-canvas"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 px-4 py-6">
        <Inline justify="between" wrap={false}>
          <ReachLogo />
          <Button
            startIcon={<Icon icon={dark ? Sun : Moon} />}
            accessibilityLabel={dark ? 'Light mode' : 'Dark mode'}
            onPress={onToggle}
          />
        </Inline>

        <Stack gap={1}>
          <Text variant="large">Time off</Text>
          <Text variant="title3">Title 3, 20 over 25</Text>
          <Text>Body text at 17 over 22.</Text>
          <Text variant="subhead" tone="muted">
            Subhead, muted
          </Text>
        </Stack>

        <Inline gap={2}>
          <Button variant="primary" startIcon={<Icon icon={Plus} />}>
            New request
          </Button>
          <Button startIcon={<Icon icon={Download} />}>Export</Button>
          <Button variant="tinted" size="sm">
            Compact
          </Button>
          <Button variant="danger" loading>
            Deleting
          </Button>
          <Button variant="outline">Outline</Button>
        </Inline>

        <Inline gap={4}>
          <Spinner size="lg" />
          <Avatar name="Priya Shah" status="success" statusLabel="Online" />
          <AvatarGroup max={3}>
            {PEOPLE.map((name) => (
              <Avatar key={name} name={name} />
            ))}
          </AvatarGroup>
        </Inline>

        <Inline gap={2}>
          <Badge tone="success" dot>
            Active
          </Badge>
          <Badge tone="warning" variant="solid">
            3 overdue
          </Badge>
          <Badge icon={Lock}>Salary</Badge>
          <Badge size="lg" tone="accent" onRemove={() => undefined}>
            Engineering
          </Badge>
        </Inline>

        <ChipGroup type="multiple" defaultValue={['Engineering']} accessibilityLabel="Teams">
          {['All', 'Engineering', 'Design', 'Sales'].map((team) => (
            <ChipGroupItem key={team} value={team}>
              {team}
            </ChipGroupItem>
          ))}
        </ChipGroup>

        <SegmentedControl defaultValue="week" fullWidth accessibilityLabel="Period">
          <SegmentedControlItem value="day">Day</SegmentedControlItem>
          <SegmentedControlItem value="week">Week</SegmentedControlItem>
          <SegmentedControlItem value="month">Month</SegmentedControlItem>
        </SegmentedControl>

        <CopyField label="Employee ID" value="RCH-00412" mono />

        <Inline gap={3}>
          <FloatingButton label="New request" />
          <FloatingButton variant="surface" accessibilityLabel="New request" />
        </Inline>

        <Card>
          <CardTitle>Approve 5 days off?</CardTitle>
          <CardDescription>Amara Okafor · 14–18 Oct</CardDescription>
          <View className="h-3" />
          <Separator />
          <Inline gap={2} wrap={false} className="mt-3">
            <Button className="flex-1" fullWidth>
              Decline
            </Button>
            <Button variant="primary" className="flex-1" fullWidth>
              Approve
            </Button>
          </Inline>
        </Card>
      </ScrollView>
    </View>
  );
}
