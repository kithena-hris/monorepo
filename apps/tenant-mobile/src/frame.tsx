import { AppBar, Button, EmptyState, LargeTitle, Spinner, type AppBarBack } from '@reach/ui-native';
import { CircleAlert } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The tab bar's height and its gap above the home indicator: what content keeps clear of. */
export const TAB_ROOM = 64 + 12;

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
}: {
  title?: string;
  large?: string;
  back?: AppBarBack;
  trailing?: ReactNode;
  children: ReactNode;
  /** Off for a screen whose content scrolls itself: a virtual list. */
  scroll?: boolean;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const bar = (
    <AppBar
      {...(title === undefined ? {} : { title })}
      {...(back === undefined ? {} : { back })}
      {...(trailing === undefined ? {} : { trailing })}
    />
  );
  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {bar}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-4 px-4 pt-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_ROOM + 24 }}
        >
          {large === undefined ? null : <LargeTitle className="px-0 pb-1">{large}</LargeTitle>}
          {children}
        </ScrollView>
      ) : (
        <View
          className="flex-1 gap-4 px-4 pt-1"
          style={{ paddingBottom: insets.bottom + TAB_ROOM }}
        >
          {large === undefined ? null : <LargeTitle className="px-0 pb-1">{large}</LargeTitle>}
          {children}
        </View>
      )}
    </View>
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
