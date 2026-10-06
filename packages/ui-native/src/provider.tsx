import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { View } from 'react-native-css/components';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion as useSystemReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { cn } from './lib/cn.ts';
import { OverlayHost } from './lib/overlay-host.tsx';

export type Theme = 'light' | 'dark';

const ReducedMotion = createContext<boolean | null>(null);
const ThemeContext = createContext<Theme>('light');

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

export type ReachProviderProps = {
  /** Defaults to the system's colour scheme. */
  theme?: Theme;
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
 */
export function ReachProvider({
  theme,
  reducedMotion,
  children,
}: ReachProviderProps): React.JSX.Element {
  const system = useColorScheme();
  const resolved: Theme = theme ?? (system === 'dark' ? 'dark' : 'light');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeContext.Provider value={resolved}>
          <ReducedMotion.Provider value={reducedMotion ?? null}>
            <View className={cn('flex-1', resolved === 'dark' && 'dark')}>
              {children}
              <OverlayHost />
            </View>
          </ReducedMotion.Provider>
        </ThemeContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
