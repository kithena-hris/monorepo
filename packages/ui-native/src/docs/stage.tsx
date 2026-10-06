import { Check } from 'lucide-react-native';
import { useId, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native-css/components';

import { Icon } from '../components/icon/icon.tsx';
import { Text } from '../components/text/text.tsx';
import { cn } from '../lib/cn.ts';
import { OverlayHost } from '../lib/overlay-host.tsx';

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
      {children(host)}
      {/* Last, so what opens in it draws over anything the story placed on the page. */}
      <OverlayHost name={host} />
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
  small = false,
}: {
  label?: string;
  value: string;
  onChangeText?: (value: string) => void;
  focused?: boolean;
  accessibilityLabel?: string;
  /** An adornment at the end, such as a chevron. */
  end?: ReactNode;
  /** The 44-point field, for a toolbar or a popover. */
  small?: boolean;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(focused);
  return (
    <View
      className={cn(
        'flex-row items-center gap-2.5 rounded-[16px] px-4',
        small ? 'h-11' : 'h-m-field',
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
      // react-native-web reads the ARIA prop, not accessibilityState, for this.
      aria-checked={on}
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

type DomNode = {
  parentElement: DomNode | null;
  querySelectorAll(selectors: string): ArrayLike<DomNode>;
};
type Dom = {
  document: { querySelectorAll(selectors: string): ArrayLike<DomNode> };
  getComputedStyle: (element: DomNode) => { opacity: string };
  requestAnimationFrame: (callback: () => void) => number;
};

/** A view drawn translucent by its classes (a key on a tooltip), not mid-fade. */
function isDimmedOnPurpose(element: DomNode): boolean {
  const name = (element as unknown as { className?: unknown }).className;
  return typeof name === 'string' && /\bopacity-/.test(name);
}

/**
 * A `play` for stories that open a modal: resolves once every open dialog is
 * fully drawn, its own opacity and each ancestor's at 1, or after two seconds.
 * The motion is Reanimated's, driven from JavaScript, so Storybook's wait for
 * CSS animations cannot see it, and axe run mid-fade reads every colour
 * blended with the page behind.
 */
export function settled(): Promise<void> {
  const dom = globalThis as unknown as Partial<Dom>;
  const { document, getComputedStyle, requestAnimationFrame } = dom;
  if (!document || !getComputedStyle || !requestAnimationFrame) return Promise.resolve();
  // The overlay, each ancestor and each descendant: a popover's motion is on
  // a view inside the primitive's content, a dialog's on one around it.
  const opaque = (element: DomNode): boolean => {
    for (let at: DomNode | null = element; at; at = at.parentElement) {
      if (Number(getComputedStyle(at).opacity) < 1) return false;
    }
    return Array.from(element.querySelectorAll('*')).every(
      (inner) => Number(getComputedStyle(inner).opacity) >= 1 || isDimmedOnPurpose(inner),
    );
  };
  const deadline = Date.now() + 2000;
  // One check a frame, each waiting on the last: a poll, not parallel work.
  return new Promise((resolve) => {
    const check = (): void => {
      const open = Array.from(
        document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]',
        ),
      );
      if ((open.length > 0 && open.every(opaque)) || Date.now() >= deadline) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * A stand-in for lane B's indeterminate Progress: the design's bar, still.
 * Swap for the library's own once it exists.
 */
export function StandInProgress({ label }: { label: string }): React.JSX.Element {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className="h-2 overflow-hidden rounded-full bg-surface-active"
    >
      <View className="h-2 w-2/5 rounded-full bg-accent" />
    </View>
  );
}

/** A stand-in for lane D's KeyValues on a phone: label left, value right. */
export function StandInKeyValues({
  pairs,
}: {
  pairs: readonly (readonly [string, string])[];
}): React.JSX.Element {
  return (
    <View>
      {pairs.map(([key, value], i) => (
        <View
          key={key}
          className={cn(
            'min-h-[52px] flex-row items-center justify-between gap-4 py-2.5',
            i < pairs.length - 1 && 'border-b border-border',
          )}
        >
          <Text variant="callout" tone="muted" className="shrink-0">
            {key}
          </Text>
          <Text variant="callout" weight="medium" className="shrink text-right">
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A stand-in for lane B's Segmented control: one of several, full width. */
export function StandInSegmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row gap-0.5 rounded-full bg-surface-sunken p-[3px]"
    >
      {options.map((option) => {
        const on = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            onPress={() => {
              onChange(option);
            }}
            className={cn(
              'h-8 flex-1 items-center justify-center rounded-full',
              on && 'bg-surface-raised shadow-sm',
            )}
          >
            <Text
              variant="subhead"
              weight="semibold"
              tone={on ? 'default' : 'muted'}
              className="leading-none"
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A stand-in for lane B's Kbd, drawn for the inverted tooltip surface. */
export function StandInKey({ children }: { children: string }): React.JSX.Element {
  return (
    <View className="min-w-[22px] items-center rounded-[6px] bg-fg-on-invert/15 px-1">
      <Text className="text-[11px] leading-[22px] font-semibold text-fg-on-invert">{children}</Text>
    </View>
  );
}
