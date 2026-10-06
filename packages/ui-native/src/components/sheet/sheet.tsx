import BottomSheet, {
  BottomSheetView,
  useBottomSheetInternal,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
  type BottomSheetProps,
} from '@gorhom/bottom-sheet';
import * as DialogPrimitive from '@rn-primitives/dialog';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, State } from 'react-native-gesture-handler';
import { styled } from 'react-native-css';
import { View } from 'react-native-css/components';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { animateTo, useMotion } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import type { Transition } from '../../lib/motion.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, quietFrame } from '../../lib/overlay.tsx';
import { Button } from '../button/button.tsx';
import { BackGuard, DialogFooter } from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';

/**
 * A panel from the edge of the screen, for work that needs the height: a long
 * editor, a record opened from a list. Short tasks open centred, as a
 * `Dialog`; a sheet is not a dialog that happens to be at the bottom.
 *
 * It is modal: focus moves in and back to the trigger, and Escape, the Android
 * back button, VoiceOver's escape gesture, a press on the scrim and a drag
 * toward its own edge all close it. `guard` holds every one of them while
 * there is unsaved work.
 *
 * The bottom sheet is `@gorhom/bottom-sheet`: it sizes to its content, avoids
 * the keyboard and hands a drag to a scroll view inside it. The top sheet,
 * which that library does not draw, slides and drags the same way.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const Content = styled(flatStyle(DialogPrimitive.Content));
const Title = styled(flatStyle(DialogPrimitive.Title));
const Description = styled(flatStyle(DialogPrimitive.Description));

/** The gap between a sheet and the screen's edges: the page reads as still there. */
const INSET = 8;
/** The tallest a sheet grows, as a share of the space it opens in. */
const MAX_SHARE = 0.88;
/**
 * Where a released drag is taken to be heading: its position plus this many
 * seconds of its velocity. The bottom sheet's rule (gorhom's `snapPoint`),
 * used for the top one too, so a flick closes as readily as a long drag.
 */
const PROJECT = 0.2;

export type SheetContentProps = {
  children?: ReactNode;
  className?: string | undefined;
  /**
   * The edge it comes from. Bottom on a phone, where the thumb is; top is
   * rare, for a search that drops down from the bar.
   */
  side?: 'bottom' | 'top';
  /**
   * Called when someone tries to dismiss the sheet (Escape, back, the scrim, a
   * drag, the close button). Return `true` to keep it open, then ask whether
   * to discard. Release it once the form is clean.
   */
  guard?: () => boolean;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  /**
   * Names the sheet for a screen reader when it has no `SheetTitle`. A sheet
   * with a visible title leaves it unset.
   */
  label?: string;
};

/**
 * gorhom names its sheet "Bottom Sheet" with the role `adjustable` (a slider
 * on the web, which then needs a value). The dialog inside already has the
 * role and the name; `null` is how its props say "none".
 */
const NO_SLIDER = { accessibilityRole: null, accessibilityLabel: null } as unknown as Pick<
  BottomSheetProps,
  'accessibilityRole' | 'accessibilityLabel'
>;

/** A spring or a timing from the shared presets, in gorhom's shape. */
function gorhomConfig(transition: Transition): {
  duration?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
} {
  if (transition.type === 'spring') {
    const { mass, stiffness, damping } = transition;
    return { mass, stiffness, damping };
  }
  return { duration: transition.duration };
}

export function SheetContent({
  children,
  className,
  side = 'bottom',
  guard,
  portalHost,
  label,
}: SheetContentProps): React.JSX.Element | null {
  const { open, onOpenChange } = DialogPrimitive.useRootContext();
  const container = useOverlayContainer(portalHost);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  const exited = useCallback(() => {
    setMounted(false);
  }, []);
  const dismiss = useCallback((): void => {
    if (!guard?.()) onOpenChange(false);
  }, [guard, onOpenChange]);
  if (!mounted) return null;

  const hold = (event: Event): void => {
    // Radix's DOM event, on the web only.
    if (guard?.()) (event as unknown as { preventDefault: () => void }).preventDefault();
  };
  const surface = (
    <Content
      forceMount
      ref={quietFrame}
      onEscapeKeyDown={hold}
      // The scrim dismisses, through `dismiss`; Radix's own outside press
      // would also fire on a drag that ends past the sheet.
      onInteractOutside={(event: Event) => {
        (event as unknown as { preventDefault: () => void }).preventDefault();
      }}
      onAccessibilityEscape={dismiss}
      className={cn('gap-3.5 px-5 pb-5 outline-none', side === 'top' && 'pt-5', className)}
    >
      {label ? (
        <Title className="absolute h-px w-px overflow-hidden opacity-0">{label}</Title>
      ) : null}
      {children}
    </Content>
  );

  return (
    <DialogPrimitive.Portal
      forceMount
      {...(portalHost ? { hostName: portalHost } : {})}
      container={container}
    >
      {side === 'top' ? (
        <EdgePanel edge="top" open={open} dismiss={dismiss} onExited={exited}>
          <View className="overflow-hidden rounded-[36px] bg-surface-raised shadow-xl">
            {surface}
          </View>
        </EdgePanel>
      ) : (
        <BottomFrame open={open} dismiss={dismiss} guard={guard} onExited={exited}>
          {surface}
        </BottomFrame>
      )}
      <BackGuard onBack={dismiss} />
      <InertOutside />
    </DialogPrimitive.Portal>
  );
}

