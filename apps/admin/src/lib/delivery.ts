/**
 * What became of an invitation's email, in words an operator can act on.
 *
 * Shared by the two places that invite somebody — the new-company wizard and
 * the company page — because they have to say the same thing. An operator who
 * learns that "not sent" means one thing on one screen and something else on
 * another stops reading either.
 *
 * Deliberately not `server-only`: both callers are client components, and there
 * is nothing here but a lookup table.
 */
export interface Delivery {
  readonly delivered: boolean;
  readonly messageId: string | null;
  readonly reason: string | null;
}

const WHY: Record<string, string> = {
  no_messaging_service: 'No messaging service is configured in this environment.',
  unreachable: 'The messaging service did not respond.',
  address: 'The address was refused before anything was sent.',
  provider: 'The email provider refused the message.',
  untrusted_link: 'The enrolment link did not point at the auth origin.',
  link_unbuildable: 'The enrolment link could not be built.',
};

/**
 * Why a failed send is not a failed invitation.
 *
 * The account exists and the link works whether or not the message arrived, so
 * showing this as an error would be a lie that makes an operator repeat an
 * action that already succeeded. It is a success with a caveat, and the caveat
 * is actionable: you are the channel now, and the link is right there.
 */
export function deliveryNote(delivery: Delivery): {
  tone: 'success' | 'warning';
  text: string;
} {
  if (delivery.delivered) return { tone: 'success', text: 'Emailed.' };
  return {
    tone: 'warning',
    text: `${WHY[delivery.reason ?? ''] ?? 'The message was not sent.'} Send them the link yourself.`,
  };
}
