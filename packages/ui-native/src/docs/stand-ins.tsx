import { Check, Search } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native-css/components';

import { Icon } from '../components/icon/icon.tsx';
import { Text } from '../components/text/text.tsx';
import { cn } from '../lib/cn.ts';

/*
 * Stand-ins for other lanes' components that some of lane B's stories show
 * beside the component they are about: lane
 * A's search Input (RMB-010), Checkbox and Switch (RMB-012). Drawn at the design's sizes; swap each for the
 * library's own once it lands. Stories only: nothing in a component uses them.
 */

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
