import { Upload } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { Button } from '../button/button.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import type { Pick, PickedFile } from './files.ts';

export {
  checkFile,
  displayName,
  formatBytes,
  middleTruncate,
  type Pick,
  type PickedFile,
  type Refusal,
  type Rejection,
} from './files.ts';

/**
 * Where files come in. On a phone nothing is dragged onto a page, so this is
 * a picker: pressing it calls the app's `pick` (a photo library, the Files
 * app, the camera), and what comes back goes to `onFiles`. An app that does
 * take a drop (an iPad, a desktop browser) says so with `over` while
 * something is held above it.
 */

export type DropzoneProps = {
  /** Opens the app's picker. */
  pick: Pick;
  onFiles: (files: readonly PickedFile[]) => void;
  /** What pressing it does: "Choose files", "Attach receipts". */
  label?: string;
  /** What is accepted, and how large. */
  hint?: string;
  /** Replaces the hint, in danger, and rings it. */
  error?: string | undefined;
  /** `panel`: a large target. `inline`: one row with a Browse button. */
  variant?: 'panel' | 'inline';
  disabled?: boolean;
  /** Something is being dragged over it. */
  over?: boolean;
  icon?: LucideIcon;
  className?: string | undefined;
};

export function Dropzone({
  pick,
  onFiles,
  label = 'Choose files',
  hint = 'PDF, PNG or JPG, up to 10 MB',
  error,
  variant = 'panel',
  disabled = false,
  over = false,
  icon = Upload,
  className,
}: DropzoneProps): React.JSX.Element {
  const ring = useFocusRing();
  const press = usePress();
  const [busy, setBusy] = useState(false);
  const inline = variant === 'inline';
  const open = (): void => {
    if (disabled || busy) return;
    setBusy(true);
    void pick()
      .then((files) => {
        if (files.length) onFiles(files);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const body = (
    <>
      <View
        className={cn(
          'items-center justify-center rounded-full',
          inline ? 'size-9' : 'size-12',
          over ? 'bg-accent-solid' : 'bg-surface-sunken',
        )}
      >
        <Icon icon={icon} size={inline ? 17 : 22} tone={over ? 'on-accent' : 'muted'} />
      </View>
      <View className={cn('gap-0.5', inline ? 'min-w-0 flex-1' : 'items-center')}>
        <CssText
          className={cn(
            'text-[16px] leading-[1.35] font-semibold text-fg',
            !inline && 'text-center',
          )}
        >
          {over ? 'Drop to upload' : label}
        </CssText>
        <CssText
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          aria-live={error ? 'polite' : undefined}
          className={cn(
            'text-[14px] leading-[1.4]',
            error ? 'text-danger-fg' : 'text-fg-muted',
            !inline && 'text-center',
          )}
        >
          {error ?? hint}
        </CssText>
      </View>
    </>
  );

  const frame = cn(
    'rounded-[22px] border-2 border-dashed',
    over ? 'border-accent bg-accent-subtle' : error ? 'border-danger' : 'border-border-strong',
    inline ? 'flex-row items-center gap-3 px-4 py-3' : 'items-center gap-2.5 px-5 py-7',
    disabled && 'opacity-50',
    className,
  );

  // Inline, the Browse button is the control and the row only describes it.
  if (inline)
    return (
      <View aria-disabled={disabled || undefined} className={frame}>
        {body}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          loading={busy}
          accessibilityLabel={`Browse, ${label}`}
          onPress={open}
        >
          Browse
        </Button>
      </View>
    );

  return (
    // The press on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        accessibilityState={{ disabled, busy }}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        onPress={open}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className={cn(frame, 'outline-none active:bg-surface-sunken')}
      >
        {body}
        {ring.focused ? (
          <View
            style={{ pointerEvents: 'none' }}
            className="absolute -inset-[5px] rounded-[27px] border-[3px] border-border-focus"
          />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
