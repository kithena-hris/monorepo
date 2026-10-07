import { View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

export type SeparatorProps = {
  orientation?: 'horizontal' | 'vertical';
  /**
   * Hidden from a screen reader, the default. Pass `false` only when the line
   * really separates two sections a listener should hear as distinct.
   */
  decorative?: boolean;
  /** `strong` for a real section break. */
  weight?: 'default' | 'strong';
  className?: string | undefined;
};

/** A hairline between groups. Try spacing first. */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
  weight = 'default',
  className,
}: SeparatorProps): React.JSX.Element {
  return (
    <View
      {...(decorative
        ? { accessible: false, 'aria-hidden': true }
        : { role: 'separator' as const, 'aria-orientation': orientation })}
      className={cn(
        weight === 'strong' ? 'bg-border-strong' : 'bg-border',
        orientation === 'horizontal' ? 'h-px self-stretch' : 'w-px self-stretch',
        className,
      )}
    />
  );
}
