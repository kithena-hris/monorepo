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
  const envelope = await call<LinkEnvelope>(token, '');
  // The file comes through the page's own route (`./file`), fetched by the
  // viewer: the page itself carries no base64. `?v=` is the signer's state, so
  // the copy with their signature drawn in is fetched afresh after Finish.
  const url = envelope.ok
    ? `/sign/${encodeURIComponent(token)}/file?v=${encodeURIComponent(envelope.data.me?.status ?? envelope.data.status)}`
    : null;
  return (
    <SignByLink
      token={token}
      company={company}
      envelope={envelope.ok ? envelope.data : null}
      problem={envelope.ok ? null : envelope.message}
      fileUrl={url}
    />
  );
}
