'use server';

import { writePreference } from '../../../../lib/preferences';
import { problemIn, ShortcutPrefsSchema } from '../../../../lib/shortcuts';

/**
 * Saves the signed-in person's keyboard shortcuts.
 *
 * Checked again here, whatever the page already said: the same `problemIn`
 * the page ran as the keys were recorded, over the whole set, so a request
 * made without the page cannot store a clash, a key the browser owns, or a
 * shortcut that does not exist. `apple` only chooses how a key is written in
 * the message (⌘ or Ctrl).
 */
export async function saveShortcuts(
  input: unknown,
  apple: unknown,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const parsed = ShortcutPrefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Those keys could not be read. Try again.' };
  const problem = problemIn(parsed.data.bindings, apple === true);
  if (problem !== null) return { ok: false, message: problem };
  const saved = await writePreference('shortcuts', parsed.data);
  return saved
    ? { ok: true }
    : { ok: false, message: 'Your shortcuts could not be saved just now. Try again.' };
}
