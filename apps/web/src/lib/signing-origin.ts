import 'server-only';

import { headers } from 'next/headers';

import { currentTenant } from './branding';

/**
 * Where a signing link points and whose name is on the email: this company's
 * own host. Documents' writes that email somebody take it (K1–K10), and so does
 * the contract Recruiting's offer hands to Documents (Recruiting PRD §21.2).
 */
export async function signingOrigin(): Promise<{ origin: string; companyName: string }> {
  const inbound = await headers();
  const host = inbound.get('x-forwarded-host') ?? inbound.get('host') ?? 'localhost:3000';
  const proto =
    inbound.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const tenant = await currentTenant();
  return {
    origin: `${proto}://${host}`,
    companyName: tenant?.branding.displayName ?? tenant?.slug ?? host,
  };
}
