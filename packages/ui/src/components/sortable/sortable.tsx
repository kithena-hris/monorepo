'use client';

import { useId, useState, type JSX, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * A list whose order is the data.
 *
 * Approval chains, interview stages, pay elements, checklist items: anywhere
 * the sequence means something and a person decides it.
 *
 * ### The drag is the accelerator, not the mechanism
 *
 * Every row carries **Move up** and **Move down** buttons as well as a drag
 * handle. A drag is unreachable by a keyboard, a switch, an unsteady hand and a
 * screen reader, so a list that can only be reordered by dragging is a list
 * some people cannot reorder at all. dnd-kit's keyboard sensor is wired up too,
 * but the buttons are the path that needs no instructions.
 *
 * ### A handle, not the whole row
 *
 * Rows in a list like this usually contain their own buttons and links, and a
 * whole-row activator eats every one of them. The handle is a named control
 * with its own focus ring; `activator: 'row'` is there for rows that are
 * genuinely inert.
 *
 * ### It never owns the order
 *
 * `onReorder` hands back the reordered ids and the chart of what moved. The
 * caller's array stays the truth, in a system with an audit trail, a reorder
 * is an event, not a mutation.
 */

export interface SortableItem {
  id: string;
  /** Blocks this row being dragged, and being displaced by a drag. */
  locked?: boolean;
}

export interface SortableMove {
  id: string;
  from: number;
  to: number;
  /** The ids in their new order. */
  order: readonly string[];
}

export interface SortableListProps<T extends SortableItem> {
  items: readonly T[];
  /** Names the list for assistive tech and for the drag announcements. */
  label: string;
  onReorder: (move: SortableMove) => void;
  /** What grabs a row: its own handle, or anywhere on it. */
  activator?: 'handle' | 'row';
  /** Renders one row. The chrome around it is supplied. */
  children: (item: T, info: { index: number; dragging: boolean }) => ReactNode;
  /** Hides the up/down buttons. Only for a list that is also reorderable elsewhere. */
  hideMoveButtons?: boolean;
  className?: string;
}

export function SortableList<T extends SortableItem>({
  items,
  label,
  onReorder,
  activator = 'handle',
  children,
  hideMoveButtons = false,
  className,
}: SortableListProps<T>): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);
  const instructionsId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Below a deliberate click's wobble, above a tap's. Without it every
      // click on a row's own buttons starts a drag instead.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = items.map((item) => item.id);
  const activeItem = items.find((item) => item.id === activeId) ?? null;

  const move = (from: number, to: number): void => {
    const item = items[from];
    if (!item || to < 0 || to >= items.length) return;
    if (item.locked === true || items[to]?.locked === true) return;
    onReorder({ id: item.id, from, to, order: arrayMove([...ids], from, to) });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up item ${String(ids.indexOf(String(active.id)) + 1)}.`,
    onDragOver: ({ over }) =>
      over ? `Now over position ${String(ids.indexOf(String(over.id)) + 1)}.` : undefined,
    onDragEnd: ({ over }) =>
      over ? `Dropped at position ${String(ids.indexOf(String(over.id)) + 1)}.` : 'Dropped.',
    onDragCancel: () => 'Move cancelled. The order is unchanged.',
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      // A list reorders along one axis and cannot leave its own container.
      // Without these a row can be dragged into the middle of the page, which
      // says the drop will land there, and it will not.
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={({ active }: DragStartEvent) => {
        setActiveId(String(active.id));
      }}
      onDragCancel={() => {
        setActiveId(null);
      }}
      onDragEnd={({ active, over }: DragEndEvent) => {
        setActiveId(null);
        if (!over || active.id === over.id) return;
        move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
      }}
    >
      <p id={instructionsId} className="sr-only">
        Use the Move up and Move down buttons to change the order, or press Space on a drag handle
        and use the arrow keys.
      </p>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul
          aria-label={label}
          aria-describedby={instructionsId}
          className={cn('space-y-2', className)}
        >
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              activator={activator}
              hideMoveButtons={hideMoveButtons}
              onMove={move}
            >
              {children(item, { index, dragging: activeId === item.id })}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>

      <DragOverlay>
        {activeItem ? (
          <div className="rounded-md border border-accent bg-surface px-3 py-2 shadow-md">
            {children(activeItem, { index: ids.indexOf(activeItem.id), dragging: true })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRow({
  item,
  index,
  total,
  activator,
  hideMoveButtons,
  onMove,
  children,
}: {
  item: SortableItem;
  index: number;
  total: number;
  activator: 'handle' | 'row';
  hideMoveButtons: boolean;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}): JSX.Element {
  const locked = item.locked === true;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: locked });

  return (
    <li
      ref={setNodeRef}
      style={{
        // `CSS.Transform` rather than `Translate`: dnd-kit also scales the item
        // it is dragging, and dropping the scale makes the row jump on pick-up.
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-2',
        'transition-[box-shadow,opacity] duration-(--animate-duration-fast)',
        isDragging && 'opacity-40',
        locked && 'bg-surface-sunken',
        activator === 'row' && !locked && 'cursor-grab touch-none active:cursor-grabbing',
      )}
      {...(activator === 'row' && !locked ? { ...attributes, ...listeners } : {})}
    >
      {activator === 'handle' ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          disabled={locked}
          // Named, because "grip icon" is not a thing anyone can act on.
          aria-label={`Reorder item ${String(index + 1)}`}
          className={cn(
            'shrink-0 rounded-sm p-1 text-fg-subtle',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            locked ? 'cursor-not-allowed opacity-40' : 'cursor-grab touch-none hover:text-fg',
          )}
          {...(locked ? {} : { ...attributes, ...listeners })}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      ) : null}

      <div className="min-w-0 flex-1">{children}</div>

      {hideMoveButtons ? null : (
        <div className="flex shrink-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move item ${String(index + 1)} up`}
            disabled={index === 0 || locked}
            startIcon={<ChevronUp />}
            onClick={() => {
              onMove(index, index - 1);
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move item ${String(index + 1)} down`}
            disabled={index === total - 1 || locked}
            startIcon={<ChevronDown />}
            onClick={() => {
              onMove(index, index + 1);
            }}
          />
        </div>
      )}
    </li>
  );
}
