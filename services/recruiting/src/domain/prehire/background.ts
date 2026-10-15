import type { LaunchCountry } from '@kithena/contracts';

/**
 * When a background check may start (PRD §17.2). Only after a conditional
 * offer, everywhere: in the US that is the fair-chance rule (California, New
 * York City and others), and nowhere is it a screening step. In Germany and
 * Spain a criminal-record check is lawful only where a law requires it for
 * the role, which Recruiting cannot know, so it is refused there and done
 * outside Kithena when a law applies.
 */
const AFTER_OFFER: ReadonlySet<LaunchCountry> = new Set(['US', 'GB', 'IN']);

export function mayStartBackgroundCheck(
  country: LaunchCountry,
  offerAccepted: boolean,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'after_offer' | 'not_lawful' } {
  if (!AFTER_OFFER.has(country)) return { ok: false, reason: 'not_lawful' };
  return offerAccepted ? { ok: true } : { ok: false, reason: 'after_offer' };
}
