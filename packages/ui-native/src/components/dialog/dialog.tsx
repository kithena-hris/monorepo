import * as DialogPrimitive from '@rn-primitives/dialog';
import { X } from 'lucide-react-native';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { BackHandler, Platform } from 'react-native';
import { styled } from 'react-native-css';
import { View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { cn } from '../../lib/cn.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, quietFrame, usePresence } from '../../lib/overlay.tsx';
import { Button } from '../button/button.tsx';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/**
 * A modal dialog, centred on a phone too.
 *
 * Short tasks open centred, not as sheets: a confirmation, a filter, a few
 * fields fit on screen and keep the page in sight around them. A long editor
 * that needs the height is a `Sheet`.
 *
 * Focus moves into it and back to the trigger when it closes; Escape, the
 * Android back button and VoiceOver's escape gesture dismiss it, and so does a
 * press on the scrim. `guard` can hold all of them while there is unsaved work.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const Overlay = styled(flatStyle(DialogPrimitive.Overlay));
const Content = styled(flatStyle(DialogPrimitive.Content));
const Title = styled(flatStyle(DialogPrimitive.Title));
const Description = styled(flatStyle(DialogPrimitive.Description));

const WEB = Platform.OS === 'web';

/** The phone's dialog width; narrower screens keep a 16-point margin instead. */
const WIDTH = 342;

/** The surface every centred modal shares: Dialog's and AlertDialog's. */
export const centredSurface =
  'w-full gap-3.5 rounded-[30px] bg-surface-raised p-[22px] shadow-xl outline-none';

/**
 * The scrim and a centred column, inside the portal. Shared with AlertDialog,
 * which brings its own primitives.
 */
export function CentredFrame({
  scrim,
  scrimStyle,
  style,
  width = WIDTH,
  children,
}: {
  scrim: ReactNode;
  width?: number | undefined;
  scrimStyle: ReturnType<typeof usePresence>['scrimStyle'];
  style: ReturnType<typeof usePresence>['style'];
  children: ReactNode;
}): React.JSX.Element {
  return (
    <View pointerEvents="box-none" className="absolute inset-0 items-center justify-center p-4">
      <Animated.View
        style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, scrimStyle]}
      >
        {scrim}
      </Animated.View>
      {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
      <Animated.View style={[{ width: '100%', maxWidth: width }, style]}>{children}</Animated.View>
    </View>
  );
}

/**
 * Android's back button, routed through the guard. Rendered after the
 * primitive's content so its listener is the newer one, which Android asks
 * first.
 */
