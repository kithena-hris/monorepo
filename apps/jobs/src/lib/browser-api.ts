/**
 * The public API from the browser (REC-093, REC-094): the apply form and the
 * candidate's own pages call Recruiting directly, because a CV is up to 10 MB
 * and a serverless function relays less. The token comes from the address's
 * fragment, which no server ever sees, and travels in a header.
 */

const base = () =>
  (process.env['NEXT_PUBLIC_RECRUITING_PUBLIC_URL'] ?? 'http://localhost:4005').replace(/\/$/u, '');

export type Answer<T> = { ok: true; data: T } | { ok: false; message: string };

export async function publicApi<T>(
  company: string,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<Answer<T>> {
  try {
    const response = await fetch(
      `${base()}/v1/recruiting/public/${encodeURIComponent(company)}${path}`,
      {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...(options.token === undefined ? {} : { 'x-candidate-token': options.token }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return response.ok
      ? { ok: true, data: body as T }
      : { ok: false, message: body?.error?.message ?? 'That did not go through. Try again.' };
  } catch {
    return {
      ok: false,
      message: 'Kithena Jobs is not reachable right now. Try again in a moment.',
    };
  }
}

/** A file as the public API takes it: base64, with the field it answers. */
export async function asUpload(
  field: string,
  file: File,
): Promise<{ field: string; fileName: string; mediaType: string; base64: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    field,
    fileName: file.name,
    mediaType: file.type || 'application/octet-stream',
    base64: btoa(binary),
  };
}

/** The candidate's token, from `#token`: never in a URL a server logs. */
export const tokenFromHash = (): string =>
  typeof window === 'undefined' ? '' : decodeURIComponent(window.location.hash.replace(/^#/u, ''));
