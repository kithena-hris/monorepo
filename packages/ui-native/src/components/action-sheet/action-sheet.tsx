import * as DialogPrimitive from '@rn-primitives/dialog';
import { Children, useCallback, useEffect, useState, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, quietFrame } from '../../lib/overlay.tsx';
import { BackGuard } from '../dialog/dialog.tsx';
import { type LucideIcon, Icon } from '../icon/icon.tsx';
import { EdgePanel } from '../sheet/sheet.tsx';
import { Text } from '../text/text.tsx';

/**
 * A short list of actions that slides up from the bottom: the phone's menu.
 * The destructive action is red, and Cancel always sits apart, under the
 * thumb, so dismissing is never a reach.
 *
 * It is a modal dialog underneath: focus moves in and back to the trigger,
 * and Escape, the back button, VoiceOver's escape gesture and a press on the
 * scrim cancel it. Each action closes the sheet after it runs.
 */
export const ActionSheet = DialogPrimitive.Root;
export const ActionSheetTrigger = DialogPrimitive.Trigger;

const Content = styled(flatStyle(DialogPrimitive.Content));
const Title = styled(flatStyle(DialogPrimitive.Title));
const Description = styled(flatStyle(DialogPrimitive.Description));
const Close = styled(flatStyle(DialogPrimitive.Close));

/** Its distance from the screen's edges: closer than a sheet's, as iOS draws it. */
const INSET = 10;

const card = 'overflow-hidden rounded-[18px] bg-surface-raised shadow-lg';

/*
 * The keyboard's ring, drawn inside the row: outside it the card's rounded
 * corners would cut it square. On a device there is no ring to draw.
 */
const ring =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus';

export type ActionSheetContentProps = {
  /**
   * What the actions act on: "Vacation · 14–18 Oct". Also the sheet's
   * accessible name; without it the name is `label`.
   */
  title?: ReactNode;
  /** A consequence worth reading first: "Deleting can’t be undone." */
  description?: ReactNode;
  /** Names the sheet when there is no visible title. */
  label?: string;
  /** Content above the actions, such as the people to share with. */
  header?: ReactNode;
  cancelLabel?: string;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  className?: string | undefined;
  /** `ActionSheetItem`s. */
  children?: ReactNode;
};

export function ActionSheetContent({
  title,
  description,
  label = 'Actions',
  header,
  cancelLabel = 'Cancel',
  portalHost,
  className,
  children,
}: ActionSheetContentProps): React.JSX.Element | null {
  const { open, onOpenChange } = DialogPrimitive.useRootContext();
  const container = useOverlayContainer(portalHost);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  const exited = useCallback(() => {
    setMounted(false);
  }, []);
  const cancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  if (!mounted) return null;

  const items = Children.toArray(children);
  return (
    <DialogPrimitive.Portal
      forceMount
      {...(portalHost ? { hostName: portalHost } : {})}
      container={container}
    >
      <EdgePanel
        edge="bottom"
        inset={INSET}
        draggable={false}
        open={open}
        dismiss={cancel}
        onExited={exited}
      >
        <Content
          forceMount
          ref={quietFrame}
          onAccessibilityEscape={cancel}
          className={cn('gap-2 outline-none', className)}
        >
          <View className={card}>
            {title ? (
              <View className="items-center gap-0.5 border-b border-border px-4 py-3.5">
                <Title className="text-center text-footnote leading-[1.3] font-semibold text-fg-muted">
                  {title}
                </Title>
                {description ? (
                  <Description className="text-center text-footnote leading-[1.4] text-fg-subtle">
                    {description}
                  </Description>
                ) : null}
              </View>
            ) : (
              <Title className="absolute h-px w-px overflow-hidden opacity-0">{label}</Title>
            )}
            {header}
            {items.map((item, i) => (
              <View key={i} className={cn(i < items.length - 1 && 'border-b border-border')}>
                {item}
              </View>
            ))}
          </View>
          <Close asChild>
            <Pressable
              accessibilityRole="button"
              className={cn(
                card,
                ring,
                'h-14 items-center justify-center active:bg-surface-active',
              )}
            >
              <Text className="text-[18px] leading-[1.2] font-semibold text-accent-fg">
                {cancelLabel}
              </Text>
            </Pressable>
          </Close>
        </Content>
        <BackGuard onBack={cancel} />
        <InertOutside />
      </EdgePanel>
    </DialogPrimitive.Portal>
  );
}

export type ActionSheetItemProps = {
  onSelect?: () => void;
  /** Deletes or loses data. Red; confirm separately, colour is not consent. */
  destructive?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  className?: string | undefined;
  children?: ReactNode;
};

/** One action: runs `onSelect`, then the sheet closes. */
export function ActionSheetItem({
  onSelect,
  destructive = false,
  disabled = false,
  icon,
  className,
  children,
}: ActionSheetItemProps): React.JSX.Element {
  const tone = disabled ? 'disabled' : destructive ? 'danger' : 'accent';
  return (
    <Close asChild disabled={disabled}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        {...(onSelect ? { onPress: onSelect } : {})}
        className={cn(
          'h-14 flex-row items-center justify-center gap-2 px-4 active:bg-surface-active',
          ring,
          className,
        )}
      >
        {icon ? <Icon icon={icon} size={18} tone={tone} /> : null}
        <Text tone={tone} className="text-[18px] leading-[1.2]">
          {children}
        </Text>
      </Pressable>
    </Close>
  );
}
