import { Text, type Platform } from '@reach/ui-native';
import type { ReactNode } from 'react';
import { View } from 'react-native-css/components';

/**
 * The platforms every story is shown on, in sidebar order. The indexer in
 * `main.ts` lists each story once under each; the decorator reads the section
 * back from the story's title.
 */
export const PLATFORMS = [
  { section: 'iOS', platform: 'ios' },
  { section: 'Android', platform: 'android' },
] as const satisfies readonly { section: string; platform: Platform }[];

/**
 * The phone each platform's stories are drawn on, at its own size in points:
 * an iPhone 18 Pro Max for iOS and a Pixel 11 Pro for Android. A story lays
 * out at the screen's width, as it would on that phone.
 */
export const DEVICES = {
  ios: { name: 'iPhone 18 Pro Max', width: 440, height: 956 },
  android: { name: 'Pixel 11 Pro', width: 412, height: 915 },
} as const satisfies Record<Platform, { name: string; width: number; height: number }>;

/**
 * Set by a Vitest project (`vitest.config.ts`), which runs each story file
 * once per platform: those stories keep their own titles, with no section.
 */
declare const __REACH_PLATFORM__: Platform | undefined;

/** The platform a story is drawn for: its sidebar section, or the test run's. */
export function platformOf(title: string): Platform {
  const section = title.split('/')[0];
  const listed = PLATFORMS.find((p) => p.section === section);
  if (listed) return listed.platform;
  return typeof __REACH_PLATFORM__ === 'undefined' ? 'ios' : __REACH_PLATFORM__;
}

/**
 * The phone around a story: the body, bezel and buttons, drawn by
 * `preview.css`, and the screen inside, which holds the real components.
 * `screen` is what renders on that screen (the provider and the story); the
 * story scrolls inside the screen, as an app does, and an overlay covers the
 * screen rather than the page.
 *
 * Below the phone's own width (a phone browsing the Storybook, the test
 * runner, `reach-mobile:compare`), the CSS takes the device away and the
 * story fills the window, so nothing is drawn twice and nothing overflows.
 */
export function Device({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}): React.JSX.Element {
  const device = DEVICES[platform];
  return (
    <div className="reach-stage">
      <div
        className={`reach-device reach-device--${platform}`}
        style={
          {
            '--reach-screen-w': `${String(device.width)}px`,
            '--reach-screen-h': `${String(device.height)}px`,
          } as React.CSSProperties
        }
      >
        <span aria-hidden className="reach-device__buttons" />
        <div className="reach-device__screen">{children}</div>
      </div>
    </div>
  );
}

/**
 * What the operating system draws on the screen: the status bar above, and
 * the home indicator (iOS) or gesture handle (Android) over the bottom edge.
 * Drawn, not functional, and hidden from assistive technology. The story
 * itself is `reach-story`, which is what `reach-mobile:compare` shoots.
 */
export function SystemChrome({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}): React.JSX.Element {
  const ios = platform === 'ios';
  return (
    <View className="flex-1 bg-canvas">
      <View
        aria-hidden
        className={`reach-device__chrome flex-row items-center justify-between ${
          ios ? 'h-[59px] px-9 pt-3.5' : 'h-[40px] px-6'
        }`}
      >
        <Text variant={ios ? 'headline' : 'subhead'} tabular>
          9:41
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Signal />
          <Battery ios={ios} />
        </View>
      </View>
      <div className="reach-device__content">{children}</div>
      <View
        aria-hidden
        className={`reach-device__chrome reach-device__home pointer-events-none items-center justify-end ${
          ios ? 'h-[34px] pb-2' : 'h-[24px] pb-2'
        }`}
      >
        <View
          className={
            ios ? 'h-[5px] w-[140px] rounded-full bg-fg' : 'h-1 w-[108px] rounded-full bg-fg-muted'
          }
        />
      </View>
    </View>
  );
}

function Signal(): React.JSX.Element {
  return (
    <View className="h-3 flex-row items-end gap-[2px]">
      {[4, 6, 8, 11].map((height) => (
        <View key={height} className="w-[3px] rounded-[1px] bg-fg" style={{ height }} />
      ))}
    </View>
  );
}

function Battery({ ios }: { ios: boolean }): React.JSX.Element {
  return ios ? (
    <View className="h-3 w-6 justify-center rounded-[4px] border border-fg-muted p-[1.5px]">
      <View className="h-full w-[80%] rounded-[2px] bg-fg" />
    </View>
  ) : (
    <View className="h-3 w-[7px] rounded-[1.5px] bg-fg" />
  );
}
