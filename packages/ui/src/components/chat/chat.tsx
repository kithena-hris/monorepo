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
import { Button } from '../button/button';
import { Textarea } from '../input/input';

/**
 * A conversation: a log of messages and the box to write the next one.
 *
 * Presentational — who is speaking and what they said are the caller's; this
 * knows nothing about an assistant, a model or a module.
 *
 * ### The log is a live region
 *
 * `role="log"` with `aria-live="polite"`: a screen reader announces each new
 * message as it arrives without interrupting, and does not re-read the ones
 * already there. It keeps itself scrolled to the newest message only while
 * the reader is already at the bottom — pulling them down while they are
 * reading something further up is the thing every chat gets wrong once.
 *
 * ### Enter sends
 *
 * As every chat does; Shift+Enter is a new line. Never while an input method
 * is composing (Japanese, Chinese, Korean): the Enter that picks a character
 * is not the Enter that sends.
 */

export interface ChatLogProps extends ComponentPropsWithoutRef<'div'> {
  /** Names the conversation for a screen reader: "Conversation with the assistant". */
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
      className={cn('flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ChatMessageProps extends ComponentPropsWithoutRef<'div'> {
  /** `self`: the person using the screen, on the right. `other`: whoever answers. */
  readonly from: 'self' | 'other';
  /** Who said it, for a screen reader: every message is announced with its speaker. */
  readonly author: string;
  /** Beside an `other` message: an avatar or a mark. */
  readonly avatar?: ReactNode;
  /** Still being written: three dots, and "writing" said aloud. */
  readonly pending?: boolean;
  /** Under the bubble: links, sources, actions. */
  readonly footer?: ReactNode;
}

export function ChatMessage({
  from,
  author,
  avatar,
  pending = false,
  footer,
  className,
  children,
  ...props
}: ChatMessageProps): JSX.Element {
  const self = from === 'self';
  return (
    <div
      className={cn('flex max-w-full gap-2.5 motion-safe:animate-fade-in', self && 'flex-row-reverse', className)}
      {...props}
    >
      {self || avatar === undefined ? null : <div className="shrink-0 pt-0.5">{avatar}</div>}
      <div className={cn('flex min-w-0 flex-col gap-1.5', self ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'max-w-[42ch] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-line',
            self
              ? 'rounded-br-xs bg-accent-solid text-fg-on-accent'
              : 'rounded-bl-xs border border-border bg-surface text-fg',
          )}
        >
          <span className="sr-only">{author}: </span>
          {pending ? <Writing /> : children}
        </div>
        {footer === undefined || pending ? null : footer}
      </div>
    </div>
  );
}

/** Three dots, one after another; still, and just the word, where motion is reduced. */
function Writing(): JSX.Element {
  return (
    <span className="inline-flex h-5 items-center gap-1" role="status">
      <span className="sr-only">Writing</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="size-1.5 rounded-full bg-fg-subtle motion-safe:animate-pulse"
          style={{ animationDelay: `${String(i * 160)}ms` }}
        />
      ))}
    </span>
  );
}

export interface ChatComposerProps {
  readonly label: string;
  readonly placeholder?: string;
  /** Sending is not allowed: a reply is still being written. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onSend: (text: string) => void;
  readonly className?: string;
  /** Hands the box back to the caller: focus it when the panel opens. */
  readonly inputRef?: Ref<HTMLTextAreaElement>;
}

export function ChatComposer({
  label,
  placeholder,
  busy = false,
  disabled = false,
  onSend,
  className,
  inputRef,
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const ready = text.trim() !== '' && !busy && !disabled;
  const send = (event?: { preventDefault: () => void }): void => {
    event?.preventDefault();
    if (!ready) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <form onSubmit={send} className={cn('flex items-end gap-2', className)}>
      <Textarea
        ref={inputRef}
        aria-label={label}
        autoResize
        rows={1}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={500}
        className="max-h-40 min-h-control-md"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <Button
        type="submit"
        variant="primary"
        aria-label="Send"
        startIcon={<ArrowUp aria-hidden />}
        disabled={!ready}
        loading={busy}
        loadingLabel="Waiting for the reply"
      />
    </form>
  );
}
