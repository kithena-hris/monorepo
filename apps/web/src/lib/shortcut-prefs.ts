import { z } from 'zod';

import { DEFAULT_PREFS, type ShortcutPrefs } from './shortcuts';

/*
 * Stored shortcut preferences, checked. The server's alone: the check is Zod,
 * and `shortcuts.ts` is in the shell's chrome on every page, where it brought
 * the schema library with it.
 */

/** A chord as `chordOf` writes one: modifiers, then a key. Checked, because it arrives from a browser. */
const Chord = z
  .string()
  .min(1)
  .max(24)
  .regex(/^(?:(?:mod|alt|shift)\+)*(?:.|[a-z][a-z0-9]*)$/u);

export const ShortcutPrefsSchema = z.object({
  bindings: z.record(z.string().max(64), z.array(Chord).min(1).max(2)),
  characterKeys: z.boolean(),
});

/** Stored preferences as the app uses them: anything unreadable is the defaults. */
export function prefsFrom(value: unknown): ShortcutPrefs {
  const parsed = ShortcutPrefsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}
