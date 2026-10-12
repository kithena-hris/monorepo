import { headers } from 'next/headers';
import type { JSX } from 'react';

import { call } from './actions';
import { SignByLink, type LinkEnvelope } from './sign-by-link';

/**
 * `/sign/<token>` (Documents K4–K6, X7): somebody outside the company signs
 * from the link in their email. No session: the token opens one request for
 * one signer, after an emailed code proves the mailbox is theirs.
 */
export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<JSX.Element> {
  const { token } = await params;
  const company = (await headers()).get('x-tenant-slug') ?? '';
  const [envelope, file] = await Promise.all([
    call<LinkEnvelope>(token, ''),
    call<{ url: string | null; base64: string | null; mediaType: string }>(token, '/file'),
  ]);
  const url = file.ok
    ? (file.data.url ?? `data:${file.data.mediaType};base64,${file.data.base64 ?? ''}`)
    : null;
  return (
    <SignByLink
      token={token}
      company={company}
      envelope={envelope.ok ? envelope.data : null}
      fileUrl={url}
    />
  );
}
