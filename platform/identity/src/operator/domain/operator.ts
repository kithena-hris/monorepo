import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

/**
 * Whoever runs the back-office.
 *
 * Deliberately stricter than an employee, and the reasons are all the same
 * reason: this is the only population that can see across tenants, so every
 * argument for being accommodating elsewhere is an argument for being
 * unaccommodating here.
 *
 * `docs/auth-administration.md` sets the policy — hardware-bound passkeys only,
 * no password, no OTP, no consumer identity provider, and none of it
 * configurable. The back-office population is small, salaried and equipped;
 * there is nobody to accommodate.
 */
export type OperatorStatus = 'invited' | 'active' | 'suspended';

export interface Operator {
  readonly id: string;
  readonly identityId: string;
  readonly email: string;
  readonly status: OperatorStatus;
}

export interface OperatorSession {
  readonly id: string;
  readonly operatorId: string;
  readonly startedAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

/**
 * An hour idle, a working day absolute.
 *
 * An employee gets thirty days because they are on a phone in a warehouse and
 * being logged out mid-shift is a real cost. An operator is at a desk, so the
 * only thing a long session buys is a longer window for somebody else to use
 * their laptop.
 */
export const OPERATOR_IDLE_SECONDS = 60 * 60;
export const OPERATOR_ABSOLUTE_SECONDS = 8 * 60 * 60;

const Refused = failure('OPERATOR_UNAUTHENTICATED', 'Not signed in');

/** Whether this operator may hold a session at all. */
export function admitOperator(operator: Operator): Result<Operator> {
  // `invited` is not a state that may sign in. Somebody who has been named but
  // has not enrolled has no credential, so reaching here with one means
  // something is wrong rather than merely incomplete.
  return operator.status === 'active' ? ok(operator) : err(Refused);
}

/**
 * Whether a session is still live, and why not if it is not.
 *
 * Both limits, checked separately. Idle is what ends a forgotten tab; absolute
 * is what ends a session nobody is going to think about again, and activity
 * must not extend it — a session that renews itself forever is a credential.
 */
export function admitOperatorSession(
  session: OperatorSession,
  clock: Clock,
): Result<OperatorSession> {
  if (session.revokedAt !== null) return err(Refused);

  const now = clock.now().getTime();
  if (now >= Date.parse(session.expiresAt)) return err(Refused);

  const idleFor = (now - Date.parse(session.lastSeenAt)) / 1000;
  if (idleFor > OPERATOR_IDLE_SECONDS) return err(Refused);

  return ok(session);
}
