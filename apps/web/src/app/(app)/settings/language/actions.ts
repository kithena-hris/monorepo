'use server';

import { cookies } from 'next/headers';

import { isLanguage, LANGUAGE_KEY } from '../../../../lib/languages';
import { writePreference } from '../../../../lib/preferences';

/**
 * Saves the signed-in person's language: with their account, so it follows
 * them to any device, and in the cookie, so the next page renders in it.
 * Checked against the languages there are, whatever the menu sent.
 */
export async function saveLanguage(
  input: unknown,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  if (!isLanguage(input)) return { ok: false, message: 'That language is not available.' };
  const saved = await writePreference('language', { code: input });
  if (saved === 'view_only')
    return { ok: false, message: 'You are viewing as somebody else, so nothing can be changed.' };
  // Kept on this device either way: the page still follows the choice if the account could not.
  (await cookies()).set(LANGUAGE_KEY, input, {
    path: '/',
    maxAge: 31_536_000,
    sameSite: 'lax',
  });
  return saved === 'saved'
    ? { ok: true }
    : { ok: false, message: 'Your language could not be saved just now. Try again.' };
}
