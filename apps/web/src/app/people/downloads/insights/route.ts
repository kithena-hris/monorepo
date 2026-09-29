import { people } from '../../../../lib/people';

/**
 * One Insights tab as a CSV the browser saves (V7, "Export"): the numbers of
 * the tab and segment on screen, as People answers them for the person
 * signed in — the same charts, the same cohort minimum, nothing per person.
 * `?tab=` is one of the four tabs; `?segment=` a saved segment's id.
 */

const TABS = new Set(['headcount', 'turnover', 'data-quality', 'pay']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const tab = query.get('tab') ?? 'headcount';
  const segment = query.get('segment');
  if (!TABS.has(tab) || (segment !== null && !UUID.test(segment))) {
    return new Response(null, { status: 404 });
  }
  const answer = await people<string>('AnalyticsExport', { tab, segment });
  if (!answer.ok) {
    return new Response(null, {
      status:
        answer.code === 'UNAUTHENTICATED' ? 401 : answer.code === 'FORBIDDEN' ? 403 : 404,
    });
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(answer.data, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="insights-${tab}-${day}.csv"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
