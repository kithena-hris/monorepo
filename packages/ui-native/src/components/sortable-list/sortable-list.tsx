import { useState, type ReactNode } from 'react';
import { Platform, type AccessibilityActionEvent } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';
import Sortable from 'react-native-sortables';

import { cn } from '../../lib/cn.ts';
import { dragMotion, move, ReorderHandle, useAnnouncer } from '../../lib/reorder.tsx';

/**
 * A short list reordered by dragging, as the web's `SortableList`: long-press
 * a grip (or, with `activator="row"`, the whole row) and drag. Every move has
 * a way without a drag (arrow keys on the handle, "Move up" and "Move down"
 * from VoiceOver and TalkBack) and every move is announced: "Jonas Weber,
 * approver 2 of 4. Moved to position 1."
 */

export type SortableItem = { id: string; locked?: boolean };

export type SortableMove = { id: string; from: number; to: number; order: readonly string[] };

export type SortableListProps<T extends SortableItem> = {
  items: readonly T[];
  /** The list's accessible name. */
  label: string;
  onReorder: (move: SortableMove) => void;
  /** `row`: the whole row is the drag target; links and buttons in it still work. */
  activator?: 'handle' | 'row';
  /** A row's content: a title and a line under it, or anything else. */
  children: (item: T, info: { index: number }) => ReactNode;
  /** What a row is called when its move is spoken: "Jonas Weber, approver 2". */
  itemLabel: (item: T, index: number) => string;
  className?: string | undefined;
};

const WEB = Platform.OS === 'web';

export function SortableList<T extends SortableItem>({
  items,
  label,
  onReorder,
  activator = 'handle',
  children,
  itemLabel,
  className,
}: SortableListProps<T>): React.JSX.Element {
  const { announce, region } = useAnnouncer();
  const [lifted, setLifted] = useState<string | null>(null);
  const ids = items.map((i) => i.id);
  const total = items.length;

  const reorder = (from: number, to: number): void => {
    const item = items[from];
    const target = items[to];
    if (!item || !target || item.locked || target.locked || from === to) return;
    onReorder({ id: item.id, from, to, order: move(ids, from, to) });
    announce(
      `${itemLabel(item, from)}, ${String(from + 1)} of ${String(total)}. Moved to position ${String(to + 1)}.`,
    );
  };

  const row = (item: T, index: number): React.JSX.Element => {
    const name = itemLabel(item, index);
    const whole = activator === 'row' && !item.locked;
    const content = (
      <View
        {...(whole
          ? {
              accessible: true,
              accessibilityLabel: `${name}, ${String(index + 1)} of ${String(total)}`,
              accessibilityHint: 'Long-press and drag, or use the actions, to move it',
              accessibilityActions: [
                { name: 'increment', label: 'Move down' },
                { name: 'decrement', label: 'Move up' },
              ],
              onAccessibilityAction: (e: AccessibilityActionEvent) => {
                reorder(index, index + (e.nativeEvent.actionName === 'decrement' ? -1 : 1));
              },
            }
          : {})}
        {...(whole && WEB
          ? ({
              tabIndex: 0,
              role: 'button',
              'aria-label': `${name}, ${String(index + 1)} of ${String(total)}. Arrow keys move it`,
              onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  reorder(index, index + (e.key === 'ArrowUp' ? -1 : 1));
                }
              },
            } as object)
          : {})}
        className={cn(
          'min-h-[60px] flex-row items-center gap-3 rounded-[14px] bg-surface px-3.5 py-2 shadow-sm',
          lifted === item.id && 'bg-surface-raised shadow-lg',
        )}
      >
        {activator === 'handle' || item.locked ? (
          <ReorderHandle
            label={`Move ${name}, ${String(index + 1)} of ${String(total)}`}
            locked={item.locked ?? false}
            size={16}
            onMove={(delta) => {
              reorder(index, index + delta);
            }}
          />
        ) : null}
        {children(item, { index })}
      </View>
    );
    return whole ? <Sortable.Handle>{content}</Sortable.Handle> : content;
  };

  return (
    <View className={cn(className)}>
      <View role="list" aria-label={label}>
      <Sortable.Grid
        data={items as T[]}
        columns={1}
        rowGap={8}
        keyExtractor={(i) => i.id}
        customHandle
        {...dragMotion}
        onDragStart={({ key }) => {
          setLifted(key);
        }}
        onDragEnd={({ fromIndex, toIndex }) => {
          setLifted(null);
          reorder(fromIndex, toIndex);
        }}
        renderItem={({ item, index }) => <View role="listitem">{row(item, index)}</View>}
      />
      </View>
      {region}
    </View>
  );
}

/** A row's text: its name, and a quieter line under it. */
export function SortableRowText({
  title,
  description,
}: {
  title: string;
  description?: string;
}): React.JSX.Element {
  return (
    <View className="min-w-0 flex-1">
      <CssText className="text-callout leading-[1.3] font-semibold text-fg">{title}</CssText>
      {description ? (
        <CssText className="text-[14px] leading-[1.3] text-fg-muted">{description}</CssText>
      ) : null}
    </View>
  );
}
