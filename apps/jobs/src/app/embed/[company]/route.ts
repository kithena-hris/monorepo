import { company } from '../../../lib/api';
import { where } from '../../../lib/format';

/** What `embed.js` draws on a company's own site: its open jobs, already public, readable from any origin. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ company: string }> },
): Promise<Response> {
  const answer = await company((await params).company);
  if (!answer.ok)
    return Response.json(
      { jobs: [] },
      { status: 404, headers: { 'access-control-allow-origin': '*' } },
    );
  const origin = process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com';
  return Response.json(
    {
      jobs: answer.data.jobs.map((j) => ({
        title: j.title,
        where: where(j),
        url: `${origin}/${j.company.slug}/${j.slug}`,
      })),
    },
    { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } },
  );
}
