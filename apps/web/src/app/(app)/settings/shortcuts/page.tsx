import type { JSX } from 'react';

import { ShortcutSettings } from '../../../../components/shortcut-settings';

/**
 * Settings › Keyboard shortcuts. Everybody's: the keys are a person's own,
 * read from the shell's shortcuts (the layout loaded them), saved with
 * `saveShortcuts`.
 */
export default function ShortcutsSettings(): JSX.Element {
  return <ShortcutSettings />;
}
