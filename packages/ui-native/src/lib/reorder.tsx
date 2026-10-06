import { durations } from '@reach/ui/motion';
import { GripVertical, Lock } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, type AccessibilityActionEvent } from 'react-native';
import { Pressable, View } from 'react-native-css/components';
import Sortable from 'react-native-sortables';

import { Icon } from '../components/icon/icon.tsx';
import { cn } from './cn.ts';

/**
 * What every reorderable thing shares (a table's rows, a sortable list, a
 * kanban column): the drag on `react-native-sortables`, a handle that also
 * moves by keyboard and by a screen reader's actions, and a spoken result for
 * every move. Dragging is never the only way to move something.
 */

const WEB = Platform.OS === 'web';

/** Long-press before a drag starts on touch, so a scroll or a tap is never taken for one. */
export const DRAG_DELAY = 250;

/** The drag's motion, from the shared durations: lifting reads as a response, the drop as a movement. */
export const dragMotion = {
  activationAnimationDuration: durations.fast,
  dropAnimationDuration: durations.normal,
  dragActivationDelay: DRAG_DELAY,
  activeItemScale: 1.02,
  activeItemShadowOpacity: 0.18,
  inactiveItemOpacity: 1,
} as const;

/** Moves one entry of a list, returning a new list. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/**
 * Speaks a sentence: VoiceOver and TalkBack directly, a polite live region on
 * the web. Render `region` once, anywhere in the component.
 */
export function useAnnouncer(): { announce: (message: string) => void; region: ReactNode } {
  const [message, setMessage] = useState('');
  const announce = useCallback((said: string) => {
    if (WEB) setMessage(said);
    else AccessibilityInfo.announceForAccessibility(said);
  }, []);
  const region = WEB ? (
    <View
      role="status"
      aria-live="polite"
      // Visually hidden, read aloud.
      className="absolute h-px w-px overflow-hidden opacity-0"
    >
      {message}
    </View>
  ) : null;
  return { announce, region };
}

export type ReorderHandleProps = {
  /** What moves, as a screen reader names it: "Move Payroll". */
  label: string;
  /** One step up (-1) or down (+1). */
  onMove: (delta: -1 | 1) => void;
  /** Cannot move: a lock instead of the grip. */
  locked?: boolean;
  size?: number;
  className?: string | undefined;
};

/**
 * The grip a drag starts from, inside a `Sortable` with `customHandle`. A
 * target of its own: arrow keys move the row on a keyboard, and VoiceOver and
 * TalkBack offer "Move up" and "Move down" as its actions.
 */
export function ReorderHandle({
  label,
  onMove,
  locked = false,
  size = 18,
  className,
}: ReorderHandleProps): React.JSX.Element {
  if (locked) {
    // Fixed order: the row cannot be picked up, and nothing is dropped in its place.
    return (
      <Sortable.Handle mode="fixed-order">
        <View className={cn('min-h-m-tap w-6 items-center justify-center', className)}>
          <Icon icon={Lock} size={size - 2} tone="subtle" label={`${label}: fixed in place`} />
        </View>
      </Sortable.Handle>
    );
  }
  return (
    <Sortable.Handle>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint="Drag, or use the actions, to move it"
        accessibilityActions={[
          { name: 'increment', label: 'Move down' },
          { name: 'decrement', label: 'Move up' },
        ]}
        onAccessibilityAction={(e: AccessibilityActionEvent) => {
          onMove(e.nativeEvent.actionName === 'decrement' ? -1 : 1);
        }}
        {...(WEB
          ? ({
              role: 'button',
              'aria-label': `${label}. Arrow keys move it`,
              onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  onMove(e.key === 'ArrowUp' ? -1 : 1);
                }
              },
            } as object)
          : {})}
        hitSlop={8}
        className={cn('min-h-m-tap w-6 items-center justify-center', className)}
      >
        <Icon icon={GripVertical} size={size} tone="subtle" />
      </Pressable>
    </Sortable.Handle>
  );
}
