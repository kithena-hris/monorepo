/**
 * What the onboarding form collected on the way in, as the event carries it.
 *
 * In `shared/` for the reason `person-name.ts` gives: enrolment asks for this
 * and the account publishes it, so it belongs to neither slice, and
 * `no-cross-slice-imports` is right to refuse the import that would otherwise
 * be needed.
 *
 * **`mobilePresent` rather than the number.** A mobile is contact data the
 * People module asks for itself, on its own form and under its own
 * classification. An event carrying a number to every consumer of the identity
 * stream — whether or not any of them needs it — is a phone number in one more
 * log, one more backup and one more subject access request. The boolean
 * answers the only question a consumer has here: is there a second channel on
 * file.
 *
 * The time zone is not in this shape because the account already holds it. The
 * row is written before the event is raised, so what the aggregate reads is the
 * zone the person just confirmed rather than the `Etc/UTC` an invitation
 * defaulted to.
 */
export interface CapturedProfile {
  readonly name: {
    readonly given: string;
    readonly family: string;
    readonly preferred: string | null;
  };
  readonly mobilePresent: boolean;
}
