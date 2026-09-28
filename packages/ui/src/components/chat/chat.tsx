'use client';

import { ArrowUp } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { cn } from '../../lib/cn';
import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';

/**
 * A conversation: a log of messages and the box to write the next one. A
 * comment thread on a request, a message to a manager, a question to an
 * assistant.
 *
 * Presentational — who is speaking and what they said are the caller's; this
 * knows nothing about an assistant, a model or a module.
 *
 * ### The log is a live region
 *
 * `role="log"` with `aria-live="polite"`, the ARIA pattern for a thread: a
 * screen reader announces each new message as it arrives without
 * interrupting, and does not re-read the ones already there. It keeps itself
 * scrolled to the newest message only while the reader is already at the
 * bottom — pulling them down while they are reading something further up is
 * the thing every chat gets wrong once.
 *
 * The side a bubble sits on is decoration; who said it is in the text,
 * visually hidden, so a screen reader hears "Jonas Weber: Can you cover
 * Friday?" rather than a run of sentences with no speakers.
 *
 * ### Enter sends
 *
 * As every chat does; Shift+Enter is a new line. Never while an input method
 * is composing (Japanese, Chinese, Korean): the Enter that picks a character
 * is not the Enter that sends.
 */

export interface ChatLogProps extends ComponentPropsWithoutRef<'div'> {
  /** Names the conversation for a screen reader: "Conversation with Jonas Weber". */
  readonly label: string;
}

export function ChatLog({ label, className, children, ...props }: ChatLogProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el !== null && atEnd.current) el.scrollTop = el.scrollHeight;
  });
  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      aria-label={label}
      onScroll={(event) => {
        const el = event.currentTarget;
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
      className={cn('flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ChatMessageProps extends ComponentPropsWithoutRef<'div'> {
  /** `self`: the person using the screen, on the trailing side in the accent. `other`: whoever answers. */
  readonly from?: 'self' | 'other';
  /**
   * Who said it, for a screen reader: every message is announced with its
   * speaker. Also the initials of the avatar when there is no `avatar`. For
   * `from="self"` it defaults to "You".
   */
  readonly author?: string;
  /** Beside an `other` message: an avatar or a mark. Without one, the author's initials. */
  readonly avatar?: ReactNode;
  /** Photo for the default avatar. */
  readonly avatarSrc?: string;
  /**
   * Leave the avatar out but keep its space, for the second of two messages in
   * a row from the same person: the bubbles stay aligned, and the face is not
   * repeated down the thread.
   */
  readonly continued?: boolean;
  /** Still being written: three dots, and "Writing" said aloud. */
  readonly pending?: boolean;
  /**
   * Not delivered yet, or failed to send. Your own bubble drops to the accent
   * wash rather than fading, so the text keeps its contrast; say which in `meta`.
   */
  readonly unsent?: boolean;
  /** A line under the bubble: the time, "Edited", "Read", "Not sent · Tap to retry". */
  readonly meta?: ReactNode;
  /** Under the bubble: links, sources, actions. */
  readonly footer?: ReactNode;
}

export function ChatMessage({
  from = 'other',
  author,
  avatar,
  avatarSrc,
  continued = false,
  pending = false,
  unsent = false,
  meta,
  footer,
  className,
  children,
  ...props
}: ChatMessageProps): JSX.Element {
  const self = from === 'self';
  const speaker = author ?? (self ? 'You' : undefined);

  return (
    <div
      data-from={from}
      className={cn(
        'flex max-w-full items-end gap-2 motion-safe:animate-fade-in',
        self && 'flex-row-reverse',
        className,
      )}
      {...props}
    >
      {self ? null : continued || (avatar === undefined && author === undefined) ? (
        <span aria-hidden className="w-7 shrink-0" />
      ) : (
        <span aria-hidden className="flex w-7 shrink-0 justify-center">
          {avatar ?? (
            <Avatar
              name={author ?? ''}
              src={avatarSrc}
              size="sm"
              className="size-7 text-[0.625rem]"
            />
          )}
        </span>
      )}
      <div
        className={cn(
          'flex max-w-[78%] min-w-0 flex-col gap-1',
          self ? 'items-end' : 'items-start',
        )}
      >
        <div
          className={cn(
            'rounded-[1.25rem] px-3.5 py-2.5 text-[0.875rem] leading-snug text-pretty break-words whitespace-pre-line',
            'touch:text-[1rem]',
            // The tail: the corner nearest the speaker is tucked in.
            self ? 'rounded-ee-md' : 'rounded-es-md bg-surface-sunken text-fg',
            self &&
              (unsent ? 'bg-accent-subtle text-accent-fg' : 'bg-accent-solid text-fg-on-accent'),
          )}
        >
          {speaker ? <span className="sr-only">{speaker}: </span> : null}
          {pending ? <Writing /> : children}
        </div>
        {meta ? (
          <span className="px-1.5 text-[0.6875rem] leading-none text-fg-muted">{meta}</span>
        ) : null}
        {footer === undefined || pending ? null : footer}
      </div>
    </div>
  );
}

/** Three dots, one after another; still where motion is reduced. */
function Dots(): JSX.Element {
  return (
    <>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden
          className="size-1.5 rounded-full bg-fg-subtle motion-safe:animate-pulse"
          style={{ animationDelay: `${String(dot * 160)}ms` }}
        />
      ))}
    </>
  );
}

/** A reply still being written, inside its bubble, and "Writing" said aloud. */
function Writing(): JSX.Element {
  return (
    <span className="inline-flex h-5 items-center gap-1" role="status">
      <span className="sr-only">Writing</span>
      <Dots />
    </span>
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
        <Dots />
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
  readonly onSend: (text: string) => void;
  /** Names the text box. The placeholder is not a label. */
  readonly label?: string;
  readonly placeholder?: string;
  /** Names the send button. */
  readonly sendLabel?: string;
  /** Sending is not allowed: a reply is still being written. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** Leading controls beside the box, such as an attach button. */
  readonly tools?: ReactNode;
  /** Hands the box back to the caller: focus it when the panel opens. */
  readonly inputRef?: Ref<HTMLTextAreaElement>;
}

/** Where a reply is written. */
export function ChatComposer({
  className,
  onSend,
  label = 'Message',
  placeholder = 'Write a message…',
  sendLabel = 'Send',
  busy = false,
  disabled = false,
  tools,
  inputRef,
  ...props
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const ready = text.trim() !== '' && !busy && !disabled;

  const send = (): void => {
    if (!ready) return;
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
        ref={inputRef}
        rows={1}
        value={text}
        disabled={disabled}
        aria-label={label}
        placeholder={placeholder}
        maxLength={500}
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
        disabled={!ready}
        loading={busy}
        loadingLabel="Waiting for the reply"
        aria-label={sendLabel}
        startIcon={<ArrowUp aria-hidden />}
      />
    </form>
  );
}
