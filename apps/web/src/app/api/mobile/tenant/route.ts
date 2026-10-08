import { NextResponse } from 'next/server';

import { currentTenant } from '../../../../lib/branding';

/**
 * The company at this hostname, as its sign-in page shows it: what the phone
 * app checks a typed address against, and draws above its sign-in button.
 *
 * Nothing the public `/login` page does not already show. An address that is
 * not a company never reaches here — `proxy.ts` answers 404 first, the same
 * 404 as for any other path.
 */
export async function GET(): Promise<Response> {
  const tenant = await currentTenant();
  if (tenant === null) return new NextResponse(null, { status: 404 });

  return NextResponse.json({
    slug: tenant.slug,
    displayName: tenant.branding.displayName,
    logoUrl: tenant.branding.logoUrl,
  });
}
