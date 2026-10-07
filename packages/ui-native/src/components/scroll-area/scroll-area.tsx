import { useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { cn } from '../../lib/cn.ts';

type Extent = { visible: number; content: number };

/** Eight steps of a fade: a gradient without a gradient library. */
const FADE_STEPS = [0.06, 0.14, 0.24, 0.36, 0.5, 0.64, 0.8, 0.94];
const fadeTone = {
  surface: 'bg-surface',
  canvas: 'bg-canvas',
  'surface-sunken': 'bg-surface-sunken',
} as const;

export type ScrollAreaProps = {
  children?: ReactNode;
  orientation?: 'vertical' | 'horizontal';
  /**
   * The web's names. `always`: a bar that stays, for when people need to know
   * there is more, as in a picker. Anything else is the platform's own
   * indicator, shown while scrolling: a phone has no hover, and its native
   * bar is what `scroll` asks for on the web.
   */
  type?: 'auto' | 'always' | 'scroll' | 'hover';
  /** Fades the far edge into this colour, so a cut-off row reads as "more". */
  fade?: keyof typeof fadeTone;
  /** Names the region for a screen reader, which can also move into it by keyboard on the web. */
  accessibilityLabel?: string;
  /** The region: give it a height (or a width, horizontally). */
  className?: string | undefined;
  /** The scrolling content's own padding and gap. */
  contentClassName?: string;
};

/**
 * A fixed-height region that scrolls. For fixed panels only: a screen's own
 * scroll is the screen's. Over about 200 rows, use VirtualList.
 */
export function ScrollArea({
  children,
  orientation = 'vertical',
  type = 'hover',
  fade,
  accessibilityLabel,
  className,
  contentClassName,
}: ScrollAreaProps): React.JSX.Element {
  const horizontal = orientation === 'horizontal';
  const [extent, setExtent] = useState<Extent>({ visible: 0, content: 0 });
  const always = type === 'always';
  const track = Math.max(0, extent.visible - 16);
  const thumb =
    extent.content > extent.visible ? Math.max(24, (extent.visible / extent.content) * track) : 0;
  const travel = extent.content - extent.visible;
  // The offset lives on the UI thread: the bar follows the finger without a render per frame.
  const offset = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    offset.value = horizontal ? e.contentOffset.x : e.contentOffset.y;
  });
  const thumbStyle = useAnimatedStyle(() => {
    const at = travel > 0 ? (Math.min(Math.max(offset.value, 0), travel) / travel) * (track - thumb) : 0;
    return horizontal
      ? { left: at, width: thumb, top: 0, bottom: 0 }
      : { top: at, height: thumb, left: 0, right: 0 };
  });

  return (
    <View className={cn('relative overflow-hidden', className)}>
      <Animated.ScrollView
        horizontal={horizontal}
        focusable
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        showsVerticalScrollIndicator={!always && !horizontal}
        showsHorizontalScrollIndicator={!always && horizontal}
        scrollEventThrottle={16}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setExtent((x) => ({ ...x, visible: horizontal ? width : height }));
        }}
        onContentSizeChange={(width: number, height: number) => {
          setExtent((x) => ({ ...x, content: horizontal ? width : height }));
        }}
        {...(always ? { onScroll } : {})}
        style={{ flex: 1 }}
      >
        {/* The scroll view bare (RMB-001: motion on a bare view), the classes on its content. */}
        <View className={cn(horizontal && 'flex-row', contentClassName)}>{children}</View>
      </Animated.ScrollView>

      {fade ? (
        <View
          pointerEvents="none"
          aria-hidden
          className={cn(
            'absolute',
            horizontal ? 'top-0 right-0 bottom-0 w-9 flex-row' : 'right-0 bottom-0 left-0 h-9',
          )}
        >
          {FADE_STEPS.map((opacity) => (
            <View key={opacity} className={cn('flex-1', fadeTone[fade])} style={{ opacity }} />
          ))}
        </View>
      ) : null}

      {always && thumb > 0 ? (
        <View
          pointerEvents="none"
          aria-hidden
          className={cn(
            'absolute rounded-full bg-surface-sunken',
            horizontal ? 'right-2 bottom-[3px] left-2 h-1.5' : 'top-2 right-[3px] bottom-2 w-1.5',
          )}
        >
          <Animated.View style={[{ position: 'absolute' }, thumbStyle]}>
            <View className="size-full rounded-full bg-fg-subtle opacity-80" />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
