import { company } from '../../../lib/api';
import { feed } from '../../../lib/structured';

/** `/feeds/<company>.xml`: the open XML feed aggregators read (REC-062). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const slug = (await params).file.replace(/\.xml$/u, '');
  const answer = await company(slug);
  if (!answer.ok) return new Response('Not found', { status: 404 });
  return new Response(
    feed(process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com', answer.data.jobs),
    {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    },
  );
}
