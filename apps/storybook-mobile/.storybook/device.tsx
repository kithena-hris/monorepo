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
 * The phone's own chrome around a story: the status bar above, and the home
 * indicator (iOS) or gesture handle (Android) below. Drawn, not functional,
 * and hidden from assistive technology; the story itself is what
 * `reach-mobile:compare` shoots (`reach-story`), so the chrome never reaches
 * the side-by-side.
 */
export function DeviceChrome({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}): React.JSX.Element {
  const ios = platform === 'ios';
  return (
    <View className="flex-1">
      <View
        aria-hidden
        className={
          ios
            ? 'h-[54px] flex-row items-center justify-between px-8 pt-3'
            : 'h-[36px] flex-row items-center justify-between px-5'
        }
      >
        <Text variant={ios ? 'headline' : 'subhead'} tabular>
          9:41
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Signal />
          <Battery ios={ios} />
        </View>
      </View>
      <View className="flex-1">{children}</View>
      <View
        aria-hidden
        className={
          ios ? 'h-[34px] items-center justify-center' : 'h-[24px] items-center justify-center'
        }
      >
        <View
          className={
            ios ? 'h-[5px] w-[134px] rounded-full bg-fg' : 'h-1 w-[108px] rounded-full bg-fg-muted'
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
