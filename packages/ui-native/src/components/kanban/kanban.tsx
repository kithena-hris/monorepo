import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpToLine,
  Ellipsis,
  GripVertical,
  Lock,
  Plus,
  type LucideIcon,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Platform, ScrollView, type AccessibilityActionEvent } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Sortable from 'react-native-sortables';

import { cn } from '../../lib/cn.ts';
import { useAnnouncer, useDragMotion } from '../../lib/reorder.tsx';
import { Button } from '../button/button.tsx';
import { CheckboxBox } from '../checkbox/checkbox.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu.tsx';
import { Icon } from '../icon/icon.tsx';
import { BulkAction } from '../table/table.tsx';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../segmented-control/segmented-control.tsx';

/**
 * Work moving between stages, as the web's `Kanban`, drawn for a phone.
 *
 * Columns 300 wide on a board that snaps one column at a time, or
 * (`layout="single"`) one column under a segmented control. A card moves by
 * long-press and drag within its column or onto another column (a segment,
 * in a single column), and always by a non-drag way too: the card's ⋯ menu
 * ("Move to…", top, bottom), arrow keys on its handle (Space picks up, Esc
 * puts back), and VoiceOver and TalkBack actions. A full column refuses a
 * card and says why; a locked column shows its cards and moves none. Every
 * move is announced.
 */

export type KanbanTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export type KanbanColumnDef = {
  id: string;
  title: string;
  /** A quiet line under the column's title. */
  description?: string;
  tone?: KanbanTone;
  /** Refuses cards past this many. */
  limit?: number;
  /** Shows its cards and moves none. */
  locked?: boolean;
  /** Shown instead of the number of cards: a total held elsewhere, 48 when 5 are loaded. */
  count?: number;
};

export type KanbanMove = { itemId: string; from: string; to: string; toIndex: number };

export type KanbanAction<T> = {
  id: string;
  label: string;
  /** A component, not an element: a phone's menu row sizes and tints it. */
  icon?: LucideIcon;
  destructive?: boolean;
  /** Hide the command for these items: a permission they fail. */
  hidden?: (items: readonly T[]) => boolean;
  /** Show it, greyed. Prefer this to `hidden`: an absent command teaches nothing. */
  disabled?: (items: readonly T[]) => boolean;
  run: (items: readonly T[]) => void;
};

/**
 * Where the grip sits, as the web names the eight places. A phone draws it on
 * the title's line: a `-start` place before the title, an `-end` one after it.
 */
export type KanbanHandlePosition =
  | 'top-start'
  | 'top-center'
  | 'top-end'
  | 'middle-start'
  | 'middle-end'
  | 'bottom-start'
  | 'bottom-center'
  | 'bottom-end';

/** What starts a drag: a grip, the whole card, or nothing (the menu still moves it). */
export type KanbanDragActivator =
  | { mode: 'handle'; position?: KanbanHandlePosition }
  | { mode: 'card' }
  | { mode: 'none' };

/** Card selection, for bulk actions. */
export type KanbanSelection =
  | { mode: 'none' }
  | {
      mode: 'multiple';
      selected: readonly string[];
      onSelectionChange: (ids: readonly string[]) => void;
    };

export type KanbanProps<T extends { id: string }> = {
  columns: readonly KanbanColumnDef[];
  items: Readonly<Record<string, readonly T[]>>;
  onMove: (move: KanbanMove) => void;
  /** The board's accessible name. */
  label: string;
  /** A card's title, and its name when a move is spoken. */
  cardTitle: (item: T) => string;
  /** Under the title: a role, tags, avatars. */
  renderCard?: (item: T, context: { columnId: string; dragging: boolean }) => ReactNode;
  /** What starts a drag. A grip before the title by default. */
  dragActivator?: KanbanDragActivator;
  /** A ⋯ menu on each card with "Move to…", top and bottom, then `cardActions`. */
  cardMenu?: boolean;
  cardActions?: readonly KanbanAction<T>[];
  /** A checkbox on each card, and a bulk bar for the chosen ones. */
  selection?: KanbanSelection;
  /** The bar's commands, for the selection. Requires `selection.mode: 'multiple'`. */
  bulkActions?: readonly KanbanAction<T>[];
  /** A column's own menu: rename, delete. */
  columnActions?: readonly KanbanAction<KanbanColumnDef>[];
  /** "+" in a column's header. */
  onAddCard?: (columnId: string) => void;
  /** Under a column's cards: "Add card", "+ 43 more". */
  renderColumnFooter?: (column: KanbanColumnDef) => ReactNode;
  /** `single`: one column at a time under a segmented control. */
  layout?: 'board' | 'single';
  /** The column a single layout opens on. */
  defaultColumn?: string;
  /** Each column this tall, its cards scrolling under a fixed header. */
  columnHeight?: number;
  /** A board column's width, in points. 300 under a thumb, as on the web. */
  columnWidth?: number;
  /** After the last column: a new section's form. */
  after?: ReactNode;
  /** The card the keyboard is on: a focus ring. */
  focusedId?: string;
  /** Opens this card's ⋯ menu as the board renders: for a walkthrough. */
  defaultMenuOpenFor?: string;
  /** The first column's cards alone, without the column: a card shown on its own. */
  bare?: boolean;
  className?: string | undefined;
};

