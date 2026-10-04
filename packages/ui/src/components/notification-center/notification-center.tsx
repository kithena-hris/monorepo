'use client';

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { Flag } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../sheet/sheet';

/**
 * Everything that needs the reader's attention, in one list.
 *
 * Unread items are tinted and carry a dot, and "Unread" in words for a screen
 * reader, because a tint is not a state anyone can hear. An item the reader
 * can act on has its buttons inline: approving a leave request should not
 * cost a trip to another page.
 *
 * `NotificationPanel` is the list with its heading and renders anywhere.
 * `NotificationCenter` opens it from a trigger (the bell): anchored in a
 * popover at a desk, and as a full-screen sheet under a finger, where a
 * popover the width of a thumb is unreadable.
 */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-fg-muted',
  accent: 'bg-accent-subtle text-accent-fg',
  success: 'bg-success-subtle text-success-fg',
  warning: 'bg-warning-subtle text-warning-fg',
  danger: 'bg-danger-subtle text-danger-fg',
  info: 'bg-info-subtle text-info-fg',
};

function PanelHeader({ title, action }: { title: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3',
        'touch:border-0 touch:px-1 touch:pt-0 touch:pb-2.5',
      )}
    >
      {title}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const titleClass = 'font-display text-md font-bold text-fg touch:text-xl';

export interface NotificationPanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: string;
  /** Beside the title: "Mark all read". */
  action?: ReactNode;
  children: ReactNode;
}

export function NotificationPanel({
  title = 'Notifications',
  action,
  className,
  children,
  ...props
}: NotificationPanelProps): JSX.Element {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex w-full max-w-95 min-w-0 flex-col overflow-hidden rounded-lg bg-surface-raised shadow-lg',
        'touch:max-w-none touch:overflow-visible touch:rounded-none touch:bg-transparent touch:shadow-none',
        className,
      )}
      {...props}
    >
      <PanelHeader
        title={
          <h2 id={headingId} className={titleClass}>
            {title}
          </h2>
        }
        action={action}
      />
      <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain touch:gap-2">
        {children}
      </div>
    </section>
  );
}

export interface NotificationGroupProps extends ComponentPropsWithoutRef<'div'> {
  /** "Today", "Earlier". Leave out for a single ungrouped list. */
  label?: string;
  children: ReactNode;
}

export function NotificationGroup({
  label,
  className,
  children,
  ...props
}: NotificationGroupProps): JSX.Element {
  const labelId = useId();
  return (
    <div className={cn('min-w-0', className)} {...props}>
      {label ? (
        <h3
          id={labelId}
          className="px-4 pt-3 pb-1.5 text-xs font-semibold text-fg-subtle touch:px-1 touch:pt-3.5"
        >
          {label}
        </h3>
      ) : null}
      <ul
        aria-labelledby={label ? labelId : undefined}
        className="min-w-0 touch:overflow-hidden touch:rounded-xl touch:bg-surface touch:shadow-sm"
      >
        {children}
      </ul>
    </div>
  );
}

export interface NotificationItemProps extends Omit<ComponentPropsWithoutRef<'li'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** When it happened, already formatted: "12m", "Yesterday". */
  time: ReactNode;
  unread?: boolean;
  /** A person's `Avatar`, drawn as given. */
  avatar?: ReactNode;
  /** Or a glyph, drawn in a circle of `tone`. */
  icon?: ReactNode;
  tone?: Tone;
  /** Makes the whole item a link to what it is about. */
  href?: string;
  /** Buttons that act on the item without opening it: Decline, Approve. */
  actions?: ReactNode;
  /**
   * A line under the description that asks for a second look, in the warning
   * tone with a flag: why it stands out. Words, not only the colour.
   */
  note?: ReactNode;
}

export function NotificationItem({
  title,
  description,
  time,
  unread = false,
  avatar,
  icon,
  tone = 'neutral',
  href,
  actions,
  note,
  className,
  ...props
}: NotificationItemProps): JSX.Element {
  return (
    <li
      className={cn(
        'relative flex min-h-16.5 gap-3 border-b border-border px-4.5 py-3 last:border-b-0',
        'touch:px-4',
        unread && 'bg-accent-subtle/55',
        actions ? 'items-start' : 'items-center',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="flex shrink-0">
        {avatar ?? (
          <span
            className={cn(
              'grid size-10 place-items-center rounded-full [&_svg]:size-4.5',
              toneClass[tone],
            )}
          >
            {icon}
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn('min-w-0 text-sm text-fg', unread ? 'font-semibold' : 'font-medium')}>
          {href ? (
            // Stretched over the item, so the whole row is the target; the
            // actions sit above it.
            <a
              href={href}
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-border-focus"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </p>
        {description ? <p className="truncate text-xs text-fg-muted">{description}</p> : null}
        {note ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-warning-fg [&_svg]:size-3 [&_svg]:shrink-0">
            <Flag aria-hidden />
            <span className="truncate">{note}</span>
          </p>
        ) : null}
        {actions ? (
          <div className="relative z-10 mt-1.5 flex flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-2 self-start pt-0.5">
        <span className="text-xs text-fg-subtle">{time}</span>
        {unread ? (
          <span className="size-2 rounded-full bg-accent-solid">
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </span>
    </li>
  );
}

export interface NotificationCenterProps {
  /** The bell. Rendered as the trigger, so it must be one focusable element. */
  trigger: ReactElement;
  title?: string;
  action?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Whether the trigger sits under a finger. Asked of the pointer, not the
 * window: a subtree can declare itself coarse (`data-pointer`), as the docs'
 * phone frame does, and a narrow desk window is still a mouse.
 */
function useCoarseAt(): [ref: RefObject<HTMLSpanElement | null>, coarse: boolean] {
  const ref = useRef<HTMLSpanElement>(null);
  const [coarse, setCoarse] = useState(false);
  useLayoutEffect(() => {
    setCoarse(
      ref.current?.closest('[data-pointer="coarse"]') != null ||
        window.matchMedia('(pointer: coarse)').matches,
    );
  }, []);
  return [ref, coarse];
}

export function NotificationCenter({
  trigger,
  title = 'Notifications',
  action,
  children,
  // open, defaultOpen, onOpenChange: the same meaning for either surface.
  ...root
}: NotificationCenterProps): JSX.Element {
  const [ref, coarse] = useCoarseAt();

  return (
    // `display: contents`: a box for asking where the trigger is, not for layout.
    <span ref={ref} className="contents">
      {coarse ? (
        <Sheet {...root}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" size="full" className="bg-canvas">
            <div className="px-4 pt-4 pe-14">
              <PanelHeader
                title={<SheetTitle className={titleClass}>{title}</SheetTitle>}
                action={action}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 pb-4">
              {children}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover {...root}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="end" className="w-95 p-0">
            <NotificationPanel
              title={title}
              action={action}
              className="max-w-none rounded-none bg-transparent shadow-none"
            >
              {children}
            </NotificationPanel>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
