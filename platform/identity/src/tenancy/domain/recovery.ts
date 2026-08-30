import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Whether an account may be sent a fresh setup link.
 *
 * The counterpart of `mayInvite`, and it differs in exactly one state: an
 * `active` account is the *normal* case here and a refusal there. That is the
 * whole point — recovery exists for somebody who enrolled and then lost the
 * device, which is precisely the account `mayInvite` turns away with "use
 * recovery instead".
 *
 * Takes a `string` rather than the account slice's `AccountStatus` for the same
 * reason `mayInvite` does: `no-cross-slice-imports` forbids tenancy reaching
 * into `account/domain`, and re-declaring the union here would be a copy that
 * drifts the day a sixth state is added. An unrecognised state is refused,
 * which is the safe direction.
 */
export const RecoveryRefused = failure(
  'RECOVERY_REFUSED',
  'That account cannot be recovered this way',
);

export function mayRecover(status: string): Result<void> {
  switch (status) {
    // Enrolled, and lost the device. The case this exists for.
    case 'active':
    // Invited and never took it up: the old link is dead or lost, and asking
    // for another is the same request. Sending one is better than a refusal
    // that tells somebody to chase their HR team for a link they can have.
    case 'invited':
      return ok(undefined);
    // Commissioned but never invited. There is no address to recover *to* that
    // anybody has confirmed, and inventing one here would make recovery a way
    // to enrol an account nobody invited.
    case 'provisioned':
    // Being held, or gone. Neither is a lost passkey, and both are their HR
    // team's to resolve — a self-service path around a suspension would be a
    // way to undo one.
    case 'suspended':
    case 'terminated':
      return err(RecoveryRefused);
    default:
      return err(RecoveryRefused);
  }
}
