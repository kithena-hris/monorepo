import { people } from '../../../../lib/people';

/**
 * An Insights summary as a PDF the browser saves (design AI6, MA5).
 *
 * `POST`, a form from the export dialog: the summary as previewed and edited,
 * for whoever it is for, as People rewrites it for them. A form rather than
 * script, so the browser saves the file as it saves any other download. Only
 * from this origin: a page elsewhere cannot make somebody's browser print
 * their summary.
 *
 * `GET ?shared=<id>`: a summary somebody sent, for its recipient.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const status = (code: string): number =>
  code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 422;

function pdf(base64: string, name: string): Response {
  return new Response(Buffer.from(base64, 'base64'), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response(null, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const input = form?.get('input');
  if (typeof input !== 'string' || input.length > 20_000)
    return new Response(null, { status: 400 });
  const answer = await people<string>('SummaryPdf', { input });
  if (!answer.ok) return new Response(answer.message, { status: status(answer.code) });
  return pdf(answer.data, `what-changed-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('shared');
  if (id === null || !UUID.test(id)) return new Response(null, { status: 404 });
  const answer = await people<string>('SharedSummaryPdf', { id });
  if (!answer.ok) return new Response(null, { status: status(answer.code) });
  return pdf(answer.data, 'people-summary.pdf');
}
