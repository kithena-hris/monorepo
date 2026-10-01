'use client';

import {
  ArrowUp,
  ChevronDown,
  CircleCheck,
  Maximize2,
  Minimize2,
  Sparkles,
  SquarePen,
  X,
} from 'lucide-react';
import {
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type SyntheticEvent,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { keysOf, useShortcutKeys } from '../../lib/shortcut-keys';
import { useClearOfPinned } from '../../lib/pinned';
import { icons } from '../../icons';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { KbdShortcut } from '../kbd/kbd';
import { Spinner } from '../spinner/spinner';
import { Tooltip, TooltipProvider } from '../tooltip/tooltip';

/**
 * An assistant that answers from the reader's policies and data, and acts once
 * they confirm.
 *
 * Presentational: the parts of the panel, with no model, no transport and no
 * opinion about which service answers. The product decides that, and names it;
 * this system calls it the Assistant.
 *
 * ### What the parts promise
 *
 * - **It cites.** An answer drawn from a document carries `AssistantSource`
 *   chips, so a reader can check it.
 * - **It asks before it acts.** Anything with a consequence is shown as a card
 *   with its own confirm button, and nothing is sent until that is pressed.
 * - **It says when it is unsure**, in words, rather than guessing.
 * - **Streaming never moves the reader.** New text grows the last message;
 *   the list is a polite live region with `aria-busy` while a reply is still
 *   arriving, so a screen reader reads it once, finished, not word by word.
 *
 * Placement is the product's call: docked beside the page for a long task,
 * floating at 400 × 560 for a quick question, or a full-screen sheet on a
 * phone.
 */

/** The assistant's avatar: a spark in the accent. */
export function AssistantMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-accent-solid text-fg-on-accent',
        size === 'sm' && 'size-7 [&_svg]:size-3.5',
        size === 'md' && 'size-7.5 [&_svg]:size-4',
        size === 'lg' && 'size-11 [&_svg]:size-5.5',
        className,
      )}
    >
      <Sparkles />
    </span>
  );
}

/**
 * A short heading the assistant speaks in, its spark before it, in the accent:
 * "Understood as" before the chips a sentence became. Inline, so it can lead a
 * `ChipRow` (as its `label`) or a line of text.
 */
export function AssistantLabel({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'span'>): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-accent-fg',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <icons.assistant aria-hidden />
      {children}
    </span>
  );
}

export interface AssistantCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** What the card holds, in a sentence: "Here's what I'd create". */
  title: ReactNode;
  /** The heading's level in the page outline. */
  level?: 2 | 3 | 4;
  /** At the end of the title row: a `Badge tone="assistant"`, or one button. */
  action?: ReactNode;
  /**
   * One line under the content on where it came from or what it will not do:
   * "Every number links to the records behind it."
   */
  note?: ReactNode;
}

/**
 * Whatever the assistant wrote, built or flagged, in one recognisable place:
 * the card's `assistant` edge, the assistant's mark, a title, the content and
 * an optional note on where it came from.
 *
 * The card shows work; it never finishes it. Anything with a consequence sits
 * inside as its own button, pressed by a person.
 */
export function AssistantCard({
  title,
  level = 3,
  action,
  note,
  className,
  children,
  ...props
}: AssistantCardProps): JSX.Element {
  const Heading = `h${String(level)}` as 'h2' | 'h3' | 'h4';
  return (
    <Card
      variant="assistant"
      padded
      className={cn('flex min-w-0 flex-col gap-3.5', className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <AssistantMark />
        <Heading className="min-w-0 flex-1 text-base leading-snug font-semibold text-fg">
          {title}
        </Heading>
        {action}
      </div>
      {children}
      {note ? (
        <p className="flex items-start gap-1.5 text-xs text-fg-subtle [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0">
          <icons.info aria-hidden />
          <span>{note}</span>
        </p>
      ) : null}
    </Card>
  );
}

export interface AssistantPanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: string;
  subtitle?: ReactNode;
  /** A status beside the title: "Beta". */
  badge?: ReactNode;
  onNewChat?: () => void;
  /** Toggles between floating and full size. Not offered under a finger, where it is always full. */
  onExpand?: () => void;
  expanded?: boolean;
  onClose?: () => void;
  /** Keeps the list pinned while a reply streams in. */
  busy?: boolean;
  /** The `AssistantComposer`. */
  composer?: ReactNode;
  children: ReactNode;
}

export function AssistantPanel({
  title = 'Assistant',
  subtitle,
  badge,
  onNewChat,
  onExpand,
  expanded = false,
  onClose,
  busy = false,
  composer,
  className,
  children,
  ...props
}: AssistantPanelProps): JSX.Element {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex min-h-0 w-full flex-col overflow-hidden rounded-lg bg-surface-raised text-fg shadow-xl',
        'touch:rounded-xl',
        className,
      )}
      {...props}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border py-3 ps-4 pe-2.5">
        <AssistantMark />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="flex items-center gap-1.5 text-base font-semibold">
            <span className="truncate">{title}</span>
            {badge ? (
              <Badge size="sm" tone="accent">
                {badge}
              </Badge>
            ) : null}
          </h2>
          {subtitle ? <p className="truncate text-xs text-fg-muted">{subtitle}</p> : null}
        </div>
        {onNewChat ? (
          <Button
            variant="ghost"
            size="sm"
            startIcon={<SquarePen aria-hidden />}
            aria-label="New conversation"
            onClick={onNewChat}
          />
        ) : null}
        {onExpand ? (
          <Button
            variant="ghost"
            size="sm"
            startIcon={expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            aria-label={expanded ? 'Make smaller' : 'Make larger'}
            onClick={onExpand}
            className="touch:hidden"
          />
        ) : null}
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            startIcon={
              <>
                <X aria-hidden className="touch:hidden" />
                <ChevronDown aria-hidden className="hidden touch:block" />
              </>
            }
            aria-label="Close assistant"
            onClick={onClose}
          />
        ) : null}
      </header>

      <div
        role="log"
        aria-live="polite"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4"
      >
        {children}
      </div>

      {composer}
    </section>
  );
}

