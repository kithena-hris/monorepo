import { Check } from 'lucide-react-native';
import { useId, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native-css/components';

import { Icon } from '../components/icon/icon.tsx';
import { Text } from '../components/text/text.tsx';
import { cn } from '../lib/cn.ts';
import { OverlayHost } from '../lib/overlay.tsx';

/**
 * A phone screen with a page on it, for a story whose overlay is open: the
 * design's stage. The overlay draws in this frame's own host (pass the name
 * the render prop receives as `portalHost`), so it covers the frame and not
 * the whole canvas, and the page's first line is the trigger that reopens it.
 */
export function Stage({
  height = 520,
  trigger,
  children,
}: {
  height?: number;
  trigger?: ReactNode;
  children: (host: string) => ReactNode;
}): React.JSX.Element {
  const host = useId();
  return (
    <View
      className="overflow-hidden rounded-[24px] border border-border bg-canvas"
      style={{ height }}
    >
      <View className="gap-3 p-5">
        {trigger ?? <View className="h-[18px] w-2/5 rounded-[6px] bg-surface-active" />}
        <View className="h-2.5 w-[70%] rounded-[5px] bg-surface-sunken" />
        <View className="h-20 rounded-[14px] bg-surface" />
        <View className="h-20 rounded-[14px] bg-surface" />
        <View className="h-20 rounded-[14px] bg-surface" />
      </View>
      <OverlayHost name={host} />
      {children(host)}
    </View>
  );
}

/*
 * Stand-ins for lane A's Field, Input and Checkbox, which these overlay
 * stories need before that lane lands. Real controls (a text input, a
 * toggling box) at the design's sizes; swap for the library's own once they
 * exist.
 */

/** A filled field with its label inside, the phone's text field. */
export function StandInField({
  label,
  value,
  onChangeText,
  focused = false,
  accessibilityLabel,
  end,
}: {
  label?: string;
  value: string;
  onChangeText?: (value: string) => void;
  focused?: boolean;
  accessibilityLabel?: string;
  /** An adornment at the end, such as a chevron. */
  end?: ReactNode;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(focused);
  return (
    <View
      className={cn(
        'h-m-field flex-row items-center gap-2.5 rounded-[16px] px-4',
        focus ? 'border-2 border-accent bg-surface' : 'bg-surface-sunken',
      )}
    >
      <View className="flex-1 gap-0.5">
        {label ? (
          <Text variant="caption" tone={focus ? 'accent' : 'muted'}>
            {label}
          </Text>
        ) : null}
        <FieldInput
          value={onChangeText ? value : text}
          onChangeText={onChangeText ?? setText}
          focused={focused}
          onFocusChange={setFocus}
          accessibilityLabel={accessibilityLabel ?? label ?? ''}
        />
      </View>
      {end}
    </View>
  );
}

function FieldInput({
  value,
  onChangeText,
  focused,
  onFocusChange,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  focused: boolean;
  onFocusChange: (focus: boolean) => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  return (
    <TextInput
        value={value}
        onChangeText={onChangeText}
      onFocus={() => {
        onFocusChange(true);
      }}
      onBlur={() => {
        onFocusChange(false);
      }}
      autoFocus={focused}
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={accessibilityLabel}
      className="p-0 text-body text-fg outline-none"
    />
  );
}

/** A labelled box that toggles. */
export function StandInCheck({
  label,
  defaultChecked = false,
}: {
  label: string;
  defaultChecked?: boolean;
}): React.JSX.Element {
  const [on, setOn] = useState(defaultChecked);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={() => {
        setOn(!on);
      }}
      className="min-h-m-tap flex-row items-center gap-2.5"
    >
      <View
        className={cn(
          'size-6 items-center justify-center rounded-[8px]',
          on ? 'bg-accent' : 'border-[1.5px] border-border-strong',
        )}
      >
        {on ? <Icon icon={Check} size={18} tone="on-accent" /> : null}
      </View>
      <Text>{label}</Text>
    </Pressable>
  );
}
