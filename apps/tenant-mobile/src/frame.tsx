import { AppBar, Button, EmptyState, LargeTitle, Spinner, type AppBarBack } from '@reach/ui-native';
import { CircleAlert } from 'lucide-react-native';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The tab bar's height and its gap above the home indicator: what content keeps clear of. */
export const TAB_ROOM = 64 + 12;

/**
 * Hides the tab bar while a screen is up that has a pinned action row of its
 * own (an editor, a decision): the design's `tab: false`. Counted, so two
 * such screens stacked keep it hidden until both are gone.
 */
export const TabBarHiding = createContext<(hidden: boolean) => void>(() => undefined);

function useHiddenTabBar(hidden: boolean): void {
  const hide = useContext(TabBarHiding);
  useEffect(() => {
    if (!hidden) return undefined;
    hide(true);
    return () => {
      hide(false);
    };
  }, [hidden, hide]);
}

/**
 * A signed-in screen: the bar, then content that scrolls under it and stops
 * short of the floating tab bar. `large` is the iOS large title, under the bar
 * and scrolling away with the content; a pushed screen names itself in the bar.
 */
export function Page({
  title,
  large,
  back,
  trailing,
  children,
  scroll = true,
  foot,
}: {
  title?: string;
  large?: string;
  back?: AppBarBack;
  trailing?: ReactNode;
  children: ReactNode;
  /** Off for a screen whose content scrolls itself: a virtual list. */
  scroll?: boolean;
  /**
   * A row pinned to the bottom, riding above the keyboard: Cancel and Save,
   * Reject and Approve. The tab bar goes while it is up.
   */
  foot?: ReactNode;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  useHiddenTabBar(foot !== undefined);
  const room = foot === undefined ? TAB_ROOM : 76;
  const bar = (
    <AppBar
      {...(title === undefined ? {} : { title })}
      {...(back === undefined ? {} : { back })}
      {...(trailing === undefined ? {} : { trailing })}
    />
  );
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas"
      style={{ paddingTop: insets.top }}
    >
      {bar}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-4 px-4 pt-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + room + 24 }}
        >
          {large === undefined ? null : <LargeTitle className="px-0 pb-1">{large}</LargeTitle>}
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1 gap-4 px-4 pt-1" style={{ paddingBottom: insets.bottom + room }}>
          {large === undefined ? null : <LargeTitle className="px-0 pb-1">{large}</LargeTitle>}
          {children}
        </View>
      )}
      {foot === undefined ? null : (
        <View
          className="flex-row gap-2.5 border-t border-glass-line bg-glass px-4 pt-3 backdrop-blur-xl"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {foot}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** Waiting for People. */
export function Loading({ label }: { label: string }): React.JSX.Element {
  return (
    <View className="items-center py-16">
      <Spinner label={label} />
    </View>
  );
}

/** People did not answer: what it said, and the way to ask again. */
export function Failed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={CircleAlert}
      tone="danger"
      title="That could not be loaded"
      description={message}
      action={<Button onPress={onRetry}>Try again</Button>}
    />
  );
}
