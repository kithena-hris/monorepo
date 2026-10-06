import type { ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { Text } from '../components/text/text.tsx';
import { cn } from '../lib/cn.ts';

/*
 * A stand-in for lane C's Tooltip (RMB-034), which Kbd's stories show
 * beside the component they are about. Drawn at the design's size; swap it
 * for the library's own once it lands. Stories only: nothing in a component
 * uses it. (Lane A's SearchField, Checkbox and Switch replaced the others.)
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
