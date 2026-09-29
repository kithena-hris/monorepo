import { people } from '../../../../../lib/people';

/**
 * A file an image or document field holds, as the browser opens it.
 *
 * Asked of People as the person signed in: People answers only somebody who
 * may read that field on that person, and anybody else gets a 404. The URL
 * opens nothing on its own and is `private`. A PDF or an image opens inline
 * with nothing allowed to run; `?download` saves it instead.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  const answer = await people<{ name: string; mediaType: string; data: string }>('File', { id });
  if (!answer.ok) {
    return new Response(null, { status: answer.code === 'UNAUTHENTICATED' ? 401 : 404 });
  }
  // Never a type People did not store.
  if (!TYPES.has(answer.data.mediaType)) return new Response(null, { status: 404 });
  const saving = new URL(request.url).searchParams.has('download');
  const name = encodeURIComponent(answer.data.name);
  return new Response(Buffer.from(answer.data.data, 'base64'), {
    headers: {
      'content-type': answer.data.mediaType,
      'content-disposition': `${saving ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      // A file's id is its version: a new upload is a new id.
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // Nothing that runs. Chrome refuses to show a PDF under `sandbox`, so an
      // image gets it and a PDF relies on `default-src 'none'`.
      'content-security-policy':
        answer.data.mediaType === 'application/pdf'
          ? "default-src 'none'"
          : "default-src 'none'; sandbox",
    },
  });
}
