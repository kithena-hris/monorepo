import { envelopeFileBytes } from '../../../../../(app)/documents/actions';

/**
 * The copy being signed, as the signer sees it so far (K7), streamed as the
 * person signed in: the viewer fetches this rather than the page carrying
 * the file. Never cached: it changes with every signature.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ envelopeId: string }> },
): Promise<Response> {
  const { envelopeId } = await params;
  const file = await envelopeFileBytes(envelopeId);
  if (file === null) return new Response(null, { status: 404 });
  return new Response(Uint8Array.from(file.bytes).buffer, {
    headers: { 'content-type': file.mediaType, 'cache-control': 'private, no-store' },
  });
}
