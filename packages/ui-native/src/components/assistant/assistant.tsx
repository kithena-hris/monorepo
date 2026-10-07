import {
  ArrowUp,
  ChevronDown,
  CircleCheck,
  Copy,
  Mic,
  Paperclip,
  RotateCw,
  Sparkles,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react-native';
import { Children, type ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import {
  Pressable,
  ScrollView,
  Text as CssText,
  TextInput,
  View,
} from 'react-native-css/components';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePulse } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { usePresence } from '../../lib/overlay.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { ChatMessage } from '../chat/chat.tsx';
import { BackGuard } from '../dialog/dialog.tsx';
import { FloatingButton } from '../floating-button/floating-button.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { Spinner } from '../spinner/spinner.tsx';

/**
 * An assistant that answers from policies and data and acts only once a
 * person confirms, as the web's assistant parts on a phone. It cites its
 * sources and says when it is unsure; anything with a consequence is a card
 * with its own button, pressed by a person.
 *
 * On a phone it opens as a compact card floating above the tab bar, over the
 * page and never instead of it: no scrim, never full screen, so the screen
 * someone asked about stays in view.
 */

const WEB = Platform.OS === 'web';

/** The assistant's mark: sparkles in the accent disc. */
export function AssistantMark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <View
      aria-hidden
      className="items-center justify-center rounded-full bg-accent-solid"
      style={{ width: size, height: size }}
    >
      <Icon icon={Sparkles} size={Math.round(size * 0.52)} tone="on-accent" />
    </View>
  );
}

export type AssistantPanelProps = {
  title?: string;
  subtitle?: string;
  /** Beside the title: "Beta". */
  badge?: string;
  onNewChat?: () => void;
  /** Folds the card back into its launcher, keeping the conversation. */
  onMinimize?: () => void;
  /** Ends the conversation. */
  onClose?: () => void;
  /** The `AssistantComposer`. */
  composer?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
};

