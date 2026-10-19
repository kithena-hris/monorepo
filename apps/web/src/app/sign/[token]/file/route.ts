import { call } from '../actions';

/**
 * The document an outside signer reads, streamed from the link's token: the
 * signing page points its viewer here rather than carrying the file as
 * base64, so the page arrives at once however large the document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const file = await call<{ url: string | null; base64: string | null; mediaType: string }>(
    token,
    '/file',
  );
  if (!file.ok) return new Response(null, { status: 404 });
  if (file.data.url !== null) return Response.redirect(file.data.url, 302);
  return new Response(Buffer.from(file.data.base64 ?? '', 'base64'), {
    headers: { 'content-type': file.data.mediaType, 'cache-control': 'private, no-store' },
  });
}
