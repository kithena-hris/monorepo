import type { StageCategory } from '@kithena/contracts';

import { categoryRank } from '../application/pipeline.js';

/**
 * Who may do what in Recruiting (PRD §25, REC-034).
 *
 * Decided by the domain over Recruiting's own rows — the tenant's
 * administrators, each job's hiring team, an approval's approvers, a German
 * entity's works council — for every transport, in the application layer.
 * Documents' reasoning (`docs/tech-stack.md`): nothing here is a graph that
 * OpenFGA would answer better, and a second copy of the hiring team as
 * tuples is a copy to keep in step. The one graph fact, the internal
 * applicant's manager, comes from the member projection.
 */

export type TeamRole = 'recruiter' | 'hiring_manager' | 'interviewer' | 'coordinator';

export interface Viewer {
  readonly personId: string | null;
  readonly accountId: string;
  readonly admin: boolean;
  /** A separate grant: the fairness dashboard (PRD §22.6). */
  readonly fairness: boolean;
}

export interface JobFacts {
  readonly id: string;
  readonly team: readonly { readonly personId: string; readonly role: TeamRole }[];
  readonly confidential: boolean;
}

export type Permission =
  | 'job.view'
  | 'job.edit'
  | 'job.publish'
  | 'pipeline.view'
  | 'pipeline.move'
  | 'candidate.profile'
  | 'candidate.cv'
  | 'candidate.message'
  | 'notes.view'
  | 'scorecards.all'
  | 'interview.schedule'
  | 'offer.view'
  | 'offer.edit'
  | 'decide';

const BY_ROLE: Readonly<Record<TeamRole, readonly Permission[]>> = {
  recruiter: [
    'job.view',
    'job.edit',
    'job.publish',
    'pipeline.view',
    'pipeline.move',
    'candidate.profile',
    'candidate.cv',
    'candidate.message',
    'notes.view',
    'scorecards.all',
    'interview.schedule',
    'offer.view',
    'offer.edit',
  ],
  hiring_manager: [
    'job.view',
    'pipeline.view',
    'pipeline.move',
    'candidate.profile',
    'candidate.cv',
    'notes.view',
    'scorecards.all',
    'offer.view',
    'decide',
  ],
  // An interviewer sees the kit, the CV and their own scorecard (scorecards are filtered by `visibleScorecards`).
  interviewer: ['job.view', 'candidate.cv'],
  coordinator: ['job.view', 'pipeline.view', 'interview.schedule'],
};

export const ALL: readonly Permission[] = BY_ROLE.recruiter.concat(['decide']);

export function rolesOn(viewer: Viewer, job: JobFacts): TeamRole[] {
  if (viewer.personId === null) return [];
  return job.team.filter((t) => t.personId === viewer.personId).map((t) => t.role);
}

export function jobPermissions(viewer: Viewer, job: JobFacts): ReadonlySet<Permission> {
  if (viewer.admin) return new Set(ALL);
  return new Set(rolesOn(viewer, job).flatMap((role) => BY_ROLE[role]));
}

export const may = (viewer: Viewer, job: JobFacts, permission: Permission): boolean =>
  jobPermissions(viewer, job).has(permission);

export interface ApplicationFacts {
  readonly candidatePersonId: string | null;
  /** The furthest category reached, for the internal applicant rule. */
  readonly reached: StageCategory;
  /** The interviewers on this application's interviews. */
  readonly interviewerIds: readonly string[];
}

export interface TenantRules {
  /** An internal applicant is shown to their own manager from this category on (default `offer`). */
  readonly revealInternalAt: StageCategory;
  managerOf(personId: string): string | null;
}

/**
 * Whether the viewer may see this application at all (PRD §25): an
 * interviewer only the ones they interview; an internal applicant's own
 * manager not until the named stage, whatever role they hold on the job —
 * applying internally must not cost anyone their standing.
 */
export function maySeeApplication(
  viewer: Viewer,
  job: JobFacts,
  app: ApplicationFacts,
  rules: TenantRules,
): boolean {
  if (viewer.personId !== null && app.candidatePersonId !== null) {
    if (viewer.personId === app.candidatePersonId) return false;
    const manager = rules.managerOf(app.candidatePersonId);
    if (
      manager === viewer.personId &&
      categoryRank(app.reached) < categoryRank(rules.revealInternalAt) &&
      !viewer.admin
    )
      return false;
  }
  if (viewer.admin) return true;
  const roles = rolesOn(viewer, job);
  if (roles.some((r) => r !== 'interviewer')) return true;
  return (
    roles.includes('interviewer') &&
    viewer.personId !== null &&
    app.interviewerIds.includes(viewer.personId)
  );
}

/** Offers and pay: recruiters, the hiring manager, approvers and admins only (PRD §25). */
export function maySeeOffer(
  viewer: Viewer,
  job: JobFacts,
  approverIds: readonly string[],
): boolean {
  return (
    may(viewer, job, 'offer.view') ||
    (viewer.personId !== null && approverIds.includes(viewer.personId))
  );
}

/** A works council member sees the candidate presented for that job, read-only (PRD §19.9). */
export function worksCouncilMay(
  viewerPersonId: string | null,
  councilIds: readonly string[],
  presented: boolean,
): boolean {
  return viewerPersonId !== null && presented && councilIds.includes(viewerPersonId);
}

/** An agency sees its own submissions' stages, nothing else (PRD §9.4). */
export const agencyMay = (agencyId: string, submittedBy: string | null): boolean =>
  submittedBy === agencyId;

/** Every member: the internal board, refer, apply internally. Not a confidential job. */
export const memberMaySeeOnBoard = (job: JobFacts & { readonly internalBoard: boolean }): boolean =>
  job.internalBoard && !job.confidential;
