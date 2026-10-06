import { Check, Copy, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';

// No extension: the bundler picks `clipboard-write.web.ts` for the web.
import { writeText } from '../../lib/clipboard-write';
import { cn } from '../../lib/cn.ts';
import { Button, type ButtonProps } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';

/**
 * Copy to the clipboard, as the web's: the write can be refused and says so,
 * the confirmation is announced as well as shown, and it reverts by itself.
 *
 * The write goes through `expo-clipboard` on a device (React Native dropped
 * its own clipboard) and the browser's `navigator.clipboard` on the web, the
 * same refusal path `@reach/ui` handles.
 */

export type ClipboardStatus = 'idle' | 'copied' | 'error';

export type UseClipboardOptions = {
  /** Milliseconds before the confirmation reverts. */
  resetAfter?: number;
  onCopy?: (text: string) => void;
  onError?: (error: unknown) => void;
  /**
   * The write itself. Defaults to the platform's clipboard. A seam, not a feature: the
   * refusal path cannot be reached where the clipboard always works.
   */
  write?: (text: string) => Promise<unknown>;
};

export type UseClipboardResult = {
  status: ClipboardStatus;
  /** Call from a press handler. Resolves to whether the write succeeded. */
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
};

/** The mechanism without the button, for a row, a code block or anything else that copies. */
export function useClipboard({
  resetAfter = 2000,
  onCopy,
  onError,
  write = writeText,
}: UseClipboardOptions = {}): UseClipboardResult {
  const [status, setStatus] = useState<ClipboardStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      clear();
      let ok = true;
      try {
        await write(text);
        setStatus('copied');
        onCopy?.(text);
      } catch (error) {
        ok = false;
        setStatus('error');
        onError?.(error);
      }
      timer.current = setTimeout(() => {
        setStatus('idle');
      }, resetAfter);
      return ok;
    },
    [clear, onCopy, onError, resetAfter, write],
  );

  const reset = useCallback(() => {
    clear();
    setStatus('idle');
  }, [clear]);

  return { status, copy, reset };
}

const WEB = Platform.OS === 'web';

/**
 * Says the outcome once, politely: a live region on the web, an announcement
 * to VoiceOver and TalkBack on a device.
 */
function Announce({ message }: { message: string }): React.JSX.Element | null {
  useEffect(() => {
    if (!WEB && message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!WEB) return null;
  return (
    <View
      aria-live="polite"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}
    >
      <CssText>{message}</CssText>
    </View>
  );
}

export type CopyButtonProps = Omit<ButtonProps, 'children' | 'onPress' | 'href' | 'startIcon'> & {
  /** The text to put on the clipboard. */
  value: string;
  /** The visible label. Leave it out for an icon-only button; it still has a name. */
  children?: string;
  /** The button's name when icon-only, and what is read before copying. */
  label?: string;
  copiedLabel?: string;
  errorLabel?: string;
  /** Replaces the copy glyph while idle: `Link` for "Copy link". */
  icon?: React.ComponentProps<typeof Icon>['icon'];
  resetAfter?: number;
  onCopy?: (text: string) => void;
  onError?: (error: unknown) => void;
  write?: UseClipboardOptions['write'];
  /** An icon-only button that says "Copied" in words while confirming, as a field's does. */
  sayCopied?: boolean;
};

/**
 * A button that copies and confirms in place: tinted, a tick, "Copied". A
 * refusal shows a cross and is read out, so nobody pastes stale text.
 */
export function CopyButton({
  value,
  children,
  label = 'Copy',
  copiedLabel = 'Copied',
  errorLabel = 'Couldn’t copy',
  icon = Copy,
  resetAfter,
  onCopy,
  onError,
  write,
  sayCopied = false,
  variant = 'ghost',
  size = 'sm',
  accessibilityLabel,
  ...props
}: CopyButtonProps): React.JSX.Element {
  const { status, copy } = useClipboard({
    ...(resetAfter === undefined ? {} : { resetAfter }),
    ...(onCopy ? { onCopy } : {}),
    ...(onError ? { onError } : {}),
    ...(write ? { write } : {}),
  });
  const copied = status === 'copied';
  const text = children
    ? copied
      ? copiedLabel
      : children
    : copied && sayCopied
      ? copiedLabel
      : '';
  return (
    <View>
      <Button
        {...props}
        variant={copied ? 'tinted' : variant}
        size={size}
        accessibilityLabel={accessibilityLabel ?? children ?? label}
        startIcon={
          status === 'error' ? (
            <Icon icon={X} tone="danger" />
          ) : (
            <Icon icon={copied ? Check : icon} />
          )
        }
        onPress={() => {
          void copy(value);
        }}
      >
        {text}
      </Button>
      <Announce message={copied ? copiedLabel : status === 'error' ? errorLabel : ''} />
    </View>
  );
}

export type CopyFieldProps = {
  value: string;
  /** Names the value, inside the field above it: "Employee ID". */
  label?: string;
  /** Shown instead of the value, which still goes to the clipboard whole. */
  display?: string;
  /** Monospace, for an id, a token or an IBAN. */
  mono?: boolean;
  /** Read for the copy button. Defaults to "Copy" and the label. */
  copyLabel?: string;
  onCopy?: (text: string) => void;
  onError?: (error: unknown) => void;
  write?: UseClipboardOptions['write'];
  resetAfter?: number;
  className?: string | undefined;
};

const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
});

/**
 * A read-only value with its copy button inside the shape: the field's 56pt
 * and 16 corners, an edge and no fill, so it never looks like something to
 * type into. The value is selectable text, not a read-only input.
 */
export function CopyField({
  value,
  label,
  display,
  mono = false,
  copyLabel,
  onCopy,
  onError,
  write,
  resetAfter,
  className,
}: CopyFieldProps): React.JSX.Element {
  return (
    <View
      className={cn(
        'h-m-field flex-row items-center gap-2.5 rounded-[16px] border border-border pl-4 pr-1',
        className,
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        {label ? (
          <CssText className="text-[12px] font-medium leading-[1.2] text-fg-muted">{label}</CssText>
        ) : null}
        <CssText
          selectable
          numberOfLines={1}
          className="text-body leading-[1.25] text-fg tabular-nums"
          {...(mono ? { style: { fontFamily: MONO } } : {})}
        >
          {display ?? value}
        </CssText>
      </View>
      <CopyButton
        value={value}
        size="xs"
        sayCopied
        label={copyLabel ?? (label ? `Copy ${label}` : 'Copy')}
        {...(onCopy ? { onCopy } : {})}
        {...(onError ? { onError } : {})}
        {...(write ? { write } : {})}
        {...(resetAfter === undefined ? {} : { resetAfter })}
      />
    </View>
  );
}
