import { fileBytes } from '../../../../(app)/documents/actions';

/**
 * A document version's bytes, streamed to the browser as the person signed
 * in (`fileLink`): the PDF viewer fetches this URL instead of the page
 * carrying the whole file as base64, so the page arrives at once and the
 * file is cached by version. Documents decides who may read it on every
 * request, as it does for any read.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params;
  const search = new URL(request.url).searchParams;
  const mode = search.get('mode') === 'download' ? 'download' : 'view';
  const versionParam = search.get('version');
  const version = versionParam === null ? null : Number(versionParam);
  if (version !== null && !Number.isInteger(version)) return new Response(null, { status: 400 });
  const file = await fileBytes(documentId, mode, version);
  if (file === null) return new Response(null, { status: 404 });
  return new Response(Uint8Array.from(file.bytes).buffer, {
    headers: {
      'content-type': file.mediaType,
      'content-disposition': `${mode === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      // Private to this browser, and only briefly: a watermarked view names
      // its reader, and a version never changes once filed.
      'cache-control': version === null ? 'private, no-store' : 'private, max-age=600',
    },
  });
}
