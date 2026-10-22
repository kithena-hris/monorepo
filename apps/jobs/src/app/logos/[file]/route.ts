/**
 * `/logos/<hash>.<png|jpg|webp>`: a company's logo as Recruiting keeps it,
 * served from Kithena Jobs so a careers page, a job and an email all show it
 * from one public address. Named by its own hash, so cached for good.
 */

const NAME = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/u;
const base = () =>
  (process.env['RECRUITING_PUBLIC_URL'] ?? 'http://localhost:4005').replace(/\/$/u, '');

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  if (!NAME.test(file)) return new Response('Not found', { status: 404 });
  const answer = await fetch(`${base()}/v1/recruiting/logos/${file}`, {
    next: { revalidate: 31_536_000 },
  });
  if (!answer.ok) return new Response('Not found', { status: 404 });
  return new Response(await answer.arrayBuffer(), {
    headers: {
      'content-type': answer.headers.get('content-type') ?? 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