export function BackGuard({ onBack }: { onBack: () => void }): null {
  useEffect(() => {
    if (WEB) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [onBack]);
  return null;
}

export type DialogContentProps = {
  children?: ReactNode;
  className?: string | undefined;
  /**
   * The close button in the corner. Off on a phone, where the design has none:
   * the actions, the scrim and the back gesture already close it.
   */
  showCloseButton?: boolean;
  closeLabel?: string;
  /**
   * Called when someone tries to dismiss the dialog (Escape, back, the scrim,
   * the close button). Return `true` to keep it open, then ask whether to
   * discard. The one legitimate reason is unsaved work; release the guard once
   * the form is clean, or the dialog becomes a trap.
   */
  guard?: () => boolean;
  /**
   * What takes focus when it opens, instead of the first focusable control:
   * the selected row of a picker, say. Anything with `focus()`, such as a
   * pressable's or a text input's ref.
   */
  initialFocus?: RefObject<{ focus: () => void } | null>;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  /**
   * The widest it may be, in points: 342 by default, the phone's dialog. A
   * narrower screen keeps a 16-point margin either side instead.
   */
  width?: number;
};

export function DialogContent({
  children,
  className,
  showCloseButton = false,
  closeLabel = 'Close',
  guard,
  portalHost,
  width,
  initialFocus,
}: DialogContentProps): React.JSX.Element | null {
  const { open, onOpenChange } = DialogPrimitive.useRootContext();
  const presence = usePresence(open);
  const container = useOverlayContainer(portalHost);
  if (!presence.mounted) return null;

  const dismiss = (): void => {
    if (!guard?.()) onOpenChange(false);
  };
  const hold = (event: Event): void => {
    // Radix's DOM event, on the web only. Under React Native's own types (the
    // app's, with no DOM library) `Event` has no `preventDefault`.
    if (guard?.()) (event as unknown as { preventDefault: () => void }).preventDefault();
  };

  return (
    <DialogPrimitive.Portal
      forceMount
      {...(portalHost ? { hostName: portalHost } : {})}
      container={container}
    >
      <CentredFrame
        width={width}
        scrimStyle={presence.scrimStyle}
        style={presence.style}
        scrim={
          <Overlay
            forceMount
            closeOnPress={false}
            // On the web Radix dismisses on a press outside, through `hold`.
            {...(WEB ? {} : { onPress: dismiss })}
            className="absolute inset-0 bg-overlay"
          />
        }
      >
        <Content
          forceMount
          ref={quietFrame}
          onEscapeKeyDown={hold}
          {...(initialFocus
            ? {
                onOpenAutoFocus: (event: Event) => {
                  // Radix's DOM event, on the web only.
                  (event as unknown as { preventDefault: () => void }).preventDefault();
                  initialFocus.current?.focus();
                },
              }
            : {})}
          onInteractOutside={hold}
          onAccessibilityEscape={dismiss}
          className={cn(centredSurface, className)}
        >
          {children}
          {showCloseButton ? (
            <View className="absolute top-3 right-3">
              <Button
                variant="secondary"
                size="xs"
                startIcon={<Icon icon={X} />}
                accessibilityLabel={closeLabel}
                onPress={dismiss}
              />
            </View>
          ) : null}
        </Content>
        <BackGuard onBack={dismiss} />
        <InertOutside />
      </CentredFrame>
    </DialogPrimitive.Portal>
  );
}

/** The title and description, centred on a phone. */
export function DialogHeader({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <View className={cn('items-center gap-2', className)}>{children}</View>;
}

export const dialogTitleClass = 'text-center text-[18px] leading-[1.25] font-semibold text-fg';
export const dialogDescriptionClass = 'text-center text-subhead leading-[1.55] text-fg-muted';

export function DialogTitle({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <Title className={cn(dialogTitleClass, className)}>{children}</Title>;
}

/**
 * The line under the title. `asChild` lends the description's role to one
 * view of your own, for a description that is more than a sentence.
 */
export function DialogDescription({
  children,
  className,
  asChild = false,
}: {
  children?: ReactNode;
  className?: string | undefined;
  asChild?: boolean;
}): React.JSX.Element {
  return asChild ? (
    <Description asChild className={cn(className)}>
      {children}
    </Description>
  ) : (
    <Description className={cn(dialogDescriptionClass, className)}>{children}</Description>
  );
}

/** Fields or anything else between the header and the actions. */
export function DialogBody({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <View className={cn('gap-3.5', className)}>{children}</View>;
}

export type DialogFooterProps = {
  children?: ReactNode;
  /** One above the other, for labels too long to share a row. */
  stack?: boolean;
  className?: string | undefined;
};

/*
 * Equal shares of the row, but never narrower than the label: a long label
 * ("Delete team") takes what it needs and the other gives way, as the design's
 * `flex: 1` with a CSS minimum does. Yoga has no content minimum, so on a
 * device the label shrinks to its share.
 */
const FOOTER_ITEM = WEB ? 'flex-1 min-w-fit' : 'flex-1';

/**
 * The actions. On a phone they share the row equally, so neither is a small
 * target; Cancel first, the confirming action last, on the thumb's side.
 */
export function DialogFooter({
  children,
  stack = false,
  className,
}: DialogFooterProps): React.JSX.Element {
  return (
    <View className={cn('mt-1 gap-2', stack ? 'flex-col' : 'flex-row', className)}>
      {Children.map(children, (child) =>
        isValidElement<{ className?: string }>(child)
          ? cloneElement(child as ReactElement<{ className?: string }>, {
              className: cn(!stack && FOOTER_ITEM, child.props.className),
            })
          : child,
      )}
    </View>
  );
}

const iconTone = {
  accent: 'bg-accent-subtle',
  info: 'bg-info-subtle',
  success: 'bg-success-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
} as const;

export type DialogIconProps = {
  icon: LucideIcon;
  tone?: keyof typeof iconTone;
  className?: string | undefined;
};

/**
 * The glyph above the title, in a tinted disc. Decorative: the title says what
 * is at stake.
 */
export function DialogIcon({
  icon,
  tone = 'accent',
  className,
}: DialogIconProps): React.JSX.Element {
  return (
    <View
      className={cn(
        'size-12 items-center justify-center self-center rounded-full',
        iconTone[tone],
        className,
      )}
    >
      <Icon icon={icon} size={22} tone={tone satisfies IconProps['tone']} />
    </View>
  );
}
