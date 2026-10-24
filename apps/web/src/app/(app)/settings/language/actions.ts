'use server';

import { cookies } from 'next/headers';

import { isLanguage, LANGUAGE_KEY } from '../../../../lib/languages';
import { writePreference } from '../../../../lib/preferences';
import { serverWords } from '../../../../lib/server-words';

/**
 * Saves the signed-in person's language: with their account, so it follows
 * them to any device, and in the cookie, so the next page renders in it.
 * Checked against the languages there are, whatever the menu sent.
 */
export async function saveLanguage(input: unknown): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'unknown' | 'view_only' | 'failed';
      readonly message: string;
    }
> {
  const t = await serverWords();
  if (!isLanguage(input))
    return {
      ok: false,
      code: 'unknown',
      message: t(
        'app.app.settings.language.actions.that_language_is_not_available',
        'That language is not available.',
      ),
    };
  const saved = await writePreference('language', { code: input });
  if (saved === 'view_only')
    return {
      ok: false,
      code: 'view_only',
      message: t(
        'app.app.settings.language.actions.you_are_viewing_as_somebody_else_so',
        'You are viewing as somebody else, so nothing can be changed.',
      ),
    };
  // Kept on this device either way: the page still follows the choice if the account could not.
  (await cookies()).set(LANGUAGE_KEY, input, {
    path: '/',
    maxAge: 31_536_000,
    sameSite: 'lax',
  });
  return saved === 'saved'
    ? { ok: true }
    : {
        ok: false,
        code: 'failed',
        message: t(
          'app.app.settings.language.actions.your_language_could_not_be_saved_just',
          'Your language could not be saved just now. Try again.',
        ),
      };
}
