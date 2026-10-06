import { useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Popover, PopoverAnchor, PopoverContent } from '../popover/popover.tsx';
import { Text } from '../text/text.tsx';

/**
 * Introduces one new feature, pointing at the control itself. One tour, three
 * steps at most, shown the first time somebody reaches the feature rather than
 * at sign-in; the caller remembers that it was seen. Never for something a
 * better label would explain.
 *
 * The control stays fully usable. Skip, the back button, Escape or a press
 * outside dismiss it.
 */
export type CoachMarkProps = {
  /** The control being introduced. */
  children: ReactNode;
  title: string;
  description?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A small tag above the title, "New" by default. `null` hides it. */
  badge?: string | null;
  /** This step's place in a tour, from 1. Shown as "1 of 3" when `total` is above 1. */
  step?: number;
  total?: number;
  /** Advances the tour. Without it the primary action closes the callout. */
  onNext?: () => void;
  nextLabel?: string;
  /** Shows a Skip action, which also closes. */
  onSkip?: () => void;
  skipLabel?: string;
  /** Rings the control and dims everything else. The ring is a pill, as a Reach button is. */
  spotlight?: boolean;
  side?: 'top' | 'bottom';
  /**
   * Placement of the control in its parent. The ring hugs the control, so in
   * a column give it an alignment (`self-center`) rather than a stretch.
   */
  className?: string | undefined;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
};

export function CoachMark({
  children,
  title,
  description,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  badge = 'New',
  step = 1,
  total = 1,
  onNext,
  nextLabel,
  onSkip,
  skipLabel = 'Skip',
  spotlight = false,
  side = 'bottom',
  className,
  portalHost,
}: CoachMarkProps): React.JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean): void => {
    setUncontrolled(next);
    onOpenChange?.(next);
  };
  const last = step >= total;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor className={className}>
        {children}
        {spotlight && open ? <Spotlight /> : null}
      </PopoverAnchor>
      <PopoverContent
        side={side}
        align="center"
        sideOffset={12}
        label={title}
        {...(portalHost ? { portalHost } : {})}
        className="w-[280px] gap-2"
      >
        {badge === null ? null : (
          <Badge tone="accent" size="sm">
            {badge}
          </Badge>
        )}
        <Text weight="bold" className="text-[16px] leading-[1.35]">
          {title}
        </Text>
        {description ? (
          <Text variant="subhead" tone="muted" className="leading-[1.5]">
            {description}
          </Text>
        ) : null}
        <View className="mt-1 flex-row items-center gap-1.5">
          {total > 1 ? (
            <Text variant="caption" tone="subtle" tabular>
              {`${String(step)} of ${String(total)}`}
            </Text>
          ) : null}
          <View className="flex-1" />
          <View className="flex-row gap-1.5">
            {onSkip ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  onSkip();
                  setOpen(false);
                }}
              >
                {skipLabel}
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onPress={() => {
                if (onNext) onNext();
                else setOpen(false);
              }}
            >
              {nextLabel ?? (last ? 'Got it' : 'Next')}
            </Button>
          </View>
        </View>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The ring round the control and the dim round the ring, drawn as views so
 * they look the same on a device: a ring 4 points out, and past it a border
 * 2,000 points wide in the scrim colour whose hole is the ring's pill. It
 * lets every press through.
 */
function Spotlight(): React.JSX.Element {
  return (
    <>
      <View
        aria-hidden
        pointerEvents="none"
        className="absolute -inset-[2004px] rounded-full border-[2000px] border-overlay"
      />
      <View
        aria-hidden
        pointerEvents="none"
        className="absolute -inset-1 rounded-full border-4 border-accent"
      />
    </>
  );
}

/**
 * A quiet dot for something new, inside the control it marks (which must be
 * positioned). It goes away the first time the control is opened, which the
 * caller decides by no longer rendering it. Decorative: add ", new" to the
 * control's own label. Under reduced motion it stops pulsing and stays solid.
 */
export function CoachMarkDot({ className }: { className?: string | undefined }): React.JSX.Element {
  return (
    <View
      aria-hidden
      pointerEvents="none"
      className={cn(
        'absolute top-1.5 right-1.5 size-2 rounded-full bg-accent',
        'outline-2 outline-canvas motion-safe:animate-pulse-ring',
        className,
      )}
    />
  );
}