export interface AssistantMessageProps extends ComponentPropsWithoutRef<'div'> {
  from: 'user' | 'assistant';
  /** Still arriving: draws the cursor after the text. */
  streaming?: boolean;
  /** Under an answer: copy, rate, retry. */
  actions?: ReactNode;
}

export function AssistantMessage({
  from,
  streaming = false,
  actions,
  className,
  children,
  ...props
}: AssistantMessageProps): JSX.Element {
  if (from === 'user') {
    return (
      <div className={cn('flex justify-end', className)} {...props}>
        <p className="sr-only">You said:</p>
        <div className="max-w-[78%] rounded-lg rounded-ee-xs bg-accent-solid px-3.5 py-2.5 text-base text-fg-on-accent">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex items-start gap-2.5', className)} {...props}>
      <AssistantMark size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5 text-base text-pretty text-fg [&_b]:font-semibold [&_strong]:font-semibold">
        <p className="sr-only">Assistant said:</p>
        <div className="flex flex-col gap-2.5">
          {children}
          {streaming ? (
            <span
              aria-hidden
              className="-mt-2.5 inline-block h-4 w-2 rounded-[2px] bg-accent-solid motion-safe:animate-pulse"
            />
          ) : null}
        </div>
        {actions ? <div className="-ms-1.5 flex gap-0.5 text-fg-subtle">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Citation chips under an answer. */
export function AssistantSources({
  className,
  ...props
}: ComponentPropsWithoutRef<'ul'>): JSX.Element {
  return <ul aria-label="Sources" className={cn('flex flex-wrap gap-1.5', className)} {...props} />;
}

export interface AssistantSourceProps extends ComponentPropsWithoutRef<'a'> {
  /** The footnote number the answer refers to. */
  index: number;
}

export function AssistantSource({
  index,
  className,
  children,
  ...props
}: AssistantSourceProps): JSX.Element {
  return (
    <li>
      <a
        className={cn(
          'tap-target relative inline-flex h-6.5 items-center gap-1.5 rounded-control bg-surface-sunken ps-1 pe-2.5',
          'text-xs font-medium whitespace-nowrap text-fg-muted',
          'transition-colors duration-(--animate-duration-fast) hover:bg-surface-active hover:text-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          className,
        )}
        {...props}
      >
        <span className="grid size-4.5 place-items-center rounded-full bg-surface text-2xs font-bold text-fg">
          {index}
        </span>
        {children}
      </a>
    </li>
  );
}

/** What the assistant is doing, a line per step. */
export function AssistantSteps({
  className,
  ...props
}: ComponentPropsWithoutRef<'ol'>): JSX.Element {
  return <ol className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function AssistantStep({
  status,
  children,
}: {
  status: 'done' | 'running';
  children: ReactNode;
}): JSX.Element {
  return (
    <li
      className={cn(
        'flex items-center gap-2 text-sm font-medium',
        status === 'running' ? 'text-fg' : 'text-fg-muted',
      )}
    >
      {status === 'running' ? (
        <Spinner size="xs" label="In progress" />
      ) : (
        <>
          <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
          <span className="sr-only">Done:</span>
        </>
      )}
      {children}
    </li>
  );
}

/** Starter questions for an empty conversation. */
export function AssistantSuggestions({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('grid grid-cols-2 gap-2 touch:grid-cols-1', className)} {...props} />;
}

export interface AssistantSuggestionProps extends ComponentPropsWithoutRef<'button'> {
  icon?: ReactNode;
}

export function AssistantSuggestion({
  icon,
  className,
  children,
  ...props
}: AssistantSuggestionProps): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-tap items-center gap-2.5 rounded-md bg-surface-sunken px-3.5 py-3 text-start',
        'text-sm font-medium text-fg',
        'transition-colors duration-(--animate-duration-fast) hover:bg-surface-active',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-accent-fg',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export interface AssistantComposerProps extends Omit<
  ComponentPropsWithoutRef<'form'>,
  'onSubmit' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** A reply is streaming: Send becomes Stop. */
  streaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  /** Left of the send button: attach, dictate. */
  tools?: ReactNode;
  /** Under the field. `null` to leave it out. */
  disclaimer?: ReactNode;
}

export function AssistantComposer({
  value,
  onValueChange,
  onSubmit,
  streaming = false,
  onStop,
  placeholder = 'Ask a question…',
  tools,
  disclaimer = 'Answers can be wrong. Check anything important.',
  className,
  ...props
}: AssistantComposerProps): JSX.Element {
  const submit = (event?: SyntheticEvent): void => {
    event?.preventDefault();
    if (streaming || value.trim() === '') return;
    onSubmit(value);
  };
  return (
    <form onSubmit={submit} className={cn('shrink-0 px-3 pt-2.5 pb-3', className)} {...props}>
      <div
        className={cn(
          // The whole box is the field a finger aims at, as with `Input`; the
          // transparent border is what marks it as that shell.
          'flex flex-col gap-1.5 rounded-lg border border-transparent bg-surface-sunken py-2.5 ps-4 pe-2.5 touch:rounded-xl',
          'transition-[background-color,box-shadow] duration-(--animate-duration-fast)',
          'focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent',
        )}
      >
        <textarea
          aria-label="Message"
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onValueChange(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a new line, and an IME composing a
            // character is left alone.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="field-sizing-content max-h-40 min-h-5 resize-none bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex items-center gap-0.5">
          {tools}
          <span className="flex-1" />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className={cn(
                'tap-target relative grid size-8 place-items-center rounded-full bg-invert text-fg-on-invert',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              )}
            >
              <span aria-hidden className="size-2.5 rounded-[2px] bg-current" />
            </button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              startIcon={<ArrowUp aria-hidden />}
              aria-label="Send"
              disabled={value.trim() === ''}
              className="rounded-control"
            />
          )}
        </div>
      </div>
      {disclaimer ? <p className="mt-2 text-center text-2xs text-fg-subtle">{disclaimer}</p> : null}
    </form>
  );
}

export interface AssistantLauncherProps extends ComponentPropsWithoutRef<'div'> {
  onOpen: () => void;
  /** A one-line greeting beside the button. Show it once per session, at most. */
  nudge?: ReactNode;
  onDismissNudge?: () => void;
  label?: string;
  /** The id of the shortcut that opens it (`setShortcutKeys`): shown in its tooltip. */
  shortcut?: string;
}

/**
 * The floating button that opens the panel, with an optional greeting. It
 * rises above any pinned bar under it (`PINNED_BAR`), so it never covers a
 * Save or an Approve.
 */
export function AssistantLauncher({
  onOpen,
  nudge,
  onDismissNudge,
  label = 'Open assistant',
  shortcut,
  className,
  style,
  ...props
}: AssistantLauncherProps): JSX.Element {
  const keys = keysOf(shortcut, useShortcutKeys());
  const root = useRef<HTMLDivElement>(null);
  const lift = useClearOfPinned(root);
  const launcher = (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className={cn(
        'grid size-14 place-items-center rounded-full bg-accent-solid text-fg-on-accent shadow-lg',
        'transition-[background-color,transform] duration-(--animate-duration-fast) ease-standard',
        'hover:bg-accent-hover active:scale-95 motion-reduce:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
      )}
    >
      <Sparkles aria-hidden className="size-6" />
    </button>
  );
  return (
    <div
      ref={root}
      className={cn(
        'flex flex-col items-end gap-2.5',
        'transition-transform duration-(--animate-duration-normal) ease-standard motion-reduce:transition-none',
        className,
      )}
      style={lift === 0 ? style : { ...style, transform: `translateY(${String(-lift)}px)` }}
      {...props}
    >
      {nudge ? (
        <div className="flex max-w-60 items-start gap-2.5 rounded-lg rounded-ee-xs bg-surface-raised py-3 ps-3.5 pe-2.5 text-sm text-fg shadow-lg">
          <p className="flex-1">{nudge}</p>
          {onDismissNudge ? (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={onDismissNudge}
              className={cn(
                'tap-target relative grid size-5 shrink-0 place-items-center rounded-xs text-fg-subtle hover:text-fg',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              )}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {keys.length === 0 ? (
        launcher
      ) : (
        <TooltipProvider>
          <Tooltip content={label} shortcut={<KbdShortcut keys={keys} />} side="left">
            {launcher}
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
