'use server';

import { recruiting } from '../../../lib/people';
import type { OperationName } from '../../../lib/recruiting-operations';

/**
 * What the Recruiting screens' buttons do (REC-070): one server action that
 * sends one of Recruiting's writes through the router as the person signed
 * in. The browser names which write from the list below and its arguments;
 * the router accepts only the persisted operations, and Recruiting checks
 * every argument and decides whether this person may, as for any client.
 */

export type Done =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly message: string; readonly code?: string };

const WRITES = new Set<OperationName>([
  'SaveRequisition',
  'SubmitRequisition',
  'DecideRequisition',
  'CancelRequisition',
  'CreateJob',
  'SaveJobDetails',
  'SetJobTeam',
  'SetJobStages',
  'SaveJobForm',
  'SaveJobAd',
  'SetJobCriteria',
  'SetJobPlan',
  'MoveJob',
  'PublishJob',
  'UnpublishJob',
  'AddCandidate',
  'Refer',
  'ApplyInternally',
  'MoveApplication',
  'UndoMove',
  'CorrectMove',
  'RejectApplication',
  'BulkApplications',
  'SendMessage',
  'AddNote',
  'SavePool',
  'AddToPool',
  'ScheduleInterview',
  'SelfScheduleLink',
  'SaveRecruitingWorkingHours',
  'ParseCv',
  'SetInterviewState',
  'SaveScorecard',
  'DecideApplication',
  'RequestReference',
  'ComposeOffer',
  'SubmitOffer',
  'DecideOffer',
  'SendOffer',
  'WithdrawOffer',
  'UploadSignedContract',
  'DecideCondition',
  'CancelPrehire',
  'PresentToWorksCouncil',
  'WorksCouncilDecides',
  'SaveRecruitingSettings',
  'SaveEntity',
  'SaveLocation',
  'SavePipeline',
  'SaveChain',
  'SaveQuestionnaire',
  'ConsentQuestionnaire',
  'SaveScorecardTemplate',
  'SaveTemplate',
  'SaveBenefit',
  'SavePayBand',
  'SaveAgency',
  'PlaceHold',
  'DeleteCandidate',
  'Chart',
  // Reads a screen asks for after it has drawn: free slots, the debrief.
  'RecruitingSlots',
  'RecruitingWorkingHours',
  'RecruitingParsedProfile',
  'RecruitingDebrief',
  'RecruitingExport',
  'RecruitingCandidates',
]);

export async function recruitingAct(
  name: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<Done> {
  if (!WRITES.has(name as OperationName))
    return { ok: false, message: 'Not something this page can do' };
  const answer = await recruiting<unknown>(name as OperationName, { ...variables });
  return answer.ok
    ? { ok: true, data: answer.data }
    : { ok: false, message: answer.message, code: answer.code };
}
