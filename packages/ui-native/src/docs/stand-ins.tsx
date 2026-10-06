import { Check, Search } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native-css/components';

import { Icon } from '../components/icon/icon.tsx';
import { Text } from '../components/text/text.tsx';
import { cn } from '../lib/cn.ts';

/*
 * Stand-ins for other lanes' components that some of lane B's stories show
 * beside the component they are about: lane C's Tooltip (RMB-034), and lane
 * A's search Input (RMB-010), Checkbox and Switch (RMB-012). Drawn at the design's sizes; swap each for the
 * library's own once it lands. Stories only: nothing in a component uses them.
 */

/** The tooltip's bubble, open, pointing at what it describes from `side`. */
export function StandInTip({
  children,
  side = 'top',
  extra,
}: {
  children: string;
  /** Which side of the bubble the arrow is on, pointing at its trigger. */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /** A second line, such as the shortcut. */
  extra?: ReactNode;
}): React.JSX.Element {
  return (
    <View className="max-w-60 gap-0.5 rounded-[8px] bg-invert px-2.5 py-1.5 shadow-md">
      <Text tone="on-invert" weight="medium" className="text-[13px] leading-[1.35]">
        {children}
      </Text>
      {extra ? <View className="opacity-75">{extra}</View> : null}
      <View
        className={cn(
          'absolute size-2.5 rotate-45 rounded-[2px] bg-invert',
          side === 'left' && '-left-1 top-1/2 -mt-[5px]',
          side === 'right' && '-right-1 top-1/2 -mt-[5px]',
          side === 'top' && '-top-1 left-1/2 -ml-[5px]',
          side === 'bottom' && '-bottom-1 left-1/2 -ml-[5px]',
        )}
      />
    </View>
  );
}

/** The phone's filled search field: a glass, the placeholder, nothing else. */
export function StandInSearch({ placeholder }: { placeholder: string }): React.JSX.Element {
  return (
    <View className="h-m-field flex-row items-center gap-2.5 rounded-[16px] bg-surface-sunken px-4">
      <Icon icon={Search} size={19} tone="muted" />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        className="flex-1 text-body text-fg placeholder:text-fg-subtle"
      />
    </View>
  );
}

/** A checkbox on its own, named by the row it sits in. */
export function StandInCheckbox({
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
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      hitSlop={10}
      onPress={() => {
        setOn(!on);
      }}
      className={cn(
        'size-6 items-center justify-center rounded-[8px]',
        on ? 'bg-accent-solid' : 'border-[1.5px] border-border-strong',
      )}
    >
      {on ? <Icon icon={Check} size={18} tone="on-accent" /> : null}
    </Pressable>
  );
}

/** The phone's switch: 51 by 31, green when on. */
export function StandInSwitch({
  label,
  defaultOn = false,
}: {
  label: string;
  defaultOn?: boolean;
}): React.JSX.Element {
  const [on, setOn] = useState(defaultOn);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      hitSlop={7}
      onPress={() => {
        setOn(!on);
      }}
      className={cn(
        'h-[31px] w-[51px] rounded-full p-0.5',
        on ? 'bg-success' : 'bg-surface-active',
      )}
    >
      <View className={cn('size-[27px] rounded-full bg-white shadow-sm', on && 'ml-auto')} />
    </Pressable>
  );
}
