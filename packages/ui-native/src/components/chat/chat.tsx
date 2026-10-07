import { ArrowUp, Minus, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Pressable, Text as CssText, TextInput, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePulse } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';

/**
 * Direct messages about a request or a person, as the web's: your messages on
 * the trailing side in the accent, theirs on the leading side in grey with a
 * 28pt face, 20pt bubbles with the corner nearest the speaker squared off,
 * the text 16, and a small line under a bubble for the time or the state.
 */

const WEB = Platform.OS === 'web';

export type ChatWindowProps = {
  children: ReactNode;
  /** A `ChatHeader`, for a conversation in its own window. */
  header?: ReactNode;
  /** A `ChatComposer` at the foot. */
  composer?: ReactNode;
  className?: string | undefined;
};

/** The conversation's card: a header, the log, the composer. */
export function ChatWindow({
  children,
  header,
  composer,
  className,
}: ChatWindowProps): React.JSX.Element {
  return (
    <View className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className)}>
      {header}
      <View className="p-3.5">{children}</View>
      {composer}
    </View>
  );
}

export type ChatHeaderProps = {
  name: string;
  /** "Online", "Away": shown under the name, in green when online. */
  status?: string;
  online?: boolean;
  onMinimise?: () => void;
  onClose?: () => void;
};

export function ChatHeader({
  name,
  status,
  online = false,
  onMinimise,
  onClose,
}: ChatHeaderProps): React.JSX.Element {
  return (
    <View className="flex-row items-center gap-2.5 border-b border-border px-3.5 py-3">
      <Avatar
        name={name}
        size={32}
        decorative
        {...(online ? { status: 'success' as const } : {})}
      />
      <View className="flex-1">
        <CssText className="text-[14px] font-semibold leading-[1.2] text-fg">{name}</CssText>
        {status ? (
          <CssText
            className={cn(
              'text-[12px] leading-[1.2]',
              online ? 'text-success-fg' : 'text-fg-muted',
            )}
          >
            {status}
          </CssText>
        ) : null}
      </View>
      {onMinimise ? (
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel="Minimise"
          startIcon={<Icon icon={Minus} />}
          onPress={onMinimise}
        />
      ) : null}
      {onClose ? (
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel="Close"
          startIcon={<Icon icon={X} />}
          onPress={onClose}
        />
      ) : null}
    </View>
  );
}

export type ChatLogProps = {
  children: ReactNode;
  /** Names the conversation for a screen reader: "Conversation with Jonas Weber". */
  accessibilityLabel: string;
  className?: string | undefined;
};

/** The messages, oldest first. A live log: a new message is read as it arrives. */
export function ChatLog({
  children,
  accessibilityLabel,
  className,
}: ChatLogProps): React.JSX.Element {
  return (
    <View
      {...(WEB ? { role: 'log' as const, 'aria-live': 'polite' as const } : {})}
      aria-label={accessibilityLabel}
      className={cn('gap-2.5', className)}
    >
      {children}
    </View>
  );
}

export type ChatMessageProps = {
  children: string;
  /** `self`: the person using the screen, trailing, in the accent. `other`: whoever answers. */
  from?: 'self' | 'other';
  /** Who said it. Every message is read with its speaker; "You" for your own. */
  author?: string;
  /** Leave the face out but keep its space, for the next message from the same person. */
  continued?: boolean;
  /**
   * Not delivered. Your bubble drops to the accent wash rather than fading, so
   * its text keeps its contrast; say why in `meta`.
   */
  unsent?: boolean;
  /** Makes a failed message the button that sends it again. */
  onRetry?: () => void;
  /** Under the bubble: the time, "Read", "Not sent · Tap to retry". */
  meta?: string;
  /** Under the bubble and its meta: links, sources, actions. */
  footer?: ReactNode;
  /** A photo for the speaker's face, instead of initials. */
  avatarSrc?: string;
  className?: string | undefined;
};