const WEB = Platform.OS === 'web';
const NO_SELECTION: KanbanSelection = { mode: 'none' };
const GRIP: KanbanDragActivator = { mode: 'handle', position: 'top-start' };
const NO_ACTIONS: readonly never[] = [];
const itemKey = (item: { id: string }): string => item.id;

const DOT: Record<KanbanTone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Kanban<T extends { id: string }>({
  columns,
  items,
  onMove,
  label,
  cardTitle,
  renderCard,
  dragActivator = GRIP,
  cardMenu = false,
  cardActions = NO_ACTIONS,
  selection = NO_SELECTION,
  bulkActions = NO_ACTIONS,
  columnActions = [],
  onAddCard,
  renderColumnFooter,
  layout = 'board',
  defaultColumn,
  columnHeight,
  columnWidth = 300,
  after,
  focusedId,
  bare = false,
  defaultMenuOpenFor,
  className,
}: KanbanProps<T>): React.JSX.Element {
  const drag = useDragMotion();
  const { announce, region } = useAnnouncer();
  const selectable = selection.mode === 'multiple';
  const selected = selection.mode === 'multiple' ? selection.selected : NO_ACTIONS;
  const setSelected = (next: readonly string[]): void => {
    if (selection.mode === 'multiple') selection.onSelectionChange(next);
  };
  const draggable = dragActivator.mode !== 'none';
  const handle =
    dragActivator.mode === 'card'
      ? 'none'
      : dragActivator.mode === 'handle' && dragActivator.position?.endsWith('-end') === true
        ? 'right'
        : 'left';
  const [current, setCurrent] = useState(defaultColumn ?? columns[0]?.id ?? '');
  const [dragging, setDragging] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string; from: string; index: number } | null>(null);

  const cardsOf = (id: string): readonly T[] => items[id] ?? [];
  const columnOf = (itemId: string): KanbanColumnDef | undefined =>
    columns.find((c) => cardsOf(c.id).some((i) => i.id === itemId));
  const find = (itemId: string): T | undefined =>
    Object.values(items)
      .flat()
      .find((i) => i.id === itemId);

  /** Why a column refuses a card, or nothing when it takes it. */
  const refusal = (to: KanbanColumnDef, from: string): string | null => {
    if (to.locked) return `${to.title} is locked`;
    if (to.id !== from && to.limit !== undefined && cardsOf(to.id).length >= to.limit) {
      return `${to.title} is full, ${String(to.limit)} of ${String(to.limit)}`;
    }
    return null;
  };

  const moveCard = (itemId: string, to: string, toIndex: number): void => {
    const fromColumn = columnOf(itemId);
    const target = columns.find((c) => c.id === to);
    const item = find(itemId);
    if (!fromColumn || !target || !item) return;
    if (fromColumn.locked) {
      announce(`${fromColumn.title} is locked. ${cardTitle(item)} stays.`);
      return;
    }
    const refused = refusal(target, fromColumn.id);
    if (refused) {
      announce(`${refused}. ${cardTitle(item)} stays in ${fromColumn.title}.`);
      return;
    }
    const length = cardsOf(to).length - (to === fromColumn.id ? 1 : 0);
    const index = Math.max(0, Math.min(length, toIndex));
    onMove({ itemId, from: fromColumn.id, to, toIndex: index });
    announce(
      `${cardTitle(item)}, moved to ${target.title}, position ${String(index + 1)} of ${String(length + 1)}.`,
    );
  };

  /** Arrow keys and screen-reader actions on a card's handle. */
  const step = (itemId: string, key: 'up' | 'down' | 'left' | 'right'): void => {
    const column = columnOf(itemId);
    if (!column) return;
    const index = cardsOf(column.id).findIndex((i) => i.id === itemId);
    if (key === 'up' || key === 'down') {
      moveCard(itemId, column.id, index + (key === 'up' ? -1 : 1));
      return;
    }
    const at = columns.findIndex((c) => c.id === column.id);
    const next = columns[at + (key === 'left' ? -1 : 1)];
    if (next) moveCard(itemId, next.id, Math.min(index, cardsOf(next.id).length));
  };

  const keyHandler = (item: T) => (e: { key: string; preventDefault: () => void }) => {
    const column = columnOf(item.id);
    if (!column) return;
    const index = cardsOf(column.id).findIndex((i) => i.id === item.id);
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (picked?.id === item.id) {
        setPicked(null);
        announce(`${cardTitle(item)} dropped. Position ${String(index + 1)} of ${String(cardsOf(column.id).length)} in ${column.title}.`);
      } else {
        setPicked({ id: item.id, from: column.id, index });
        announce(`${cardTitle(item)} picked up. Position ${String(index + 1)} of ${String(cardsOf(column.id).length)} in ${column.title}.`);
      }
      return;
    }
    if (e.key === 'Escape' && picked?.id === item.id) {
      e.preventDefault();
      moveCard(item.id, picked.from, picked.index);
      setPicked(null);
      return;
    }
    const arrows: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const direction = arrows[e.key];
    if (direction && picked?.id === item.id) {
      e.preventDefault();
      step(item.id, direction);
    }
  };

  const grip = (item: T, column: KanbanColumnDef): ReactNode => {
    const name = cardTitle(item);
    if (column.locked) return <Icon icon={Lock} size={15} tone="subtle" label="Locked" />;
    return (
      <Sortable.Handle>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={`Move ${name}`}
          accessibilityHint="Long-press and drag, or use the actions, to move it"
          accessibilityActions={[
            { name: 'decrement', label: 'Move up' },
            { name: 'increment', label: 'Move down' },
            { name: 'previous', label: 'Move to the previous column' },
            { name: 'next', label: 'Move to the next column' },
          ]}
          onAccessibilityAction={(e: AccessibilityActionEvent) => {
            const actions: Record<string, 'up' | 'down' | 'left' | 'right'> = {
              decrement: 'up',
              increment: 'down',
              previous: 'left',
              next: 'right',
            };
            const direction = actions[e.nativeEvent.actionName];
            if (direction) step(item.id, direction);
          }}
          {...(WEB
            ? ({
                role: 'button',
                'aria-label': `Move ${name}. Space picks it up, arrows move it, Escape puts it back`,
                'aria-pressed': picked?.id === item.id,
                onKeyDown: keyHandler(item),
              } as object)
            : {})}
          hitSlop={12}
          className="-m-1 p-1"
        >
          <Icon icon={GripVertical} size={15} tone="subtle" />
        </Pressable>
      </Sortable.Handle>
    );
  };

  const menu = (item: T, column: KanbanColumnDef): ReactNode => {
    const cards = cardsOf(column.id);
    const name = cardTitle(item);
    return (
      <DropdownMenu defaultOpen={defaultMenuOpenFor === item.id}>
        <DropdownMenuTrigger>
          <Button
            variant="ghost"
            size="xs"
            startIcon={<Icon icon={Ellipsis} />}
            accessibilityLabel={`Actions for ${name}`}
            className="-my-1.5 -mr-1.5"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent label={`Actions for ${name}`} className="w-[240px]">
          {column.locked ? (
            <DropdownMenuItem icon={ArrowRightLeft} disabled description={`${column.title} is locked`}>
              Move to
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={ArrowRightLeft}>
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {columns
                  .filter((c) => c.id !== column.id)
                  .map((c) => {
                    const why = refusal(c, column.id);
                    return (
                      <DropdownMenuItem
                        key={c.id}
                        disabled={why !== null}
                        {...(why ? { description: why } : {})}
                        onSelect={() => {
                          moveCard(item.id, c.id, cardsOf(c.id).length);
                        }}
                      >
                        {c.title}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem
            icon={ArrowUpToLine}
            disabled={(column.locked ?? false) || cards[0]?.id === item.id}
            onSelect={() => {
              moveCard(item.id, column.id, 0);
            }}
          >
            Move to top
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={ArrowDownToLine}
            disabled={(column.locked ?? false) || cards.at(-1)?.id === item.id}
            onSelect={() => {
              moveCard(item.id, column.id, cards.length);
            }}
          >
            Move to bottom
          </DropdownMenuItem>
          {cardActions.length > 0 ? <DropdownMenuSeparator /> : null}
          {cardActions
            .filter((a) => a.hidden?.([item]) !== true)
            .map((a) => (
              <DropdownMenuItem
                key={a.id}
                {...(a.icon ? { icon: a.icon } : {})}
                destructive={a.destructive ?? false}
                disabled={a.disabled?.([item]) ?? false}
                onSelect={() => {
                  a.run([item]);
                }}
              >
                {a.label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const card = (item: T, column: KanbanColumnDef): React.JSX.Element => {
    const name = cardTitle(item);
    const on = selected.includes(item.id);
    const whole = draggable && handle === 'none' && !column.locked;
    const body = (
      <View
        className={cn(
          'gap-2.5 rounded-[14px] bg-surface p-3 shadow-sm',
          dragging === item.id && 'bg-surface-raised shadow-lg',
          column.locked && 'opacity-70',
        )}
      >
        <View className="flex-row items-start gap-2">
          {draggable && (handle === 'left' || (column.locked && handle !== 'right'))
            ? grip(item, column)
            : null}
          <CssText className="min-w-0 flex-1 text-[15px] leading-[1.35] font-semibold text-fg">
            {name}
          </CssText>
          {draggable && handle === 'right' ? grip(item, column) : null}
          {cardMenu ? menu(item, column) : null}
          {selectable ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Select ${name}`}
              accessibilityState={{ checked: on }}
              aria-checked={on}
              hitSlop={10}
              onPress={() => {
                setSelected(on ? selected.filter((s) => s !== item.id) : [...selected, item.id]);
              }}
            >
              <CheckboxBox checked={on} />
            </Pressable>
          ) : null}
        </View>
        {renderCard ? renderCard(item, { columnId: column.id, dragging: dragging === item.id }) : null}
        {focusedId === item.id || picked?.id === item.id ? (
          <View
            aria-hidden
            className="absolute -inset-[3px] rounded-[17px] border-[3px] border-border-focus"
          />
        ) : null}
      </View>
    );
    return whole ? <Sortable.Handle>{body}</Sortable.Handle> : body;
  };

  const header = (column: KanbanColumnDef): React.JSX.Element => {
    const n = cardsOf(column.id).length;
    const over = column.limit !== undefined && n >= column.limit;
    const count =
      column.limit !== undefined ? `${String(n)} / ${String(column.limit)}` : String(column.count ?? n);
    return (
      <View className="flex-row items-center gap-2 px-1.5 pt-1 pb-1.5">
        <View className={cn('size-2 rounded-full', DOT[column.tone ?? 'neutral'])} />
        <CssText accessibilityRole="header" className="text-[14px] leading-none font-semibold text-fg">
          {column.title}
        </CssText>
        <CssText
          accessibilityLabel={over ? `${count}, full` : `${count} cards`}
          className={cn(
            'text-[12px] leading-none font-semibold',
            over ? 'text-danger-fg' : 'text-fg-muted',
          )}
        >
          {count}
        </CssText>
        {column.locked ? <Icon icon={Lock} size={13} tone="subtle" label="Locked" /> : null}
        {column.description ? (
          <CssText numberOfLines={1} className="shrink text-[12px] leading-none text-fg-muted">
            {column.description}
          </CssText>
        ) : null}
        <View className="ml-auto flex-row">
          {onAddCard && !column.locked ? (
            <Button
              variant="ghost"
              size="xs"
              startIcon={<Icon icon={Plus} size={16} tone="subtle" />}
              accessibilityLabel={`Add a card to ${column.title}`}
              onPress={() => {
                onAddCard(column.id);
              }}
              className="-my-2"
            />
          ) : null}
          {columnActions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button
                  variant="ghost"
                  size="xs"
                  startIcon={<Icon icon={Ellipsis} size={16} tone="subtle" />}
                  accessibilityLabel={`Actions for ${column.title}`}
                  className="-my-2"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent label={`Actions for ${column.title}`} className="w-[220px]">
                {columnActions
                  .filter((a) => a.hidden?.([column]) !== true)
                  .map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      {...(a.icon ? { icon: a.icon } : {})}
                      destructive={a.destructive ?? false}
                      disabled={a.disabled?.([column]) ?? false}
                      onSelect={() => {
                        a.run([column]);
                      }}
                    >
                      {a.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </View>
      </View>
    );
  };

  const column = (def: KanbanColumnDef, width: number | '100%'): React.JSX.Element => {
    const cards = cardsOf(def.id);
    const grid = (
      <View role="list" aria-label={`${def.title}, ${String(cards.length)} cards`}>
      <Sortable.Grid
        data={cards as T[]}
        columns={1}
        rowGap={8}
        keyExtractor={itemKey}
        customHandle
        sortEnabled={draggable && !def.locked}
        {...drag}
        onDragStart={({ key }) => {
          setDragging(key);
        }}
        onDragEnd={({ key, fromIndex, toIndex }) => {
          setDragging(null);
          // A drop on another column's zone has already moved it.
          if (columnOf(key)?.id === def.id && fromIndex !== toIndex) moveCard(key, def.id, toIndex);
        }}
        renderItem={({ item }) => <View role="listitem">{card(item, def)}</View>}
      />
      </View>
    );
    return (
      <Sortable.BaseZone
        key={def.id}
        onItemDrop={() => {
          if (dragging && columnOf(dragging)?.id !== def.id) {
            moveCard(dragging, def.id, cards.length);
          }
        }}
        style={{ width }}
      >
        <View
          className="gap-2 rounded-[18px] bg-surface-sunken p-2.5"
          style={columnHeight ? { height: columnHeight } : undefined}
        >
          {header(def)}
          {columnHeight ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {grid}
              {renderColumnFooter?.(def)}
            </ScrollView>
          ) : (
            <>
              {grid}
              {renderColumnFooter?.(def)}
            </>
          )}
        </View>
      </Sortable.BaseZone>
    );
  };

  const chosen = Object.values(items)
    .flat()
    .filter((i) => selected.includes(i.id));

  return (
    <Sortable.MultiZoneProvider>
      <View role="group" aria-label={label} className={cn('gap-3', className)}>
        {bare ? (
          columns.slice(0, 1).map((c) => (
            <Sortable.Grid
              key={c.id}
              data={cardsOf(c.id) as T[]}
              columns={1}
              rowGap={8}
              keyExtractor={itemKey}
              customHandle
              sortEnabled={draggable}
              {...drag}
              onDragEnd={({ key, toIndex }) => {
                moveCard(key, c.id, toIndex);
              }}
              renderItem={({ item }) => card(item, c)}
            />
          ))
        ) : layout === 'single' ? (
          <>
            <SegmentedControl
              size="sm"
              fullWidth
              value={current}
              onValueChange={setCurrent}
              accessibilityLabel={`${label}: stage`}
            >
              {columns.map((c) => (
                <SegmentedControlItem key={c.id} value={c.id}>
                  {`${c.title} ${String(c.count ?? cardsOf(c.id).length)}`}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            {columns
              .filter((c) => c.id === current)
              .map((c) => column(c, '100%'))}
          </>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={columnWidth + 12}
            decelerationRate="fast"
            contentContainerStyle={{ gap: 12, alignItems: 'flex-start', paddingBottom: 6 }}
          >
            {columns.map((c) => column(c, columnWidth))}
            {after}
          </ScrollView>
        )}
        {selectable && chosen.length > 0 ? (
          <View className="flex-row items-center gap-1.5 self-center rounded-full bg-invert py-1.5 pr-1.5 pl-[18px] shadow-lg">
            <CssText role="status" className="text-[14px] leading-none font-semibold text-fg-on-invert">
              {`${String(chosen.length)} selected`}
            </CssText>
            <View className="mx-2 h-5 w-px bg-fg-on-invert opacity-25" />
            {bulkActions
              .filter((a) => a.hidden?.(chosen) !== true)
              .map((a) => (
                <BulkAction
                  key={a.id}
                  disabled={a.disabled?.(chosen) ?? false}
                  onPress={() => {
                    a.run(chosen);
                  }}
                >
                  {a.label}
                </BulkAction>
              ))}
          </View>
        ) : null}
        {region}
      </View>
    </Sortable.MultiZoneProvider>
  );
}

/** A card's line under its title: the role, its tags, its people. */
export function KanbanCardMeta({
  description,
  children,
  people,
}: {
  description?: string;
  /** Tags: `Badge`s. */
  children?: ReactNode;
  /** An `AvatarGroup`, at the end. */
  people?: ReactNode;
}): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {description ? (
        <CssText className="text-[13px] leading-[1.3] text-fg-muted">{description}</CssText>
      ) : null}
      {children}
      {people ? <View className="ml-auto">{people}</View> : null}
    </View>
  );
}
