import { NextResponse, type NextRequest } from 'next/server';

import { accountCall } from '../../../../lib/account';

/**
 * A CV from the library, opened or downloaded by its owner. The bytes come
 * from Recruiting under the session's token on this server, so no link to
 * the file ever exists that a token does not guard.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const file = await accountCall<{ fileName: string; mediaType: string; base64: string }>(
    `/cvs/${encodeURIComponent(id)}/file`,
  );
  if (!file.ok) return NextResponse.json({ error: file.message }, { status: file.status });
  const download = request.nextUrl.searchParams.get('download') === '1';
  const name = file.data.fileName.replaceAll(/["\r\n]/gu, '');
  return new Response(Buffer.from(file.data.base64, 'base64'), {
    headers: {
      'content-type': file.data.mediaType,
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'cache-control': 'private, no-store',
    },
  });
}
