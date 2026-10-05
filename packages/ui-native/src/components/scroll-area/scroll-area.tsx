import { useState, type ReactNode } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ScrollView, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

type Extent = { visible: number; content: number; offset: number };

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
   * `auto`: the platform's own indicator, shown while scrolling. `always`: a
   * bar that stays, for when people need to know there is more, as in a
   * picker. `hidden`: none.
   */
  scrollbar?: 'auto' | 'always' | 'hidden';
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
  scrollbar = 'auto',
  fade,
  accessibilityLabel,
  className,
  contentClassName,
}: ScrollAreaProps): React.JSX.Element {
  const horizontal = orientation === 'horizontal';
  const [extent, setExtent] = useState<Extent>({ visible: 0, content: 0, offset: 0 });
  const always = scrollbar === 'always';
  const track = Math.max(0, extent.visible - 16);
  const thumb =
    extent.content > extent.visible ? Math.max(24, (extent.visible / extent.content) * track) : 0;
  const travel = extent.content - extent.visible;
  const at = travel > 0 ? (extent.offset / travel) * (track - thumb) : 0;

  return (
    <View className={cn('relative overflow-hidden', className)}>
      <ScrollView
        horizontal={horizontal}
        focusable
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        showsVerticalScrollIndicator={scrollbar === 'auto' && !horizontal}
        showsHorizontalScrollIndicator={scrollbar === 'auto' && horizontal}
        scrollEventThrottle={16}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setExtent((x) => ({ ...x, visible: horizontal ? width : height }));
        }}
        onContentSizeChange={(width: number, height: number) => {
          setExtent((x) => ({ ...x, content: horizontal ? width : height }));
        }}
        {...(always
          ? {
              onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const { x, y } = e.nativeEvent.contentOffset;
                setExtent((s) => ({ ...s, offset: horizontal ? x : y }));
              },
            }
          : {})}
        className="flex-1"
        {...(contentClassName ? { contentContainerClassName: contentClassName } : {})}
      >
        {children}
      </ScrollView>

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
          <View
            className="absolute rounded-full bg-fg-subtle opacity-80"
            style={
              horizontal
                ? { left: at, width: thumb, top: 0, bottom: 0 }
                : { top: at, height: thumb, left: 0, right: 0 }
            }
          />
        </View>
      ) : null}
    </View>
  );
}
