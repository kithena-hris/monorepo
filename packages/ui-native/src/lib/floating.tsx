import * as PopoverPrimitive from '@rn-primitives/popover';
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import type { View as RNView } from 'react-native';
import { Platform } from 'react-native';
import { View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { cn } from './cn.ts';
import type { usePresence } from './overlay.tsx';

/*
 * What every anchored overlay shares: Popover, Tooltip, Hover card, the menus,
 * and the overlays lanes A builds on them (Select, Combobox, DatePicker).
 *
 * `@rn-primitives`' popover, tooltip and hover card keep their open state to
 * themselves: no `open`, no `defaultOpen`. Their trigger, though, carries
 * `open()` and `close()` on its ref, which on a device also measures where
 * the trigger is so the content can be placed. `FloatingRoot` holds that ref
 * and drives it from the props Radix has, so a Reach overlay is controlled or
 * uncontrolled exactly as the web one is.
 */

export type TriggerHandle = { open?: () => void; close?: () => void };

const Handle = createContext<RefObject<TriggerHandle | null> | null>(null);

/** The ref a floating trigger must attach to its primitive. */
export function useTriggerHandle(): RefObject<TriggerHandle | null> {
  const handle = useContext(Handle);
  if (!handle) throw new Error('A floating trigger must be inside its root.');
  return handle;
}

export type FloatingState = {
  /** Controlled: open while true. */
  open?: boolean | undefined;
  /** Uncontrolled: open on the first render. */
  defaultOpen?: boolean | undefined;
};

/**
 * Inside a primitive's root: provides the trigger's ref to the trigger and
 * keeps the primitive's state in step with `open` and `defaultOpen`.
 * `useRoot` is the primitive's own `useRootContext`.
 */
export function FloatingRoot({
  open,
  defaultOpen,
  useRoot,
  children,
}: FloatingState & {
  useRoot: () => { open: boolean };
  children: ReactNode;
}): React.JSX.Element {
  const handle = useRef<TriggerHandle | null>(null);
  return (
    <Handle.Provider value={handle}>
      {children}
      {/* After the children, so the trigger's ref is attached before this runs. */}
      <Sync open={open} defaultOpen={defaultOpen} useRoot={useRoot} handle={handle} />
    </Handle.Provider>
  );
}

function Sync({
  open,
  defaultOpen,
  useRoot,
  handle,
}: FloatingState & {
  useRoot: () => { open: boolean };
  handle: RefObject<TriggerHandle | null>;
}): null {
  const current = useRoot().open;
  const now = useRef(current);
  now.current = current;
  const first = useRef(true);
  // On mount (for `defaultOpen`) and whenever `open` changes, and no other
  // time: a controlled overlay closed from inside has already told its owner
  // through `onOpenChange`.
  useEffect(() => {
    const wanted = open ?? (first.current && defaultOpen ? true : undefined);
    first.current = false;
    if (wanted === undefined || wanted === now.current) return;
    if (wanted) handle.current?.open?.();
    else handle.current?.close?.();
  }, [open]);
  return null;
}

/** The surface every anchored overlay draws on: the design's menu surface. */
export const floatingSurface = 'rounded-[20px] bg-surface-raised shadow-lg';

/** The animated surface, inside the primitive's positioned content. */
export function FloatingSurface({
  presence,
  className,
  children,
}: {
  presence: ReturnType<typeof usePresence>;
  className?: string | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    // The motion on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={presence.style}>
      <View className={cn(floatingSurface, className)}>{children}</View>
    </Animated.View>
  );
}

/** Whether this is the web, where Radix positions and dismisses the content. */
export const WEB = Platform.OS === 'web';

type NativeRoot = {
  onOpenChange: (open: boolean) => void;
  setTriggerPosition?: (position: {
    width: number;
    height: number;
    pageX: number;
    pageY: number;
  }) => void;
};

/**
 * The control, opened by a long press: measured the way the primitive's own
 * trigger measures, while a press still does what the control does.
 */
export function LongPressTrigger({ children }: { children: ReactElement }): React.JSX.Element {
  const root = PopoverPrimitive.useRootContext() as unknown as NativeRoot;
  const handle = useTriggerHandle();
  const node = useRef<RNView | null>(null);
  const show = (): void => {
    node.current?.measure((_x, _y, width, height, pageX, pageY) => {
      root.setTriggerPosition?.({ width, height, pageX, pageY });
      root.onOpenChange(true);
    });
  };
  handle.current = {
    open: show,
    close: () => {
      root.onOpenChange(false);
    },
  };
  if (!isValidElement(children)) return <>{children}</>;
  return cloneElement(children as ReactElement<{ onLongPress?: () => void; ref?: unknown }>, {
    ref: node,
    onLongPress: show,
  });
}
