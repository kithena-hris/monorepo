import { people } from '../../../../lib/people';

/**
 * The import template (V6, "Template"), as a file the browser saves: the
 * header row of the fields the person signed in may import, as People
 * answers it. HR's alone, as importing is; anybody else gets the 403 People
 * gave, and nothing is written anywhere.
 */
export async function GET(): Promise<Response> {
  const answer = await people<string>('ImportTemplate');
  if (!answer.ok) {
    return new Response(null, {
      status:
        answer.code === 'UNAUTHENTICATED' ? 401 : answer.code === 'FORBIDDEN' ? 403 : 404,
    });
  }
  return new Response(answer.data, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="people-import-template.csv"',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
