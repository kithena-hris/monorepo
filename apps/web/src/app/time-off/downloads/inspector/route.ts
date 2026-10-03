import { timeOff } from '../../../../lib/people';

/**
 * The labour inspector's daily record as a file the browser saves (T23,
 * TOF-095): `GET ?from=2026-09-01&to=2026-09-30&format=csv|pdf`, a link on
 * the exceptions page. Time Off decides who may (HR) and what is on it; this
 * only turns its answer into a download, as People's summary route does.
 */

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const status = (code: string): number =>
  code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 422;

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  const format = search.get('format');
  if (!DATE.test(from) || !DATE.test(to) || (format !== 'csv' && format !== 'pdf')) {
    return new Response(null, { status: 400 });
  }
  const answer = await timeOff<{ name: string; contentType: string; base64: string }>(
    'TimeOffInspectorRecord',
    { from, to, format },
  );
  if (!answer.ok) return new Response(answer.message, { status: status(answer.code) });
  return new Response(Buffer.from(answer.data.base64, 'base64'), {
    headers: {
      'content-type': answer.data.contentType,
      'content-disposition': `attachment; filename="${answer.data.name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
