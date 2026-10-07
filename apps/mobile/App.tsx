import {
  ChipGroup,
  ChipGroupItem,
  Inline,
  ReachLogo,
  ReachProvider,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Switch,
  Text,
  ToastProvider,
  type Platform as ReachPlatform,
} from '@reach/ui-native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Appearance, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChartsGallery } from './charts-gallery.tsx';
import { ComponentsGallery } from './components-gallery.tsx';
import { DataGallery } from './data-gallery.tsx';
import { FormsGallery } from './forms-gallery.tsx';
import { FoundationsGallery } from './foundations-gallery.tsx';
import { LayoutsGallery } from './layouts-gallery.tsx';

import './global.css';

/*
 * Every component of `@reach/ui-native`, rendered by Metro on a device, so
 * each is proven natively and not only on react-native-web. The sections are
 * the Storybook's; the controls above them flip the theme and the platform
 * the library draws for (`ReachProvider`'s `platform`), so one device shows
 * both iOS's and Android's conventions.
 */

const SECTIONS = [
  { key: 'foundations', label: 'Foundations', Gallery: FoundationsGallery },
  { key: 'forms', label: 'Forms', Gallery: FormsGallery },
  { key: 'components', label: 'Components', Gallery: ComponentsGallery },
  { key: 'data', label: 'Data', Gallery: DataGallery },
  { key: 'charts', label: 'Charts', Gallery: ChartsGallery },
  { key: 'layouts', label: 'Layouts', Gallery: LayoutsGallery },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const DEVICE: ReachPlatform = Platform.OS === 'android' ? 'android' : 'ios';

export default function App(): React.JSX.Element {
  // Starts in the system's scheme and on the device's own platform.
  const [dark, setDark] = useState(Appearance.getColorScheme() === 'dark');
  const [platform, setPlatform] = useState<ReachPlatform>(DEVICE);
  const [section, setSection] = useState<SectionKey>('components');
  return (
    <ReachProvider theme={dark ? 'dark' : 'light'} platform={platform}>
      <ToastProvider>
        <Gallery
          dark={dark}
          onDarkChange={setDark}
          platform={platform}
          onPlatformChange={setPlatform}
          section={section}
          onSectionChange={setSection}
        />
      </ToastProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </ReachProvider>
  );
}

function Gallery({
  dark,
  onDarkChange,
  platform,
  onPlatformChange,
  section,
  onSectionChange,
}: {
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  platform: ReachPlatform;
  onPlatformChange: (platform: ReachPlatform) => void;
  section: SectionKey;
  onSectionChange: (section: SectionKey) => void;
}): React.JSX.Element {
  // Inside ReachProvider, which owns the safe-area context.
  const insets = useSafeAreaInsets();
  const Current = (SECTIONS.find((s) => s.key === section) ?? SECTIONS[2]).Gallery;
  return (
    <View
      className="flex-1 bg-canvas"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 px-4 py-6" stickyHeaderIndices={[1]}>
        <Stack gap={3}>
          <Inline justify="between" wrap={false}>
            <ReachLogo />
            <Inline gap={2} wrap={false}>
              <Text variant="subhead" tone="muted">
                Dark
              </Text>
              <Switch
                checked={dark}
                onCheckedChange={onDarkChange}
                accessibilityLabel="Dark mode"
              />
            </Inline>
          </Inline>
          <SegmentedControl
            value={platform}
            onValueChange={(value) => {
              onPlatformChange(value === 'android' ? 'android' : 'ios');
            }}
            fullWidth
            accessibilityLabel="Draw for"
          >
            <SegmentedControlItem value="ios">iOS</SegmentedControlItem>
            <SegmentedControlItem value="android">Android</SegmentedControlItem>
          </SegmentedControl>
        </Stack>
        {/* Sticky: the sections stay in reach as a long one scrolls. */}
        <View className="bg-canvas py-2">
          <ChipGroup
            type="single"
            value={section}
            onValueChange={(value) => {
              const next = SECTIONS.find((s) => s.key === value);
              if (next) onSectionChange(next.key);
            }}
            accessibilityLabel="Sections"
            scroll
          >
            {SECTIONS.map((s) => (
              <ChipGroupItem key={s.key} value={s.key} variant="view">
                {s.label}
              </ChipGroupItem>
            ))}
          </ChipGroup>
        </View>
        <Current />
      </ScrollView>
    </View>
  );
}
