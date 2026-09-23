import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Where a webhook may be sent, checked where it matters: at the socket.
 *
 * A tenant supplies the URL, so this is an SSRF boundary. Checking the
 * hostname when the endpoint is registered is not enough — DNS can answer a
 * public address on Monday and 169.254.169.254 on Tuesday. So every delivery
 * resolves the name again, refuses if *any* answer is non-public, and then
 * connects to exactly the address it checked (a pinned `lookup`), with SNI
 * and Host still the original hostname so TLS verifies as normal.
 *
 * Redirects are never followed: a 3xx is an unsuccessful delivery. Following
 * one would be a second, unvetted destination.
 */

// Two lists, not one: node's BlockList matches an IPv4 address against an
// IPv6 `::ffff:0:0/96` rule, which would refuse every public IPv4 address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0', 96], // IPv4-mapped: refused whole, rather than trusting the v4 inside
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (ULA)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return family === 4 ? !blockedV4.check(address, 'ipv4') : !blockedV6.check(address, 'ipv6');
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export const systemResolver: Resolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export interface EgressPolicy {
  readonly resolve: Resolver;
  /** Plain http, for local development only. Never set in production. */
  readonly allowHttp?: boolean;
  /** Injected in tests that need a reachable local receiver; defaults to the real check. */
  readonly isAllowed?: (address: string) => boolean;
}

export interface VettedTarget {
  readonly url: URL;
  readonly address: string;
  readonly family: number;
}

const refuse = (message: string) => err(failure('BAD_WEBHOOK_URL', message, ['url']));

/** Parse, resolve and check. Every resolved address must be public, not just one. */
export async function vet(value: string, policy: EgressPolicy): Promise<Result<VettedTarget>> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse('Not a URL');
  }
  const schemeOk =
    url.protocol === 'https:' || (policy.allowHttp === true && url.protocol === 'http:');
  if (!schemeOk) return refuse('A webhook URL is https');
  if (url.username !== '' || url.password !== '')
    return refuse('A webhook URL carries no credentials');

  const allowed = policy.isAllowed ?? isPublicAddress;
  const host = url.hostname.replace(/^\[|\]$/g, '');

  let answers: readonly ResolvedAddress[];
  if (isIP(host) !== 0) {
    answers = [{ address: host, family: isIP(host) }];
  } else {
    try {
      answers = await policy.resolve(host);
    } catch {
      return refuse(`${host} does not resolve`);
    }
  }

  const first = answers[0];
  if (first === undefined) return refuse(`${host} does not resolve`);
  if (answers.some((a) => !allowed(a.address))) {
    return refuse(`${host} resolves to an address that is not on the public internet`);
  }
  return ok({ url, address: first.address, family: first.family });
}

export type Poster = (
  url: string,
  request: { readonly headers: Record<string, string>; readonly body: string },
) => Promise<{ readonly status: number }>;

/**
 * POST to a vetted, pinned address.
 *
 * The `lookup` hands the socket the address `vet` just checked, whatever DNS
 * would say a second time. Node's http client does not follow redirects, so
 * a 3xx comes back as a status and is treated as a failed attempt.
 */
export function pinnedPoster(policy: EgressPolicy, timeoutMs = 10_000): Poster {
  return async (value, { headers, body }) => {
    const target = await vet(value, policy);
    if (!target.ok) throw new Error(target.error.message);
    const { url, address, family } = target.value;

    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };

    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
          lookup,
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on('timeout', () => req.destroy(new Error('webhook timed out')));
      req.on('error', reject);
      req.end(body);
    });
  };
}
