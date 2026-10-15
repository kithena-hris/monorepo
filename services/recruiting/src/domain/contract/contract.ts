import type { CalendarDate, ResolvedTerms } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The contract (Recruiting PRD §21.1, §21.2, REC-031).
 *
 * Generated when an offer is accepted, with the documents its pack requires.
 * Signed through Documents when the company has it; printed and signed by
 * hand where the law wants written form (a German fixed term); otherwise
 * uploaded signed and marked by a person.
 */

export type ContractState = 'generated' | 'out_for_signature' | 'signed' | 'voided';
export type SigningRoute = 'documents' | 'wet_ink' | 'upload';

export interface Contract {
  readonly id: string;
  readonly offerId: string;
  readonly offerVersion: number;
  readonly route: SigningRoute;
  readonly state: ContractState;
  /** `contract` plus each document the pack requires. */
  readonly documents: readonly string[];
  readonly packVersion: string;
  /** Documents' envelope, matched on `recruiting:offer:<id>:<version>` (PRD §21.2). */
  readonly subjectRef: string;
  readonly signedOn: CalendarDate | null;
  readonly signedBy: string | null;
}

export const subjectRefFor = (offerId: string, version: number): string =>
  `recruiting:offer:${offerId}:${String(version)}`;

/** Wet ink when the terms say so; Documents when present; otherwise an upload. */
export function signingRoute(terms: ResolvedTerms, documentsPresent: boolean): SigningRoute {
  if (terms.signature === 'wet_ink') return 'wet_ink';
  return documentsPresent ? 'documents' : 'upload';
}

export function generateContract(
  id: string,
  offerId: string,
  offerVersion: number,
  terms: ResolvedTerms,
  documentsPresent: boolean,
): Contract {
  return {
    id,
    offerId,
    offerVersion,
    route: signingRoute(terms, documentsPresent),
    state: 'generated',
    documents: ['contract', ...terms.documents.filter((d) => d !== 'contract')],
    packVersion: terms.packVersion,
    subjectRef: subjectRefFor(offerId, offerVersion),
    signedOn: null,
    signedBy: null,
  };
}

/**
 * Before the contract goes out, the terms are validated again for the start
 * date (PRD §21.1): a pack version that changed in between is shown.
 */
export function packChanged(contract: Contract, currentPackVersion: string): boolean {
  return contract.packVersion !== currentPackVersion;
}

export function sendForSignature(contract: Contract): Result<Contract> {
  if (contract.state !== 'generated')
    return err(failure('CONTRACT_STATE', 'Only a generated contract is sent'));
  if (contract.route !== 'documents')
    return err(failure('ROUTE', 'This contract is signed outside Kithena and uploaded'));
  return ok({ ...contract, state: 'out_for_signature' });
}

/** Documents' `envelope.completed`, matched on the subject reference. */
export function signedByEnvelope(
  contract: Contract,
  subjectRef: string,
  on: CalendarDate,
): Result<Contract> {
  if (subjectRef !== contract.subjectRef)
    return err(failure('NOT_THIS_CONTRACT', 'The envelope is for another offer'));
  if (contract.state !== 'out_for_signature')
    return err(failure('CONTRACT_STATE', 'This contract is not out for signature'));
  return ok({ ...contract, state: 'signed', signedOn: on, signedBy: 'documents' });
}

/**
 * A signed copy uploaded and marked by a person: the wet-ink route, or no
 * Documents. For wet ink the date is the second signature's (PRD §21.2).
 */
export function markSigned(
  contract: Contract,
  by: string,
  on: CalendarDate,
  start: CalendarDate,
): Result<Contract> {
  if (contract.state === 'signed' || contract.state === 'voided')
    return err(failure('CONTRACT_STATE', `This contract is ${contract.state}`));
  if (contract.route === 'documents')
    return err(failure('ROUTE', 'This contract is signed in Documents'));
  if (contract.route === 'wet_ink' && on > start) {
    return err(
      failure(
        'WRITTEN_FORM_LATE',
        'Written form must be complete before the start, or the fixed term is void (§ 14(4) TzBfG)',
      ),
    );
  }
  return ok({ ...contract, state: 'signed', signedOn: on, signedBy: by });
}

export function voidContract(contract: Contract): Result<Contract> {
  if (contract.state === 'signed')
    return err(failure('SIGNED', 'A signed contract is not voided; cancel the pre-hire'));
  return ok({ ...contract, state: 'voided' });
}
