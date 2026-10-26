'use server';

import { contractText, contractTitle } from '../../../lib/contract-text';
import { documents, people, recruiting } from '../../../lib/people';
import type { OperationName } from '../../../lib/recruiting-operations';
import { signingOrigin } from '../../../lib/signing-origin';
import { serverWords } from '../../../lib/server-words';

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
  'SaveJobTerms',
  'RecruitingTermsCatalogue',
  'SuggestJobPay',
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
  'DraftAgenda',
  'RequestInformation',
  'CloseAsk',
  'BookFromAsk',
  'RequestMoreTimes',
  'DisconnectRecruitingCalendar',
  'ConnectRecruitingCalendar',
  'SaveRecruitingMyNotifications',
  'AssessJob',
  'PreviewEmail',
  'SendStageExpectations',
  'SeedEmailTemplates',
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
  'ArchiveJob',
  'UnarchiveJob',
  'DeleteJob',
  'SetInterviewLink',
  'SaveScorecard',
  'DecideApplication',
  'RequestReference',
  'ComposeOffer',
  'SubmitOffer',
  'DecideOffer',
  'SendOffer',
  'WithdrawOffer',
  'PrepareOffer',
  'SaveAgreement',
  'RemoveAgreement',
  'UploadSignedContract',
  'ReviseContract',
  'DecideCondition',
  'CancelPrehire',
  'PresentToWorksCouncil',
  'WorksCouncilDecides',
  'SaveRecruitingSettings',
  'UploadCompanyLogo',
  'DescribeCompany',
  'SaveEntity',
  'SaveLocation',
  'SavePipeline',
  'SaveChain',
  'SaveQuestionnaire',
  'ConsentQuestionnaire',
  'SaveScorecardTemplate',
  'SaveTemplate',
  'SaveBenefit',
  'SaveBenefitCategory',
  'RemoveBenefitCategory',
  'RestoreBenefitLibrary',
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
  // Reads a screen asks for after it has drawn: free slots, the debrief, my calendars and emails,
  // and a new job's own screen, read while its first page is still being answered.
  'RecruitingJob',
  'RecruitingSlots',
  'RecruitingConnections',
  'RecruitingMyNotifications',
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
  const t = await serverWords();
  if (name === 'SendContract') {
    const offerId = variables['offerId'];
    return sendContract(typeof offerId === 'string' ? offerId : '', textOf(variables));
  }
  if (name === 'DraftContract') return draftContract(variables);
  if (name === 'PreviewContract') return previewContract(variables);
  if (name === 'HireAccount') return hireAccount(variables);
  if (name === 'StartContractUpload') return startContractUpload(variables);
  if (name === 'SendOwnContract') return sendOwnContract(variables);
  if (!WRITES.has(name as OperationName))
    return {
      ok: false,
      message: t(
        'app.app.recruiting.actions.not_something_this_page_can_do',
        'Not something this page can do',
      ),
    };
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

/** The contract HR checked and edited, as the screen sends it; null for the one drawn from the terms. */
function textOf(
  variables: Readonly<Record<string, unknown>>,
): { readonly title: string; readonly body: string } | null {
  const title = variables['title'];
  const body = variables['body'];
  return typeof title === 'string' && typeof body === 'string' && body.trim() !== ''
    ? { title: title.trim(), body }
    : null;
}