type FrameProps = {
  open: boolean;
  dismiss: () => void;
  onExited: () => void;
  children: ReactNode;
};

/** The scrim, on the sheet's clock, pressing it asks to dismiss. */
function Scrim({
  progress,
  offset = 0,
  onPress,
}: {
  /** 0 closed, 1 open, after `offset` is added. */
  progress: SharedValue<number>;
  offset?: number;
  onPress: () => void;
}): React.JSX.Element {
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, progress.value + offset)),
  }));
  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    scheduleOnRN(onPress);
  });
  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, style]}
      >
        <View className="absolute inset-0 bg-overlay" />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The grabber. It turns the accent colour while a finger holds the sheet, so
 * the drag shows it has been picked up. Decorative: a screen reader closes
 * the sheet with its escape gesture or the close button.
 */
function Handle(): React.JSX.Element {
  const { animatedHandleGestureState, animatedContentGestureState } = useBottomSheetInternal();
  const held = useAnimatedStyle(() => ({
    opacity:
      animatedHandleGestureState.value === State.ACTIVE ||
      animatedContentGestureState.value === State.ACTIVE
        ? 1
        : 0,
  }));
  return (
    <View className="items-center pt-2 pb-4" aria-hidden>
      <View className="h-[5px] w-9 overflow-hidden rounded-full bg-surface-active">
        <Animated.View
          style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, held]}
        >
          <View className="absolute inset-0 bg-accent" />
        </Animated.View>
      </View>
    </View>
  );
}

function Background({ style }: BottomSheetBackgroundProps): React.JSX.Element {
  return (
    <View pointerEvents="none" style={style}>
      <View className="absolute inset-0 rounded-[36px] bg-surface-raised shadow-xl" />
    </View>
  );
}

function BottomFrame({
  open,
  dismiss,
  guard,
  onExited,
  children,
}: FrameProps & { guard: (() => boolean) | undefined }): React.JSX.Element {
  const ref = useRef<BottomSheet>(null);
  const { sheet } = useMotion();
  const [height, setHeight] = useState(0);
  // Under reduced motion the sheet does not travel: it and its scrim fade.
  const fade = useSharedValue(sheet.slide ? 1 : 0);

  useEffect(() => {
    if (sheet.slide) {
      if (!open) ref.current?.close(gorhomConfig(sheet.exit));
      return;
    }
    fade.value = animateTo(
      open ? 1 : 0,
      open ? sheet.enter : sheet.exit,
      open
        ? undefined
        : (finished) => {
            'worklet';
            if (finished) scheduleOnRN(onExited);
          },
    );
  }, [open, sheet, fade, onExited]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const Backdrop = useCallback(
    ({ animatedIndex }: BottomSheetBackdropProps) => (
      // gorhom's index runs from -1, closed, to 0, at its one detent.
      <Scrim progress={animatedIndex} offset={1} onPress={dismiss} />
    ),
    [dismiss],
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, fadeStyle]}
      onLayout={(event: LayoutChangeEvent) => {
        setHeight(event.nativeEvent.layout.height);
      }}
    >
      {height > 0 ? (
        <BottomSheet
          ref={ref}
          index={0}
          enableDynamicSizing
          maxDynamicContentSize={Math.round(height * MAX_SHARE)}
          enablePanDownToClose
          detached
          bottomInset={INSET}
          style={{ marginHorizontal: INSET }}
          animateOnMount={sheet.slide}
          animationConfigs={sheet.slide ? gorhomConfig(sheet.enter) : { duration: 0 }}
          // The sheet is a group of controls, not one adjustable element.
          accessible={false}
          {...NO_SLIDER}
          handleComponent={Handle}
          backgroundComponent={Background}
          backdropComponent={Backdrop}
          onAnimate={(_from, to) => {
            // A drag past the line asks the guard first, and stays if held.
            if (to === -1 && open && guard?.()) ref.current?.snapToIndex(0);
          }}
          onClose={() => {
            if (open) dismiss();
            onExited();
          }}
        >
          <BottomSheetView>{children}</BottomSheetView>
        </BottomSheet>
      ) : null}
    </Animated.View>
  );
}

