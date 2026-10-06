import { Bell, Check, Info, Sparkles, TriangleAlert, X } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from '../../lib/cn.ts';
import { usePresence } from '../../lib/overlay.tsx';
import { usePlatform } from '../../provider.tsx';
import { Button } from '../button/button.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { Spinner } from '../spinner/spinner.tsx';

/**
 * A brief confirmation after an action, as the web's: it goes by itself, so
 * nothing essential ever lives only in a toast. The inverted card the design
 * draws, 20pt corners, a 24pt disc in the tone, the title 15 and a line 13,
 * and at most one action (Undo, Retry) as a wash button.
 *
 * Where it appears is the platform's: from the top on iOS, as a system
 * banner does; from the bottom on Android, as Material's snackbar does.
 */

export type ToastTone = 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'neutral';

/** The bright status colour: the disc is a glyph's ground, not text's. */
const disc = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
  neutral: 'bg-fg-subtle',
} as const satisfies Record<ToastTone, string>;

const glyph: Record<ToastTone, LucideIcon> = {
  success: Check,
  info: Info,
  warning: TriangleAlert,
  danger: X,
  accent: Sparkles,
  neutral: Bell,
};

const WEB = Platform.OS === 'web';

export type ToastAction = { label: string; onPress: () => void };

export type ToastProps = {
  title: string;
  /** One line more: what happened, or what to do. */
  children?: string;
  tone?: ToastTone;
  /** Something still running: a spinner in the disc. */
  loading?: boolean;
  /** One action, for the moment the toast is up: Undo, Retry. */
  action?: ToastAction;
  /** A close button. A toast that goes by itself rarely needs one. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string | undefined;
};

/** The card itself. Show one with `useToast()`; draw one directly only in a story or a preview. */
export function Toast({
  title,
  children,
  tone = 'success',
  loading = false,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
}: ToastProps): React.JSX.Element {
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <View
      {...(WEB ? { role: urgent ? ('alert' as const) : ('status' as const) } : {})}
      className={cn(
        'w-full flex-row items-center gap-3 rounded-[20px] bg-invert py-3 pl-3.5 shadow-lg',
        action || onDismiss ? 'pr-2' : 'pr-3.5',
        className,
      )}
    >
      <View className={cn('size-6 items-center justify-center rounded-full', disc[tone])}>
        {loading ? (
          <Spinner size={14} tone="on-accent" decorative />
        ) : (
          <Icon icon={glyph[tone]} size={14} className="text-white" />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <CssText className="text-subhead font-semibold leading-[1.3] text-fg-on-invert">
          {title}
        </CssText>
        {children ? (
          <CssText className="text-[13px] leading-[1.4] text-fg-on-invert opacity-80">
            {children}
          </CssText>
        ) : null}
      </View>
      {action ? (
        <Button size="xs" variant="on-invert" onPress={action.onPress}>
          {action.label}
        </Button>
      ) : null}
      {onDismiss ? (
        <Button
          size="xs"
          variant="ghost"
          accessibilityLabel={dismissLabel}
          startIcon={<Icon icon={X} size={16} tone="on-invert" />}
          onPress={onDismiss}
        />
      ) : null}
    </View>
  );
}

/** How long a toast stays: longer when it carries an action someone may want. */
const STAY_MS = 4000;
const STAY_WITH_ACTION_MS = 8000;

export type ToastOptions = Omit<ToastProps, 'className' | 'onDismiss'> & {
  /** Milliseconds before it goes. */
  duration?: number;
};

type Shown = ToastOptions & { id: number };

type ToastApi = {
  /** Shows a toast, replacing the one up. Returns a function that takes it down. */
  show: (toast: ToastOptions) => () => void;
  dismiss: () => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Shows toasts from anywhere under a `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider.');
  return api;
}

export type ToastProviderProps = {
  children: ReactNode;
  /**
   * Space kept clear under a bottom toast, for the tab bar it floats above.
   * Android only; on iOS a toast comes from the top.
   */
  bottomInset?: number;
};

/**
 * Where toasts appear, over everything under it. One at a time: a new toast
 * replaces the last, so nothing queues up behind a screen someone has left.
 */
export function ToastProvider({
  children,
  bottomInset = 0,
}: ToastProviderProps): React.JSX.Element {
  const [shown, setShown] = useState<Shown | null>(null);
  const next = useRef(0);
  const dismiss = useCallback(() => {
    setShown(null);
  }, []);
  const show = useCallback((toast: ToastOptions) => {
    next.current += 1;
    const id = next.current;
    setShown({ ...toast, id });
    return () => {
      setShown((current) => (current?.id === id ? null : current));
    };
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      <View className="flex-1">
        {children}
        <Viewport shown={shown} onDone={dismiss} bottomInset={bottomInset} />
      </View>
    </ToastContext.Provider>
  );
}

function Viewport({
  shown,
  onDone,
  bottomInset,
}: {
  shown: Shown | null;
  onDone: () => void;
  bottomInset: number;
}): React.JSX.Element | null {
  const platform = usePlatform();
  const top = platform === 'ios';
  const insets = useSafeAreaInsets();
  // What was last shown stays drawn while it animates out.
  const [last, setLast] = useState<Shown | null>(shown);
  useEffect(() => {
    if (shown) setLast(shown);
  }, [shown]);
  const presence = usePresence(shown !== null, top ? 'bottom' : 'top');

  useEffect(() => {
    if (!shown) return undefined;
    AccessibilityInfo.announceForAccessibility(
      shown.children ? `${shown.title}. ${shown.children}` : shown.title,
    );
    const stay = shown.duration ?? (shown.action ? STAY_WITH_ACTION_MS : STAY_MS);
    const timer = setTimeout(onDone, stay);
    return () => {
      clearTimeout(timer);
    };
  }, [shown, onDone]);

  if (!presence.mounted || !last) return null;
  const { action, title, children, tone, loading } = last;
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 px-4"
      style={top ? { top: insets.top + 8 } : { bottom: insets.bottom + 16 + bottomInset }}
    >
      {/* The motion on a bare Animated.View, the card inside it (RMB-001). */}
      <Animated.View style={presence.style}>
        <Toast
          title={title}
          {...(children ? { children } : {})}
          {...(tone ? { tone } : {})}
          {...(loading ? { loading } : {})}
          {...(action
            ? {
                action: {
                  label: action.label,
                  onPress: () => {
                    action.onPress();
                    onDone();
                  },
                },
              }
            : {})}
        />
      </Animated.View>
    </View>
  );
}
