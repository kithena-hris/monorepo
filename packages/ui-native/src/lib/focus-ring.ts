import { useState } from 'react';
import { Platform, type NativeSyntheticEvent } from 'react-native';

type Focusable = { matches?: (selector: string) => boolean };

/**
 * Whether a control should draw its focus ring: focused from a keyboard, a
 * switch or a screen reader, not by a tap. On the web that is the browser's
 * own `:focus-visible`; on a device nothing focuses a control except those, so
 * focus is the answer.
 */
export function useFocusRing(): {
  focused: boolean;
  onFocus: (event: NativeSyntheticEvent<unknown>) => void;
  onBlur: () => void;
} {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    onFocus: (event) => {
      if (Platform.OS !== 'web') {
        setFocused(true);
        return;
      }
      const target = event.nativeEvent as { target?: Focusable };
      setFocused(target.target?.matches?.(':focus-visible') ?? true);
    },
    onBlur: () => {
      setFocused(false);
    },
  };
}
