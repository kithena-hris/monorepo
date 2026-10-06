import type { ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { usePlatform } from '../../provider.tsx';
import { Button } from '../button/button.tsx';
import { DialogContent, DialogFooter, DialogTitle } from '../dialog/dialog.tsx';

/**
 * The centred dialog a date or a time is picked in.
 *
 * On iOS it is the design's: the picker alone, and a choice applies as it is
 * made, as iOS's own compact pickers do. On Android it is Material 3's modal
 * picker: what is being picked as a small title, the choice as a large
 * headline over a hairline, and Cancel and OK at the end, the choice a draft
 * until OK.
 */
export function PickerDialog({
  title,
  headline,
  children,
  onCancel,
  onConfirm,
  confirmLabel = 'Done',
  portalHost,
}: {
  /** What is being picked: the field's name. */
  title: string;
  /** The draft, as Android's headline shows it. */
  headline: string;
  children: ReactNode;
  onCancel: () => void;
  /** iOS draws a Done button only when this is given (a range waits for both ends). */
  onConfirm?: (() => void) | undefined;
  confirmLabel?: string;
  portalHost?: string | undefined;
}): React.JSX.Element {
  const android = usePlatform() === 'android';
  return (
    <DialogContent
      {...(portalHost ? { portalHost } : {})}
      className={cn(android ? 'gap-3 rounded-[28px] px-4 pt-5 pb-3' : 'gap-2 px-4 pt-[18px] pb-4')}
    >
      {android ? (
        <View className="gap-6 px-2 pb-3">
          <DialogTitle className="text-left text-subhead font-medium text-fg-muted">
            {title}
          </DialogTitle>
          <CssText
            accessibilityLiveRegion="polite"
            aria-live="polite"
            className="text-[30px] leading-[1.2] font-normal text-fg"
          >
            {headline}
          </CssText>
        </View>
      ) : (
        // Named for a screen reader; the design draws no title over the picker.
        <View className="absolute h-px w-px overflow-hidden opacity-0">
          <DialogTitle>{title}</DialogTitle>
        </View>
      )}
      {android ? <View aria-hidden className="-mx-4 h-px bg-border" /> : null}
      {children}
      {android ? (
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" size="sm" onPress={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onPress={onConfirm ?? onCancel}>
            OK
          </Button>
        </View>
      ) : onConfirm ? (
        <DialogFooter>
          <Button variant="primary" onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      ) : null}
    </DialogContent>
  );
}