export function ChatMessage({
  children,
  from = 'other',
  author,
  continued = false,
  unsent = false,
  onRetry,
  meta,
  footer,
  avatarSrc,
  className,
}: ChatMessageProps): React.JSX.Element {
  const self = from === 'self';
  const speaker = author ?? (self ? 'You' : 'Them');
  const bubble = (
    <View
      className={cn(
        'rounded-[20px] px-3.5 py-2.5',
        self ? 'rounded-br-md' : 'rounded-bl-md',
        self ? (unsent ? 'bg-accent-subtle' : 'bg-accent-solid') : 'bg-surface-sunken',
      )}
    >
      <CssText
        className={cn(
          'text-[16px] leading-[1.45]',
          self ? (unsent ? 'text-accent-fg' : 'text-fg-on-accent') : 'text-fg',
        )}
      >
        {children}
      </CssText>
    </View>
  );
  return (
    <View
      // One message, one stop for VoiceOver and TalkBack, read with its speaker.
      // The web reads the bubble's text in the log as it is.
      {...(WEB
        ? {}
        : {
            accessible: !onRetry,
            accessibilityLabel: `${speaker}: ${children}${meta ? `. ${meta}` : ''}`,
          })}
      className={cn('flex-row items-end gap-2', self && 'flex-row-reverse', className)}
    >
      {self ? null : continued ? (
        <View className="w-7" />
      ) : (
        <Avatar name={speaker} size={28} decorative {...(avatarSrc ? { src: avatarSrc } : {})} />
      )}
      <View className={cn('max-w-[78%] gap-1', self ? 'items-end' : 'items-start')}>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send again: ${children}`}
            onPress={onRetry}
          >
            {bubble}
          </Pressable>
        ) : (
          bubble
        )}
        {meta ? (
          <CssText className="px-1.5 text-[11px] leading-none text-fg-subtle">{meta}</CssText>
        ) : null}
        {footer}
      </View>
    </View>
  );
}

function Dot({ index }: { index: number }): React.JSX.Element {
  const style = usePulse(true, index * 200);
  return (
    <Animated.View style={style}>
      <View className="size-1.5 rounded-full bg-fg-subtle" />
    </Animated.View>
  );
}

/** The other person is writing: three dots breathing in turn, and "Writing" said aloud. */
export function ChatTyping({
  author,
  label,
}: {
  author: string;
  label?: string;
}): React.JSX.Element {
  return (
    <View
      {...(WEB
        ? { role: 'status' as const, 'aria-label': label ?? `${author} is writing` }
        : { accessible: true, accessibilityLabel: label ?? `${author} is writing` })}
      className="flex-row items-end gap-2"
    >
      <Avatar name={author} size={28} decorative />
      <View className="flex-row gap-1 rounded-[20px] rounded-bl-md bg-surface-sunken px-3.5 py-3">
        <Dot index={0} />
        <Dot index={1} />
        <Dot index={2} />
      </View>
    </View>
  );
}

/** A day or a gap in the thread: "Today", "Monday 14 October". */
export function ChatDivider({
  children,
  className,
}: {
  children: string;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <CssText className={cn('py-1 text-center text-[12px] font-semibold text-fg-muted', className)}>
      {children}
    </CssText>
  );
}

export type ChatComposerProps = {
  /** Called with the trimmed text; the composer then clears itself. */
  onSend: (text: string) => void;
  /** Names the box. The placeholder is not a label. */
  accessibilityLabel?: string;
  placeholder?: string;
  sendLabel?: string;
  defaultValue?: string;
  /** A reply is still being written: sending waits. */
  busy?: boolean;
  disabled?: boolean;
  /** Leading controls beside the box, such as an attach button. */
  tools?: ReactNode;
};

/** Where a reply is written: a pill that grows with the text, and Send beside it. */
export function ChatComposer({
  onSend,
  accessibilityLabel = 'Message',
  placeholder = 'Message',
  sendLabel = 'Send',
  defaultValue = '',
  busy = false,
  disabled = false,
  tools,
}: ChatComposerProps): React.JSX.Element {
  const [text, setText] = useState(defaultValue);
  const ready = text.trim().length > 0 && !busy && !disabled;
  const send = (): void => {
    if (!ready) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <View className="flex-row items-end gap-2 border-t border-border p-2.5">
      {tools ? <View className="shrink-0 flex-row items-center self-center">{tools}</View> : null}
      <TextInput
        multiline
        // One row to start on the web, where a text area otherwise opens at two;
        // on a device the box already starts at one line and grows.
        {...(WEB ? { numberOfLines: 1 } : {})}
        value={text}
        onChangeText={setText}
        editable={!disabled}
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        className="min-h-11 flex-1 rounded-[22px] bg-surface-sunken px-3.5 py-2.5 text-[16px] leading-[1.4] text-fg caret-accent outline-none placeholder:text-fg-subtle"
      />
      <Button
        variant="primary"
        size="sm"
        accessibilityLabel={sendLabel}
        startIcon={<Icon icon={ArrowUp} />}
        disabled={!ready}
        loading={busy}
        loadingLabel="Waiting for the reply"
        onPress={send}
      />
    </View>
  );
}
