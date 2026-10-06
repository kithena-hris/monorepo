import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Children, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';

/**
 * A few equal items side by side that people swipe through, as the web's.
 * Each slide snaps to the start, and unless a slide takes the whole width the
 * next one always peeks in from the edge, which is what says "there is more".
 * It never plays by itself.
 */

const WEB = Platform.OS === 'web';

/** The space between slides, the design's 12. */
const GAP = 12;
/** The page margin the row runs under when it bleeds to the screen's edge. */
const MARGIN = 16;

/** The slide nearest a scroll position, for a row of slides `step` apart. */
export function slideAt(x: number, step: number, count: number): number {
  if (step <= 0 || count === 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(x / step)));
}

export type CarouselProps = {
  /** The slides, all the same kind. */
  children: ReactNode;
  /** Names the carousel for a screen reader: "Upcoming events". */
  accessibilityLabel: string;
  /** A heading over the row, beside the arrows. */
  title?: string;
  /**
   * `arrows`: previous and next buttons beside the title, for pointer users
   * (a phone swipes). `dots`: where you are, under the row. `none`: the peek
   * says it all.
   */
  controls?: 'arrows' | 'dots' | 'none';
  /** A slide's width: a share of the row (`0.78`, the default) or `1` for one at a time. */
  slideWidth?: number;
  /** The row runs under the page margin to the screen's edge, as a peeking row does. */
  bleed?: boolean;
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  previousLabel?: string;
  nextLabel?: string;
  className?: string | undefined;
};

export function Carousel({
  children,
  accessibilityLabel,
  title,
  controls = 'none',
  slideWidth = 0.78,
  bleed = false,
  index: controlled,
  defaultIndex = 0,
  onIndexChange,
  previousLabel = 'Previous',
  nextLabel = 'Next',
  className,
}: CarouselProps): React.JSX.Element {
  const slides = Children.toArray(children);
  const count = slides.length;
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [own, setOwn] = useState(defaultIndex);
  const index = controlled ?? own;
  const inner = bleed ? width - 2 * MARGIN : width;
  const slide = Math.round(inner * slideWidth);
  const step = slide + GAP;

  const settle = (next: number): void => {
    if (next === index) return;
    setOwn(next);
    onIndexChange?.(next);
  };
  const go = (next: number): void => {
    const to = Math.min(count - 1, Math.max(0, next));
    scroller.current?.scrollTo({ x: to * step, animated: true });
    settle(to);
  };
  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    settle(slideAt(event.nativeEvent.contentOffset.x, step, count));
  };

  return (
    <View
      role="region"
      aria-roledescription="carousel"
      aria-label={accessibilityLabel}
      className={cn('gap-3', className)}
    >
      {title || controls === 'arrows' ? (
        <View className="flex-row items-center gap-2">
          {title ? (
            <CssText role="heading" className="flex-1 text-[17px] font-bold leading-[1.4] text-fg">
              {title}
            </CssText>
          ) : (
            <View className="flex-1" />
          )}
          {controls === 'arrows' ? (
            <View className="flex-row gap-1.5">
              <Button
                variant="secondary"
                size="xs"
                startIcon={<Icon icon={ChevronLeft} />}
                accessibilityLabel={previousLabel}
                disabled={index === 0}
                onPress={() => {
                  go(index - 1);
                }}
              />
              <Button
                variant="secondary"
                size="xs"
                startIcon={<Icon icon={ChevronRight} />}
                accessibilityLabel={nextLabel}
                disabled={index === count - 1}
                onPress={() => {
                  go(index + 1);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <View
        onLayout={(e: LayoutChangeEvent) => {
          setWidth(e.nativeEvent.layout.width + (bleed ? 2 * MARGIN : 0));
        }}
      >
        <ScrollView
          ref={scroller}
          // Focusable on the web: the arrow keys then scroll it, and axe's
          // rule that a scrolling region be reachable by keyboard holds.
          {...(WEB ? { tabIndex: 0 as const } : {})}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          {...(step > GAP ? { snapToInterval: step } : {})}
          snapToAlignment="start"
          disableIntervalMomentum
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          scrollEventThrottle={16}
          style={bleed ? { marginHorizontal: -MARGIN } : undefined}
          contentContainerStyle={{ gap: GAP, paddingHorizontal: bleed ? MARGIN : 0 }}
        >
          {slides.map((child, i) => (
            <View
              // Slides are positional: the order is the carousel.
              key={i}
              role="group"
              aria-roledescription="slide"
              aria-label={`${String(i + 1)} of ${String(count)}`}
              style={{ width: slide || undefined }}
            >
              {child}
            </View>
          ))}
        </ScrollView>
      </View>
      {controls === 'dots' ? (
        <View className="flex-row justify-center gap-1.5">
          {slides.map((_, i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={`Slide ${String(i + 1)} of ${String(count)}`}
              accessibilityState={{ selected: i === index }}
              hitSlop={{ top: 18, bottom: 18, left: 3, right: 3 }}
              onPress={() => {
                go(i);
              }}
              className={cn(
                'h-2 rounded-full',
                i === index ? 'w-5 bg-fg' : 'w-2 bg-surface-active',
              )}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
