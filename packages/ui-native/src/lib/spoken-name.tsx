import { Platform, Text } from 'react-native';

/**
 * A control's spoken name, for a control whose visible words already say it.
 *
 * On a phone, `accessibilityLabel` is the name VoiceOver and TalkBack speak,
 * and the label is the clearest way to give it. On the web (react-native-web,
 * where Reach Mobile's Storybook runs), every `Text` is its own block and the
 * label becomes `aria-label`, which a voice-control user cannot say unless it
 * holds every word the control shows, in order (WCAG 2.5.3, Label in Name).
 * There the name comes from the visible words themselves, and anything the
 * label said that is not on screen goes in an `Unseen` inside the control.
 */
export const spokenName = (label: string): { accessibilityLabel?: string } =>
  Platform.OS === 'web' ? {} : { accessibilityLabel: label };

const HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  overflow: 'hidden',
  opacity: 0,
} as const;

/**
 * Words a screen reader hears on the web and nobody sees: what a phone's
 * `accessibilityLabel` adds beyond the visible text ("match", "locked").
 * Nothing on a phone, where the label already says it.
 */
export function Unseen({ children }: { readonly children: string }): React.JSX.Element | null {
  if (Platform.OS !== 'web') return null;
  return <Text style={HIDDEN}>{` ${children}`}</Text>;
}

/**
 * For text inside a control named by `spokenName`: hidden from a phone's
 * screen reader, which hears the label instead, and read on the web, where
 * the control's name is its text.
 */
export const hiddenOnDevice: { 'aria-hidden'?: true } =
  Platform.OS === 'web' ? {} : { 'aria-hidden': true };
