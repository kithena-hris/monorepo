import * as AlertDialogPrimitive from '@rn-primitives/alert-dialog';
import type { ReactNode } from 'react';
import { styled } from 'react-native-css';

import { cn } from '../../lib/cn.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, usePresence } from '../../lib/overlay.tsx';
import {
  BackGuard,
  CentredFrame,
  centredSurface,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogIcon,
  dialogDescriptionClass,
  dialogTitleClass,
} from '../dialog/dialog.tsx';

/**
 * Confirmation for something that cannot be undone.
 *
 * Not a `Dialog` with different buttons: it is announced as an alert, so a
 * screen reader reads the description at once; a press on the scrim does not
 * dismiss it, so a stray tap cannot answer it; and focus lands on Cancel, not
 * on the destructive action. Escape and the back button still cancel.
 *
 * Name the action on the button ("Delete team"), never OK. If the action can be
 * undone, skip the dialog: do it, and offer Undo.
 */
export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

const Overlay = styled(flatStyle(AlertDialogPrimitive.Overlay));
const Content = styled(flatStyle(AlertDialogPrimitive.Content));
const Title = styled(flatStyle(AlertDialogPrimitive.Title));
const Description = styled(flatStyle(AlertDialogPrimitive.Description));

export type AlertDialogContentProps = {
  children?: ReactNode;
  className?: string | undefined;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
};

export function AlertDialogContent({
  children,
  className,
  portalHost,
}: AlertDialogContentProps): React.JSX.Element | null {
  const { open, onOpenChange } = AlertDialogPrimitive.useRootContext();
  const presence = usePresence(open);
  const container = useOverlayContainer(portalHost);
  if (!presence.mounted) return null;
  const cancel = (): void => {
    onOpenChange(false);
  };
  return (
    <AlertDialogPrimitive.Portal
      forceMount
      {...(portalHost ? { hostName: portalHost } : {})}
      container={container}
    >
      <CentredFrame
        scrimStyle={presence.scrimStyle}
        style={presence.style}
        scrim={<Overlay forceMount className="absolute inset-0 bg-overlay" />}
      >
        <Content
          forceMount
          onAccessibilityEscape={cancel}
          className={cn(centredSurface, className)}
        >
          {children}
        </Content>
        <BackGuard onBack={cancel} />
        <InertOutside />
      </CentredFrame>
    </AlertDialogPrimitive.Portal>
  );
}

export const AlertDialogHeader = DialogHeader;
export const AlertDialogBody = DialogBody;
export const AlertDialogFooter = DialogFooter;
export const AlertDialogIcon = DialogIcon;

export function AlertDialogTitle({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <Title className={cn(dialogTitleClass, className)}>{children}</Title>;
}

export function AlertDialogDescription({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <Description className={cn(dialogDescriptionClass, className)}>{children}</Description>;
}
