'use server';

import { refresh } from 'next/cache';

import { keepMySignature } from '../../../../../lib/my-signature';

/** Settings: keep this signature on the person's record, replacing the one there. */
export async function changeMySignature(
  mark: unknown,
): Promise<
  { readonly ok: true; readonly held: boolean } | { readonly ok: false; readonly message: string }
> {
  const kept = await keepMySignature(mark as never, false);
  if (kept.ok) refresh();
  return kept;
}
