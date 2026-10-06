import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { CheckboxBox } from '../checkbox/checkbox.tsx';
import { Icon } from '../icon/icon.tsx';

/*
 * The rows a centred list is made of, shared by Select and Combobox: 48pt
 * under a thumb, 17pt, the chosen one in semibold with a check at the end (or
 * a checkbox at the start when several can be chosen), a second line in 12pt.
 */

/** A part of a label to draw in the accent: what the search matched. */
function Highlighted({ text, match }: { text: string; match: string | undefined }): ReactNode {
  const at = match ? text.toLocaleLowerCase().indexOf(match.toLocaleLowerCase()) : -1;
  if (!match || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <CssText className="font-bold text-accent-fg">{text.slice(at, at + match.length)}</CssText>
      {text.slice(at + match.length)}
    </>
  );
}

export type OptionRowProps = {
  label: string;
  description?: string | undefined;
  /** An `<Icon>` or an `<Avatar>` (32pt), before the label. */
  icon?: ReactNode;
  selected: boolean;
  disabled?: boolean | undefined;
  /** Several can be chosen: a checkbox leads, rather than a check trailing. */
  multiple?: boolean;
  /** What Enter would pick, drawn on the fill. */
  active?: boolean;
  /** The part of the label the search matched. */
  match?: string | undefined;
  onPress: () => void;
};

export function OptionRow({
  label,
  description,
  icon,
  selected,
  disabled = false,
  multiple = false,
  active = false,
  match,
  onPress,
}: OptionRowProps): React.JSX.Element {
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityLabel={description ? `${label}, ${description}` : label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      className={cn(
        'min-h-12 flex-row items-center gap-2.5 rounded-[14px] px-3 outline-none',
        description && 'py-1.5',
        // Keyboard focus is drawn as the design's active row, the fill: a
        // dialog focuses its first row as it opens, and a ring there reads
        // as a choice already made.
        active || ring.focused ? 'bg-surface-sunken' : 'active:bg-surface-sunken',
      )}
    >
      {multiple ? <CheckboxBox checked={selected} disabled={disabled} /> : null}
      {icon}
      <View className="min-w-0 flex-1" aria-hidden>
        <CssText
          className={cn(
            'text-[17px] leading-[1.3]',
            selected ? 'font-semibold' : 'font-normal',
            disabled ? 'text-fg-disabled' : 'text-fg',
          )}
        >
          <Highlighted text={label} match={match} />
        </CssText>
        {description ? (
          <CssText className="text-[12px] leading-[1.3] text-fg-muted">{description}</CssText>
        ) : null}
      </View>
      {!multiple && selected ? <Icon icon={Check} size={16} tone="accent" /> : null}
    </Pressable>
  );
}

/** A group's name over its options. Read as a heading, so a list can be skimmed by group. */
export function ListHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <CssText
      accessibilityRole="header"
      className="px-2.5 pt-2 pb-1 text-[12px] leading-none font-semibold text-fg-subtle"
    >
      {children}
    </CssText>
  );
}

export function ListSeparator(): React.JSX.Element {
  return <View aria-hidden className="mx-2 my-1.5 h-px bg-border" />;
}

/** A line under the list: how many are chosen, or what a server search is doing. */
export function ListFooter({ children }: { children: string }): React.JSX.Element {
  return (
    <CssText
      accessibilityLiveRegion="polite"
      aria-live="polite"
      className="px-2.5 pt-2 pb-1 text-[12px] leading-[1.4] text-fg-muted"
    >
      {children}
    </CssText>
  );
}
