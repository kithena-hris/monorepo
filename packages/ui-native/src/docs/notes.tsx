import { View } from 'react-native-css/components';

import { KbdGroup } from '../components/kbd/kbd.tsx';
import { Text } from '../components/text/text.tsx';

/**
 * A row of shortcuts under a component that takes a hardware keyboard: the
 * keys, then what they do. For stories; the keys themselves are `Kbd`.
 */
export function KeyHints({
  hints,
}: {
  hints: readonly (readonly [readonly string[], string])[];
}): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-2">
      {hints.map(([keys, label]) => (
        <View key={label} className="flex-row items-center gap-1.5">
          <KbdGroup keys={keys} />
          <Text variant="footnote" tone="muted">
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The design's note under a story: a sentence of guidance, quiet. */
export function Note({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="subhead" tone="muted" className="leading-[1.5]">
      {children}
    </Text>
  );
}
