'use server';

import { contractText, contractTitle } from '../../../lib/contract-text';
import { documents, recruiting } from '../../../lib/people';
import type { OperationName } from '../../../lib/recruiting-operations';
import { signingOrigin } from '../../../lib/signing-origin';

/**
 * What the Recruiting screens' buttons do (REC-070): one server action that
 * sends one of Recruiting's writes through the router as the person signed
 * in. The browser names which write from the list below and its arguments;
 * the router accepts only the persisted operations, and Recruiting checks
 * every argument and decides whether this person may, as for any client.
 *
 * One button crosses modules: `SendContract` (PRD §21.2, §28). The shell
 * composes it here, as the person signed in: the accepted offer's terms are
 * read from Recruiting, drawn as a PDF and sent to sign by Documents with
 * the contract's `subjectRef`, and Recruiting is told the contract is out.
 * Documents' `envelope.completed` then signs it in Recruiting on its own.
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
  'ProposeSlots',
  'RequestInformation',
  'CloseAsk',
  'AssessJob',
  'SaveRecruitingWorkingHours',
  'ParseCv',
  'AssessMatrix',
  'SummariseDebrief',
  'DraftEmail',
  'AskForChart',
  'Rediscover',
  'DraftAd',
  'ExplainAdPhrase',
  'TranslateAd',
  'SuggestKitQuestions',
  'AgreeWithFinding',
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
  'SaveOrgUnit',
  'RemoveEntity',
  'RemoveLocation',
  'RemoveOrgUnit',
  'RemovePipeline',
  'RemoveChain',
  'RemoveQuestionnaire',
  'RemoveScorecardTemplate',
  'RemoveTemplate',
  'RemoveBenefit',
  'RemovePayBand',
  'RecruitingSettingsInWords',
  'SetCareersDomain',
  'CheckCareersDomain',
  'RemoveCareersDomain',
  'PlaceHold',
  'DeleteCandidate',
  'Chart',
  // Reads a screen asks for after it has drawn: free slots, the debrief.
  'RecruitingSlots',
  'RecruitingWorkingHours',
  'RecruitingParsedProfile',
  'RecruitingFairness',
  'RecruitingDebrief',
  'RecruitingExport',
  'RecruitingCandidates',
]);

export async function recruitingAct(
  name: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<Done> {
  if (name === 'SendContract') {
    const offerId = variables['offerId'];
    return sendContract(typeof offerId === 'string' ? offerId : '');
  }
  if (!WRITES.has(name as OperationName))
    return { ok: false, message: 'Not something this page can do' };
  const answer = await recruiting<unknown>(name as OperationName, { ...variables });
  return answer.ok
    ? { ok: true, data: answer.data }
    : { ok: false, message: answer.message, code: answer.code };
}

type OfferScreen = Parameters<typeof contractText>[0] & {
  readonly offer: { readonly id: string; readonly acceptance: { readonly version: number } | null };
  readonly candidate: { readonly name: string; readonly email: string };
  readonly contract: { readonly route: string; readonly state: string } | null;
  readonly signatoryPersonId: string | null;
};

/**
 * The contract, filed and sent: the candidate signs first with the emailed
 * code, then whoever pressed the button for the company. Answers Documents'
 * document id, which the screen opens.
 */
async function sendContract(offerId: string): Promise<Done> {
  const read = await recruiting<OfferScreen>('RecruitingOffer', { offerId });
  if (!read.ok) return { ok: false, message: read.message, code: read.code };
  const o = read.data;
  if (o.contract === null || o.contract.route !== 'documents' || o.offer.acceptance === null) {
    return { ok: false, message: 'This contract is not signed through Documents' };
  }
  if (o.contract.state !== 'generated') {
    return { ok: false, message: 'This contract has already been sent' };
  }
  const { origin, companyName } = await signingOrigin();
  const filed = await documents<{ readonly id: string; readonly envelopeId: string | null }>(
    'FileDraft',
    {
      input: {
        title: contractTitle(o),
        typeKey: null,
        aboutPersonId: null,
        body: contractText(o, companyName),
        signers: [
          { personId: null, email: o.candidate.email, name: o.candidate.name, order: 1 },
          { personId: o.signatoryPersonId, email: null, name: companyName, order: 2 },
        ].filter((s) => s.personId !== null || s.email !== ''),
        send: true,
        subjectRef: `recruiting:offer:${o.offer.id}:${String(o.offer.acceptance.version)}`,
        origin,
        companyName,
      },
    },
  );
  if (!filed.ok) return { ok: false, message: filed.message, code: filed.code };
  const told = await recruiting<unknown>('ContractSent', { offerId });
  if (!told.ok) return { ok: false, message: told.message, code: told.code };
  return { ok: true, data: filed.data };
}
