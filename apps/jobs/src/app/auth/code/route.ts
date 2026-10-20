import { NextResponse, type NextRequest } from 'next/server';

import { accountCall } from '../../../lib/account';

/** Email a sign-in code to an address, making the account if there is none. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const input = (await request.json().catch(() => null)) as {
    email?: unknown;
    name?: unknown;
  } | null;
  const email = typeof input?.email === 'string' ? input.email.trim() : '';
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!email.includes('@'))
    return NextResponse.json({ error: { message: 'Check the address' } }, { status: 400 });
  const answer = await accountCall<{ sent: true; code?: string }>('/code', {
    method: 'POST',
    body: { email, name },
    token: '',
  });
  return answer.ok
    ? NextResponse.json({ sent: true })
    : NextResponse.json({ error: { message: answer.message } }, { status: answer.status });
}