/** The assistant's card: a header, the conversation, the composer. */
export function AssistantPanel({
  title = 'Assistant',
  subtitle,
  badge,
  onNewChat,
  onMinimize,
  onClose,
  composer,
  children,
  className,
}: AssistantPanelProps): React.JSX.Element {
  return (
    <View
      role="region"
      aria-label={title}
      className={cn('overflow-hidden rounded-[28px] bg-surface-raised shadow-xl', className)}
    >
      <View className="flex-row items-center gap-2.5 border-b border-border py-3 pl-4 pr-2.5">
        <AssistantMark size={30} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-1.5">
            <CssText role="heading" className="text-[15px] font-semibold leading-[1.2] text-fg">
              {title}
            </CssText>
            {badge ? (
              <Badge size="sm" tone="accent">
                {badge}
              </Badge>
            ) : null}
          </View>
          {subtitle ? (
            <CssText className="text-[12px] leading-[1.3] text-fg-muted">{subtitle}</CssText>
          ) : null}
        </View>
        {onNewChat ? (
          <Button
            variant="ghost"
            size="xs"
            accessibilityLabel="New conversation"
            startIcon={<Icon icon={SquarePen} />}
            onPress={onNewChat}
          />
        ) : null}
        {onMinimize ? (
          <Button
            variant="ghost"
            size="xs"
            accessibilityLabel="Minimise"
            startIcon={<Icon icon={ChevronDown} />}
            onPress={onMinimize}
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
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        {children}
      </ScrollView>
      {composer}
    </View>
  );
}

function Cursor(): React.JSX.Element {
  const style = usePulse(true);
  return (
    <Animated.View style={style}>
      <View className="h-4 w-2 rounded-[2px] bg-accent" />
    </Animated.View>
  );
}

export type AssistantMessageProps = {
  from: 'user' | 'assistant';
  /** Text, or text with sources, steps or a card under it. */
  children: ReactNode;
  /** Still arriving: the cursor after the text, and the space it needs kept. */
  streaming?: boolean;
  /** Under an answer: `AssistantFeedback`. */
  actions?: ReactNode;
};

/** One turn: the person's question in their bubble, or the assistant's answer beside its mark. */
export function AssistantMessage({
  from,
  children,
  streaming = false,
  actions,
}: AssistantMessageProps): React.JSX.Element {
  if (from === 'user') {
    return (
      <ChatMessage from="self" author="You">
        {Children.toArray(children)
          .filter(
            (part): part is string | number => typeof part === 'string' || typeof part === 'number',
          )
          .join('')}
      </ChatMessage>
    );
  }
  return (
    <View
      {...(WEB ? { 'aria-live': streaming ? ('polite' as const) : ('off' as const) } : {})}
      className="flex-row items-start gap-2.5"
    >
      <AssistantMark />
      <View className="min-w-0 flex-1 gap-2.5 pt-[3px]">
        {Children.map(children, (child) =>
          typeof child === 'string' ? (
            <CssText className="text-[16px] leading-[1.55] text-fg">{child}</CssText>
          ) : (
            child
          ),
        )}
        {streaming ? <Cursor /> : null}
        {actions}
      </View>
    </View>
  );
}

/** A run of answer text with emphasis in it: `<AssistantText>You have <Strong>14.5 days</Strong> left</AssistantText>`. */
export function AssistantText({ children }: { children: ReactNode }): React.JSX.Element {
  return <CssText className="text-[16px] leading-[1.55] text-fg">{children}</CssText>;
}

export function Strong({ children }: { children: ReactNode }): React.JSX.Element {
  return <CssText className="font-bold">{children}</CssText>;
}

/** Copy, rate up, rate down, try again, under an answer. */
export function AssistantFeedback({
  onCopy,
  onRate,
  onRetry,
}: {
  onCopy?: () => void;
  onRate?: (good: boolean) => void;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <View className="-ml-1.5 flex-row gap-0.5">
      {onCopy ? (
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel="Copy answer"
          startIcon={<Icon icon={Copy} tone="subtle" />}
          onPress={onCopy}
        />
      ) : null}
      {onRate ? (
        <>
          <Button
            variant="ghost"
            size="xs"
            accessibilityLabel="Good answer"
            startIcon={<Icon icon={ThumbsUp} tone="subtle" />}
            onPress={() => {
              onRate(true);
            }}
          />
          <Button
            variant="ghost"
            size="xs"
            accessibilityLabel="Bad answer"
            startIcon={<Icon icon={ThumbsDown} tone="subtle" />}
            onPress={() => {
              onRate(false);
            }}
          />
        </>
      ) : null}
      {onRetry ? (
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel="Answer again"
          startIcon={<Icon icon={RotateCw} tone="subtle" />}
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

/** The sources an answer rests on, in a row. */
export function AssistantSources({ children }: { children: ReactNode }): React.JSX.Element {
  return <View className="flex-row flex-wrap gap-1.5">{children}</View>;
}

/** One source: its footnote number and its name. Opens it. */
export function AssistantSource({
  index,
  children,
  onPress,
}: {
  index: number;
  children: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole={onPress ? 'link' : 'text'}
      accessibilityLabel={`Source ${String(index)}: ${children}`}
      hitSlop={{ top: 9, bottom: 9 }}
      {...(onPress ? { onPress } : {})}
      className="h-[26px] flex-row items-center gap-1.5 rounded-full bg-surface-sunken pl-1 pr-2.5"
    >
      <View className="size-[18px] items-center justify-center rounded-full bg-surface">
        <CssText className="text-[10px] font-bold leading-none text-fg">{String(index)}</CssText>
      </View>
      <CssText className="text-[12px] font-medium leading-none text-fg-muted">{children}</CssText>
    </Pressable>
  );
}

/** What it is doing, step by step, while it works. */
export function AssistantSteps({ children }: { children: ReactNode }): React.JSX.Element {
  return <View className="gap-2">{children}</View>;
}

export function AssistantStep({
  status,
  children,
}: {
  status: 'done' | 'running';
  children: string;
}): React.JSX.Element {
  const running = status === 'running';
  return (
    <View
      accessible
      accessibilityLabel={`${children}${running ? ', in progress' : ', done'}`}
      className="flex-row items-center gap-2"
    >
      {running ? (
        <Spinner size={14} tone="default" decorative />
      ) : (
        <Icon icon={CircleCheck} size={15} className="text-success" />
      )}
      <CssText
        className={cn(
          'text-[15px] font-medium leading-[1.3]',
          running ? 'text-fg' : 'text-fg-muted',
        )}
      >
        {children}
      </CssText>
    </View>
  );
}

/** Questions to start from, on a fresh conversation. */
export function AssistantSuggestions({ children }: { children: ReactNode }): React.JSX.Element {
  return <View className="gap-2">{children}</View>;
}

export function AssistantSuggestion({
  icon,
  children,
  onPress,
}: {
  icon: LucideIcon;
  children: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-[16px] bg-surface-sunken px-3.5 py-3"
    >
      <Icon icon={icon} size={17} tone="accent" />
      <CssText className="flex-1 text-[15px] font-medium leading-[1.3] text-fg">{children}</CssText>
    </Pressable>
  );
}

/** Label and value pairs, stacked down a card: what an action will do, or what the assistant may read. */
export function AssistantDetails({
  pairs,
}: {
  pairs: readonly (readonly [string, string])[];
}): React.JSX.Element {
  return (
    <View>
      {pairs.map(([label, value], i) => (
        <View
          key={label}
          className={cn(
            'min-h-[52px] flex-row items-center justify-between gap-4 py-2.5',
            i < pairs.length - 1 && 'border-b border-border',
          )}
        >
          <CssText className="text-[16px] leading-[1.4] text-fg-muted">{label}</CssText>
          <CssText className="min-w-0 flex-1 text-right text-[16px] font-medium leading-[1.4] text-fg">
            {value}
          </CssText>
        </View>
      ))}
    </View>
  );
}

export type AssistantActionProps = {
  icon: LucideIcon;
  /** What it will do: "Vacation · 5 days". */
  title: string;
  /** Who it goes to, or what follows. */
  description?: string;
  details?: readonly (readonly [string, string])[];
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** An action, drafted and waiting: nothing happens until a person presses confirm. */
export function AssistantAction({
  icon,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: AssistantActionProps): React.JSX.Element {
  return (
    <View className="gap-2.5 rounded-[16px] border border-border-strong bg-surface p-3.5">
      <View className="flex-row items-center gap-2.5">
        <View className="size-8 items-center justify-center rounded-[10px] bg-accent-subtle">
          <Icon icon={icon} size={16} tone="accent" />
        </View>
        <View className="min-w-0 flex-1">
          <CssText className="text-[14px] font-semibold leading-[1.3] text-fg">{title}</CssText>
          {description ? (
            <CssText className="text-[12px] leading-[1.3] text-fg-muted">{description}</CssText>
          ) : null}
        </View>
      </View>
      {details ? <AssistantDetails pairs={details} /> : null}
      <View className="flex-row justify-end gap-2">
        <Button size="sm" onPress={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="sm" variant="primary" onPress={onConfirm}>
          {confirmLabel}
        </Button>
      </View>
    </View>
  );
}

export type AssistantComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** A reply is arriving: Send becomes Stop. */
  streaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  /** Beside the field: attach, dictate. */
  onAttach?: () => void;
  onDictate?: () => void;
  /** Under the field. `null` to leave it out. */
  disclaimer?: string | null;
};

/** Where a question is asked: the field, its tools, Send or Stop, and the honest line under it. */
export function AssistantComposer({
  value,
  onValueChange,
  onSubmit,
  streaming = false,
  onStop,
  placeholder = 'Ask a question…',
  onAttach,
  onDictate,
  disclaimer = 'Answers can be wrong. Check anything important.',
}: AssistantComposerProps): React.JSX.Element {
  const ready = value.trim().length > 0;
  return (
    <View className="px-3 pb-3 pt-2.5">
      <View className="gap-1.5 rounded-[24px] bg-surface-sunken pb-2 pl-4 pr-2.5 pt-2.5">
        <TextInput
          multiline
          {...(WEB ? { numberOfLines: 1 } : {})}
          value={value}
          onChangeText={onValueChange}
          accessibilityLabel="Question"
          placeholder={placeholder}
          className="min-h-5 text-[16px] leading-[1.4] text-fg caret-accent outline-none placeholder:text-fg-subtle"
        />
        <View className="flex-row items-center gap-0.5">
          {onAttach ? (
            <Button
              variant="ghost"
              size="xs"
              accessibilityLabel="Attach a file"
              startIcon={<Icon icon={Paperclip} />}
              onPress={onAttach}
            />
          ) : null}
          {onDictate ? (
            <Button
              variant="ghost"
              size="xs"
              accessibilityLabel="Dictate"
              startIcon={<Icon icon={Mic} />}
              onPress={onDictate}
            />
          ) : null}
          <View className="flex-1" />
          {streaming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop"
              hitSlop={6}
              {...(onStop ? { onPress: onStop } : {})}
              className="size-8 items-center justify-center rounded-full bg-invert"
            >
              <View className="size-2.5 rounded-[2px] bg-fg-on-invert" />
            </Pressable>
          ) : (
            <Button
              variant="primary"
              size="xs"
              accessibilityLabel="Send"
              startIcon={<Icon icon={ArrowUp} />}
              disabled={!ready}
              onPress={() => {
                if (ready) onSubmit(value.trim());
              }}
            />
          )}
        </View>
      </View>
      {disclaimer ? (
        <CssText className="mt-2 text-center text-[11px] leading-[1.4] text-fg-subtle">
          {disclaimer}
        </CssText>
      ) : null}
    </View>
  );
}

export type AssistantLauncherProps = {
  onOpen: () => void;
  /** A one-line greeting beside the button. Once per session at most. */
  nudge?: string;
  onDismissNudge?: () => void;
  label?: string;
};

/** The floating button that opens the assistant, with its greeting above it. */
export function AssistantLauncher({
  onOpen,
  nudge,
  onDismissNudge,
  label = 'Open the assistant',
}: AssistantLauncherProps): React.JSX.Element {
  return (
    <View className="items-end gap-2.5">
      {nudge ? (
        <View className="max-w-[268px] flex-row gap-2.5 rounded-[18px] rounded-br-md bg-surface-raised px-3.5 py-3 shadow-lg">
          <CssText className="flex-1 text-[14px] leading-[1.45] text-fg">{nudge}</CssText>
          {onDismissNudge ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={15}
              onPress={onDismissNudge}
            >
              <Icon icon={X} size={14} tone="subtle" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <FloatingButton icon={Sparkles} accessibilityLabel={label} onPress={onOpen} />
    </View>
  );
}

export type AssistantWidgetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The launcher's greeting while closed. */
  nudge?: string;
  onDismissNudge?: () => void;
  /** The open card: an `AssistantPanel`. */
  children: ReactNode;
  /** The tab bar's height, which the card and the launcher float above. */
  bottomInset?: number;
  /** The open card's height. A compact card, never the whole screen. */
  height?: number;
};

/**
 * The assistant on a screen: the launcher at the bottom right, and when it
 * opens, the compact card in its place above the tab bar. No scrim: the page
 * stays visible and usable around it. Pin it in a positioned parent that
 * covers the screen.
 */
export function AssistantWidget({
  open,
  onOpenChange,
  nudge,
  onDismissNudge,
  children,
  bottomInset = 0,
  height = 440,
}: AssistantWidgetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const bottom = insets.bottom + bottomInset + 16;
  // Compact on any phone: never taller than the space under the status bar.
  const tall = Math.min(height, window.height - insets.top - bottom - 16);
  // Out of the launcher's corner and back, as every pop-over surface moves.
  const presence = usePresence(open, 'top');
  return (
    <>
      {presence.mounted ? (
        <View
          pointerEvents={open ? 'box-none' : 'none'}
          className="absolute left-2.5 right-2.5"
          style={{ bottom, height: tall }}
        >
          {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
          <Animated.View style={[{ flex: 1 }, presence.style]}>{children}</Animated.View>
          {open ? (
            <BackGuard
              onBack={() => {
                onOpenChange(false);
              }}
            />
          ) : null}
        </View>
      ) : null}
      {open ? null : (
        <View pointerEvents="box-none" className="absolute right-4" style={{ bottom }}>
          <AssistantLauncher
            onOpen={() => {
              onOpenChange(true);
            }}
            {...(nudge ? { nudge } : {})}
            {...(onDismissNudge ? { onDismissNudge } : {})}
          />
        </View>
      )}
    </>
  );
}
