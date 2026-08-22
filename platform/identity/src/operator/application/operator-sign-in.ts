import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import { admitOperator, OPERATOR_ABSOLUTE_SECONDS, type Operator } from '../domain/operator.js';

/**
 * Signing in to the back-office.
 *
 * The same two questions as an employee's sign-in, asked of a different
 * population. The passkey answers who the human is; `findOperator` answers
 * whether that human runs this. A perfectly valid passkey belonging to an
 * employee finds no operator and is refused — which matters, because the
 * credential table is deliberately shared and one person may legitimately hold
 * both roles.
 *
 * The verification itself is the credential slice's, supplied rather than
 * imported: `no-cross-slice-imports` forbids the import, and the port is what
 * lets this be driven with a stub.
 */
export interface OperatorSignInDeps {
  /** Verify an assertion against the back-office relying party. Returns the identity. */
  readonly verify: (request: {
    response: unknown;
    origin: string;
    challenge: string;
  }) => Promise<Result<{ identityId: string }>>;
  readonly findOperator: (identityId: string) => Promise<Operator | null>;
  readonly startSession: (operatorId: string, expiresAt: string) => Promise<string>;
  readonly clock: Clock;
  readonly onRefusal?: (reason: string) => void;
}

const Refused = failure('OPERATOR_SIGN_IN_FAILED', 'Could not sign in');

export type OperatorSignIn = (request: {
  response: unknown;
  origin: string;
  challenge: string;
}) => Promise<Result<{ sessionId: string; operatorId: string; expiresAt: string }>>;

export function operatorSignIn(deps: OperatorSignInDeps): OperatorSignIn {
  const refuse = (reason: string): Result<never> => {
    deps.onRefusal?.(reason);
    return err(Refused);
  };

  return async (request) => {
    const verified = await deps.verify(request);
    if (!verified.ok) return refuse('credential');

    const operator = await deps.findOperator(verified.value.identityId);
    // Indistinguishable from a bad passkey. Otherwise anyone holding one could
    // ask whether a given person runs the back-office, which is a shortlist
    // worth having if you intend to phish somebody.
    if (!operator) return refuse('not-an-operator');

    const admitted = admitOperator(operator);
    if (!admitted.ok) return refuse(`operator-${operator.status}`);

    const expiresAt = new Date(
      deps.clock.now().getTime() + OPERATOR_ABSOLUTE_SECONDS * 1000,
    ).toISOString();

    return ok({
      sessionId: await deps.startSession(operator.id, expiresAt),
      operatorId: operator.id,
      expiresAt,
    });
  };
}
