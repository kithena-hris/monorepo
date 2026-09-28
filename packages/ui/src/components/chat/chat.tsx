'use client';

import { ArrowUp } from 'lucide-react';
import {
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';

/**
 * A conversation between people: a comment thread on a request, a message to
 * a manager, a note from the People team.
 *
 * The thread is `role="log"`, which is the ARIA pattern for exactly this —
 * new entries are appended and read out politely as they arrive, and nothing
 * already read is announced again. The side a bubble sits on is decoration;
 * who said it is in the text, visually hidden where the avatar stands in for
 * it, so a screen reader hears "Jonas Weber: Can you cover Friday?" rather
 * than a run of sentences with no speakers.
 */
export interface ChatProps extends ComponentPropsWithoutRef<'div'> {
  /** Names the log, "Conversation with Jonas Weber". */
  'aria-label'?: string;
}

export function Chat({ className, ...props }: ChatProps): JSX.Element {
  return (
    <div
      role="log"
      aria-live="polite"
      className={cn('flex flex-col gap-2.5', className)}
      {...props}
    />
  );
}

export interface ChatMessageProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** `me` sits on the trailing side in the accent, everyone else on the leading side. */
  from?: 'me' | 'them';
  /**
   * Who said it. Drives the avatar and the visually hidden speaker label. For
   * `from="me"` it defaults to "You".
   */
  author?: string;
  /** Photo for the avatar. Initials from `author` are used without one. */
  avatarSrc?: string;
  /**
   * Leave the avatar out but keep its space, for the second of two messages in
   * a row from the same person: the bubbles stay aligned, and the face is not
   * repeated down the thread.
   */
  continued?: boolean;
  /** A line under the bubble: the time, "Edited", "Read", "Not sent · Tap to retry". */
  meta?: ReactNode;
  /**
   * Not delivered yet, or failed to send. Your own bubble drops to the accent
   * wash rather than fading, so the text keeps its contrast; say which in `meta`.
   */
  pending?: boolean;
  children: ReactNode;
}

export function ChatMessage({
  className,
  from = 'them',
  author,
  avatarSrc,
  continued = false,
  meta,
  pending = false,
  children,
  ...props
}: ChatMessageProps): JSX.Element {
  const mine = from === 'me';
  const speaker = author ?? (mine ? 'You' : undefined);

  return (
    <div
      data-from={from}
      className={cn('flex items-end gap-2', mine && 'flex-row-reverse', className)}
      {...props}
    >
      {mine ? null : continued || author === undefined ? (
        <span aria-hidden className="w-7 shrink-0" />
      ) : (
        <Avatar
          name={author}
          src={avatarSrc}
          size="sm"
          aria-hidden
          className="size-7 text-[0.625rem]"
        />
      )}
      <div
        className={cn(
          'flex max-w-[78%] min-w-0 flex-col gap-1',
          mine ? 'items-end' : 'items-start',
        )}
      >
        <div
          className={cn(
            'rounded-[1.25rem] px-3.5 py-2.5 text-[0.875rem] leading-snug text-pretty break-words',
            'touch:text-[1rem]',
            // The tail: the corner nearest the speaker is tucked in.
            mine ? 'rounded-ee-md' : 'rounded-es-md bg-surface-sunken text-fg',
            mine &&
              (pending ? 'bg-accent-subtle text-accent-fg' : 'bg-accent-solid text-fg-on-accent'),
          )}
        >
          {speaker ? <span className="sr-only">{speaker}: </span> : null}
          {children}
        </div>
        {meta ? (
          <span className="px-1.5 text-[0.6875rem] leading-none text-fg-muted">{meta}</span>
        ) : null}
      </div>
    </div>
  );
}

export interface ChatTypingProps extends ComponentPropsWithoutRef<'div'> {
  /** Who is typing. Announced, and shown as the avatar. */
  author: string;
  avatarSrc?: string;
  /** What a screen reader hears. */
  label?: string;
}

/** Three dots in a bubble while the other person writes. */
export function ChatTyping({
  className,
  author,
  avatarSrc,
  label,
  ...props
}: ChatTypingProps): JSX.Element {
  return (
    <div className={cn('flex items-end gap-2', className)} {...props}>
      <Avatar
        name={author}
        src={avatarSrc}
        size="sm"
        aria-hidden
        className="size-7 text-[0.625rem]"
      />
      <div className="flex h-10 items-center gap-1 rounded-[1.25rem] rounded-es-md bg-surface-sunken px-4">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden
            className="size-1.5 rounded-full bg-fg-subtle motion-safe:animate-pulse"
            style={{ animationDelay: `${String(dot * 160)}ms` }}
          />
        ))}
        <span className="sr-only">{label ?? `${author} is typing`}</span>
      </div>
    </div>
  );
}

/** A day or a gap in the thread: "Today", "Monday 14 October". */
export function ChatDivider({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn('py-1 text-center text-xs font-semibold text-fg-muted', className)}
      {...props}
    />
  );
}

export interface ChatComposerProps extends Omit<
  ComponentPropsWithoutRef<'form'>,
  'onSubmit' | 'children'
> {
  /** Called with the trimmed text. The composer clears itself afterwards. */
  onSend: (text: string) => void;
  /** Names the text box. The placeholder is not a label. */
  label?: string;
  placeholder?: string;
  sendLabel?: string;
  disabled?: boolean;
  /** Leading controls beside the box, such as an attach button. */
  tools?: ReactNode;
}

/**
 * Where a reply is written.
 *
 * Enter sends and Shift+Enter starts a new line, the convention of every
 * messenger. An Enter that ends an input-method composition — picking a kanji,
 * accepting a suggestion — is part of typing, not a send, so it is ignored.
 */
export function ChatComposer({
  className,
  onSend,
  label = 'Message',
  placeholder = 'Write a message…',
  sendLabel = 'Send',
  disabled = false,
  tools,
  ...props
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const empty = text.trim() === '';

  const send = (): void => {
    if (empty || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <form
      className={cn('flex items-end gap-2', className)}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      {...props}
    >
      {tools ? <div className="flex shrink-0 items-center self-center">{tools}</div> : null}
      <textarea
        rows={1}
        value={text}
        disabled={disabled}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
        // A pill that grows with its content, up to a few lines, then scrolls.
        className={cn(
          'field-sizing-content max-h-40 min-h-10 min-w-0 flex-1 resize-none rounded-[1.375rem]',
          'bg-surface-sunken px-3.5 py-2.5 touch:min-h-11',
          'text-[0.875rem] leading-snug text-fg placeholder:text-fg-subtle touch:text-[1rem]',
          'transition-[background-color,box-shadow] duration-(--animate-duration-fast)',
          'outline-none focus:bg-surface focus:shadow-[inset_0_0_0_2px_var(--reach-color-accent)]',
          'disabled:text-fg-disabled',
        )}
      />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        className="mb-1"
        disabled={empty || disabled}
        aria-label={sendLabel}
        startIcon={<ArrowUp aria-hidden />}
      />
    </form>
  );
}
