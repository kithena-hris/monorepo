import { people } from '../../../../lib/people';

/**
 * A person's photo, as an image the page's `<img>` can load.
 *
 * Asked of People as the person signed in, like every People read: People
 * answers only somebody who may read that person, and anybody else gets the
 * 404 they would get for the person. So the URL itself opens nothing — it is
 * not a signed link and not a bucket's — and it is `private`: a shared cache
 * never keeps one person's view for another. People names each version in the
 * URL (`?v=`), so a browser may keep one for as long as it likes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['image/png', 'image/jpeg']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  const answer = await people<{ mediaType: string; data: string; checksum: string }>('Photo', {
    personId: id,
  });
  if (!answer.ok) {
    return new Response(null, { status: answer.code === 'UNAUTHENTICATED' ? 401 : 404 });
  }
  // Never a type People did not store: an image, or nothing.
  if (!TYPES.has(answer.data.mediaType)) return new Response(null, { status: 404 });
  const versioned =
    new URL(request.url).searchParams.get('v') === answer.data.checksum.slice(0, 16);
  return new Response(Buffer.from(answer.data.data, 'base64'), {
    headers: {
      'content-type': answer.data.mediaType,
      'cache-control': versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      'x-content-type-options': 'nosniff',
      // Opened on its own, it is an image and nothing that runs.
      'content-security-policy': "default-src 'none'; sandbox",
      etag: `"${answer.data.checksum}"`,
    },
  });
}
