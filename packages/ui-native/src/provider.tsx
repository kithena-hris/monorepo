import { createContext, useContext, type ReactNode } from 'react';
import { Platform as RNPlatform, useColorScheme } from 'react-native';
import { View } from 'react-native-css/components';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion as useSystemReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { cn } from './lib/cn.ts';
import { OverlayHost } from './lib/overlay-host.tsx';

export type Theme = 'light' | 'dark';

/** The phone a screen is drawn for. */
export type Platform = 'ios' | 'android';

const ReducedMotion = createContext<boolean | null>(null);
const ThemeContext = createContext<Theme>('light');
const PlatformContext = createContext<Platform | null>(null);

/**
 * Whether motion should be reduced: what the app said on `ReachProvider`, or
 * else the system setting. A component never reads the system setting itself,
 * so a story, a test or an app setting can turn motion down for a subtree.
 */
export function useReducedMotion(): boolean {
  const declared = useContext(ReducedMotion);
  const system = useSystemReducedMotion();
  return declared ?? system;
}

/** The theme the nearest `ReachProvider` paints in. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * The platform the nearest `ReachProvider` draws for: what it was told, or on a
 * device the one the app was built for. A component that genuinely differs
 * between the two (a back arrow, a press ripple, a switch's shape) reads this,
 * never `Platform.OS`, so the Storybook can show both on one page. Off a
 * device and undeclared it is iOS.
 */
export function usePlatform(): Platform {
  return useContext(PlatformContext) ?? (RNPlatform.OS === 'android' ? 'android' : 'ios');
}

export type ReachProviderProps = {
  /** Defaults to the system's colour scheme. */
  theme?: Theme;
  /**
   * Draw for this platform instead of the device's own. Leave unset in an app;
   * the Storybook declares it to show each story as iOS and as Android.
   */
  platform?: Platform;
  /** Overrides the system's reduce-motion setting. Leave unset in an app. */
  reducedMotion?: boolean;
  children: ReactNode;
};

/**
 * Everything a Reach screen needs above it, once, at the root.
 *
 * - **Theme**: the `dark` class on a view, the same mechanism the web uses on
 *   `<html>`. `tokens.css` re-points every `--reach-color-*` under `.dark`.
 * - **Safe area**, for bars that sit under the notch and the home indicator.
 * - **The gesture root** Gesture Handler requires above any gesture.
 * - **The portal host** overlays render into, inside the themed view so a
 *   menu opened in dark mode is dark too.
 * - **Reduced motion**, readable with `useReducedMotion()`.
 * - **The platform**, readable with `usePlatform()`.
 */
export function ReachProvider({
  theme,
  platform,
  reducedMotion,
  children,
}: ReachProviderProps): React.JSX.Element {
  const system = useColorScheme();
  const resolved: Theme = theme ?? (system === 'dark' ? 'dark' : 'light');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeContext.Provider value={resolved}>
          <PlatformContext.Provider value={platform ?? null}>
            <ReducedMotion.Provider value={reducedMotion ?? null}>
              <View className={cn('flex-1', resolved === 'dark' && 'dark')}>
                {children}
                <OverlayHost />
              </View>
            </ReducedMotion.Provider>
          </PlatformContext.Provider>
        </ThemeContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