/** A draft still asking somebody to confirm a fact is not a contract yet. */
const UNCONFIRMED = /\[\[TO CONFIRM:/u;

interface Particular {
  readonly key: string;
  readonly law: string;
  readonly value: string | null;
}

/**
 * The contract, drafted: Recruiting writes it from the accepted offer and
 * the statutory particulars of the entity's country (`draftContract`). With
 * the writer off, the contract is drawn from the accepted terms here
 * (`contractText`), and the particulars still come back for HR to check.
 */
async function draftContract(variables: Readonly<Record<string, unknown>>): Promise<Done> {
  const t = await serverWords();
  const offerId = typeof variables['offerId'] === 'string' ? variables['offerId'] : '';
  const read = await recruiting<OfferScreen>('RecruitingOffer', { offerId });
  if (!read.ok) return { ok: false, message: read.message, code: read.code };
  const drafted = await recruiting<{
    readonly particulars: readonly Particular[];
    readonly draft: {
      readonly title: string;
      readonly body: string;
      readonly toConfirm: readonly string[];
      readonly figures: readonly string[];
    } | null;
  }>('DraftContract', { offerId });
  if (!drafted.ok) return { ok: false, message: drafted.message, code: drafted.code };
  const { companyName } = await signingOrigin();
  const draft = drafted.data.draft ?? {
    title: contractTitle(read.data, t),
    body: contractText(read.data, companyName, t, t.language),
    toConfirm: [],
    figures: [],
  };
  return {
    ok: true,
    data: {
      ai: drafted.data.draft !== null,
      particulars: drafted.data.particulars,
      ...draft,
      signers: [
        { name: read.data.candidate.name, order: 1, who: 'candidate' },
        { name: companyName, order: 2, who: 'company' },
      ],
    },
  };
}

/** The contract drawn as Documents would file it, with each signer's line, to read before sending. */
async function previewContract(variables: Readonly<Record<string, unknown>>): Promise<Done> {
  const t = await serverWords();
  const text = textOf(variables);
  const offerId = typeof variables['offerId'] === 'string' ? variables['offerId'] : '';
  if (text === null)
    return {
      ok: false,
      message: t('app.app.recruiting.actions.write_the_contract_first', 'Write the contract first'),
    };
  const read = await recruiting<OfferScreen>('RecruitingOffer', { offerId });
  if (!read.ok) return { ok: false, message: read.message, code: read.code };
  const { companyName } = await signingOrigin();
  const drawn = await documents<{ readonly base64: string; readonly mediaType: string }>(
    'PreviewDraft',
    {
      input: {
        title: text.title,
        body: text.body,
        signers: [
          { name: read.data.candidate.name, order: 1 },
          { name: companyName, order: 2 },
        ],
      },
    },
  );
  return drawn.ok
    ? { ok: true, data: drawn.data }
    : { ok: false, message: drawn.message, code: drawn.code };
}

/** Where the hire stands with their account at the company, by the email they applied with. */
async function hireAccount(variables: Readonly<Record<string, unknown>>): Promise<Done> {
  const email = typeof variables['email'] === 'string' ? variables['email'] : '';
  // `people` answers the one root field itself.
  const found = await people<unknown>('PersonInvitation', { email });
  return found.ok
    ? { ok: true, data: found.data ?? null }
    : { ok: false, message: found.message, code: found.code };
}

/**
 * The contract, filed and sent: the candidate signs first with the emailed
 * code, then whoever pressed the button for the company, each initialling
 * every page before the last. Answers Documents' document id, which the
 * screen opens. The text is the one HR checked on the screen, or, without
 * one, the contract drawn from the accepted terms.
 */
async function sendContract(
  offerId: string,
  text: { readonly title: string; readonly body: string } | null = null,
): Promise<Done> {
  const t = await serverWords();
  const read = await recruiting<OfferScreen>('RecruitingOffer', { offerId });
  if (!read.ok) return { ok: false, message: read.message, code: read.code };
  const o = read.data;
  if (o.contract === null || o.contract.route !== 'documents' || o.offer.acceptance === null) {
    return {
      ok: false,
      message: t(
        'app.app.recruiting.actions.this_contract_is_not_signed_through_documents',
        'This contract is not signed through Documents',
      ),
    };
  }
  if (o.contract.state !== 'generated') {
    return {
      ok: false,
      message: t(
        'app.app.recruiting.actions.this_contract_has_already_been_sent',
        'This contract has already been sent',
      ),
    };
  }
  if (text !== null && UNCONFIRMED.test(text.body))
    return {
      ok: false,
      message: t(
        'app.app.recruiting.actions.fill_in_every_fact_first',
        'Fill in every fact the contract still asks you to confirm before sending it',
      ),
    };
  const { origin, companyName } = await signingOrigin();
  const filed = await documents<{ readonly id: string; readonly envelopeId: string | null }>(
    'FileDraft',
    {
      input: {
        title: text === null || text.title === '' ? contractTitle(o, t) : text.title,
        typeKey: null,
        aboutPersonId: null,
        body: text?.body ?? contractText(o, companyName, t, t.language),
        initialEachPage: true,
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

/** Where the browser puts a contract HR wrote themselves: Documents' upload, as for any file. */
async function startContractUpload(variables: Readonly<Record<string, unknown>>): Promise<Done> {
  const t = await serverWords();
  const name = variables['name'];
  const size = variables['size'];
  if (
    typeof name !== 'string' ||
    typeof size !== 'number' ||
    variables['mediaType'] !== 'application/pdf'
  )
    return {
      ok: false,
      message: t('app.app.recruiting.actions.contract_must_be_a_pdf', 'The contract must be a PDF'),
    };
  const put = await documents<unknown>('StartDocumentsUpload', {
    input: { name, mediaType: 'application/pdf', size },
  });
  return put.ok
    ? { ok: true, data: put.data }
    : { ok: false, message: put.message, code: put.code };
}

/**
 * HR's own contract instead of the drawn one: the uploaded PDF is filed in
 * Documents and sent to sign in the same order (the candidate first, then
 * the company), with the same `subjectRef`, so the signature hires exactly
 * as the drawn contract's does. Documents places each signature beside the
 * signature lines the PDF already has.
 */
async function sendOwnContract(variables: Readonly<Record<string, unknown>>): Promise<Done> {
  const t = await serverWords();
  const offerId = typeof variables['offerId'] === 'string' ? variables['offerId'] : '';
  const upload = variables['upload'] as
    { readonly uploadId?: unknown; readonly name?: unknown } | undefined;
  if (typeof upload?.uploadId !== 'string' || typeof upload.name !== 'string')
    return {
      ok: false,
      message: t('app.app.recruiting.actions.choose_the_pdf', 'Choose the PDF first'),
    };
  const read = await recruiting<OfferScreen>('RecruitingOffer', { offerId });
  if (!read.ok) return { ok: false, message: read.message, code: read.code };
  const o = read.data;
  if (o.contract === null || o.contract.route !== 'documents' || o.offer.acceptance === null)
    return {
      ok: false,
      message: t(
        'app.app.recruiting.actions.this_contract_is_not_signed_through_documents',
        'This contract is not signed through Documents',
      ),
    };
  if (o.contract.state !== 'generated')
    return {
      ok: false,
      message: t(
        'app.app.recruiting.actions.this_contract_has_already_been_sent',
        'This contract has already been sent',
      ),
    };
  const { origin, companyName } = await signingOrigin();
  const filed = await documents<{ readonly id: string }>('UploadDocument', {
    input: {
      title: contractTitle(o, t),
      typeKey: null,
      subjectPersonId: null,
      sectionId: null,
      expiresOn: null,
      requestId: null,
      upload: { uploadId: upload.uploadId, name: upload.name, mediaType: 'application/pdf' },
    },
  });
  if (!filed.ok) return { ok: false, message: filed.message, code: filed.code };
  const sent = await documents<{ readonly id: string }>('SendForSignature', {
    documentId: filed.data.id,
    input: {
      signers: [
        {
          personId: null,
          email: o.candidate.email,
          name: o.candidate.name,
          order: 1,
          allowDelegate: false,
        },
        ...(o.signatoryPersonId === null
          ? []
          : [
              {
                personId: o.signatoryPersonId,
                email: null,
                name: companyName,
                order: 2,
                allowDelegate: false,
              },
            ]),
      ],
      fields: [],
      message: t(
        'app.app.recruiting.actions.your_contract_to_sign',
        'Your contract from {{company}}, to sign.',
        {
          company: companyName,
        },
      ),
      dueOn: null,
      subjectRef: `recruiting:offer:${o.offer.id}:${String(o.offer.acceptance.version)}`,
      origin,
      companyName,
    },
  });
  if (!sent.ok) return { ok: false, message: sent.message, code: sent.code };
  const told = await recruiting<unknown>('ContractSent', { offerId });
  if (!told.ok) return { ok: false, message: told.message, code: told.code };
  return { ok: true, data: { id: filed.data.id } };
}