/**
 * A panel at the top or bottom edge that does not need gorhom: the top sheet,
 * and the action sheet. It slides in from its edge on the sheet preset and,
 * when `draggable`, is dragged back toward that edge to close (headed past
 * half its height, as the bottom sheet does). Under reduced motion it fades.
 * The scrim fades on the same clock and a press on it asks to dismiss.
 *
 * Exported for the action sheet; an app opens a `Sheet`.
 */
export function EdgePanel({
  edge,
  inset = INSET,
  draggable = true,
  open,
  dismiss,
  onExited,
  children,
}: FrameProps & {
  edge: 'top' | 'bottom';
  /** The gap to the screen's edges, in points. */
  inset?: number;
  draggable?: boolean;
}): React.JSX.Element {
  const { sheet } = useMotion();
  const [height, setHeight] = useState(0);
  // Toward the edge is negative for the top and positive for the bottom.
  const sign = edge === 'top' ? -1 : 1;
  // 0 at rest, `sign * (height + inset)` out of sight past the edge.
  const travel = useSharedValue(0);
  const opacity = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (height === 0) return;
    const away = sign * (height + inset);
    const transition = open ? sheet.enter : sheet.exit;
    const done = open
      ? undefined
      : (finished?: boolean) => {
          'worklet';
          if (finished) scheduleOnRN(onExited);
        };
    if (sheet.slide) {
      if (open) travel.value = away;
      opacity.value = 1;
      travel.value = animateTo(open ? 0 : away, transition, done);
    } else {
      travel.value = 0;
      opacity.value = animateTo(open ? 1 : 0, transition, done);
    }
    progress.value = animateTo(open ? 1 : 0, transition);
  }, [open, height, inset, sign, sheet, travel, opacity, progress, onExited]);

  const pan = Gesture.Pan()
    .enabled(draggable)
    .onChange((event) => {
      'worklet';
      // Toward the edge follows the finger; away from it resists, a third as far.
      const toward = event.translationY * sign;
      travel.value = sign * (toward > 0 ? toward : toward / 3);
      progress.value = 1 - Math.max(0, travel.value * sign) / Math.max(1, height);
    })
    .onEnd((event) => {
      'worklet';
      if ((travel.value + PROJECT * event.velocityY) * sign > height / 2) {
        scheduleOnRN(dismiss);
      }
      // Back to rest; if the dismissal goes through, `open` turns false and
      // the exit takes over from wherever this is.
      travel.value = animateTo(0, sheet.enter);
      progress.value = animateTo(1, sheet.enter);
    });

  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, opacity.value)),
    transform: [{ translateY: travel.value }],
  }));

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <Scrim progress={progress} onPress={dismiss} />
      <GestureDetector gesture={pan}>
        {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
        <Animated.View
          style={[{ position: 'absolute', [edge]: inset, left: inset, right: inset }, style]}
          onLayout={(event: LayoutChangeEvent) => {
            setHeight(event.nativeEvent.layout.height);
          }}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * The title row: the title and its description, and the close button at the
 * end. `closeLabel` names the button for a screen reader.
 */
export function SheetHeader({
  children,
  className,
  showCloseButton = true,
  closeLabel = 'Close',
}: {
  children?: ReactNode;
  className?: string | undefined;
  showCloseButton?: boolean;
  closeLabel?: string;
}): React.JSX.Element {
  return (
    <View className={cn('flex-row items-center justify-between gap-3', className)}>
      <View className="flex-1 gap-1">{children}</View>
      {showCloseButton ? (
        <SheetClose asChild>
          <Button
            variant="secondary"
            size="xs"
            startIcon={<Icon icon={X} />}
            accessibilityLabel={closeLabel}
          />
        </SheetClose>
      ) : null}
    </View>
  );
}

export function SheetTitle({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Title className={cn('text-[20px] leading-[1.25] font-bold text-fg', className)}>
      {children}
    </Title>
  );
}

export function SheetDescription({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Description className={cn('text-subhead leading-[1.5] text-fg-muted', className)}>
      {children}
    </Description>
  );
}

/** What the sheet is for, between the header and the actions. */
export function SheetBody({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <View className={cn('gap-3.5', className)}>{children}</View>;
}

/** The actions, sharing the row equally; the confirming one last, on the thumb's side. */
export const SheetFooter = DialogFooter;
