/**
 * Every GraphQL operation the tenant app sends Recruiting, through the router
 * (REC-070): Documents' rule (`documents-operations.ts`), for the fourth area.
 *
 * One query per screen and one mutation per write. Recruiting answers each
 * screen with its read model as one JSON value, so a query asks for the field
 * and nothing under it. The router's safelist is generated from this file
 * (`pnpm --filter @kithena/gateway persist`). A write's idempotency key is
 * `$key`; its `input` is the REST route's JSON body.
 *
 * Plain text, no `server-only`: the generator reads it too.
 */

const query = (name: string, field: string, params = '', args = '') =>
  `query ${name}${params === '' ? '' : `(${params})`} {
    ${field}${args === '' ? '' : `(${args})`}
  }`;

const write = (name: string, field: string, params = '', args = '', input = true) =>
  `mutation ${name}(${params}${input ? '$input: JSON!, ' : ''}$key: String!) {
    ${field}(${args}${input ? 'input: $input, ' : ''}idempotencyKey: $key)
  }`;

const ID = (n: string) => [`$${n}: String!, `, `${n}: $${n}, `] as const;
const two = (a: string, b: string) =>
  [`$${a}: String!, $${b}: String!, `, `${a}: $${a}, ${b}: $${b}, `] as const;

export const OPERATIONS = {
  /* ------------------------------------------------------------- screens -- */
  /** R1: my tasks and my jobs */
  RecruitingHome: query('RecruitingHome', 'recruitingHome'),
  /** R2 */
  RecruitingRequisitions: query('RecruitingRequisitions', 'recruitingRequisitions'),
  /** R4–R7, R14 */
  RecruitingJob: query('RecruitingJob', 'recruitingJob', '$jobId: String!', 'jobId: $jobId'),
  /** R10, filtered in the address */
  RecruitingPipeline: query(
    'RecruitingPipeline',
    'recruitingPipeline',
    '$jobId: String!, $q: String, $stage: String, $source: String, $sort: String',
    'jobId: $jobId, q: $q, stage: $stage, source: $source, sort: $sort',
  ),
  /** R26 */
  RecruitingCandidates: query(
    'RecruitingCandidates',
    'recruitingCandidates',
    '$q: String, $tag: String',
    'q: $q, tag: $tag',
  ),
  /** R11, R12 */
  RecruitingCandidate: query(
    'RecruitingCandidate',
    'recruitingCandidate',
    '$candidateId: String!',
    'candidateId: $candidateId',
  ),
  /** R13 */
  RecruitingPools: query(
    'RecruitingPools',
    'recruitingPools',
    '$poolId: String',
    'poolId: $poolId',
  ),
  /** RM1 and the interviews list */
  RecruitingInterviews: query('RecruitingInterviews', 'recruitingInterviews'),
  /** R15 */
  RecruitingKit: query(
    'RecruitingKit',
    'recruitingKit',
    '$interviewId: String!',
    'interviewId: $interviewId',
  ),
  /** R16 */
  RecruitingSlots: query(
    'RecruitingSlots',
    'recruitingSlots',
    '$applicationId: String!, $planKey: String, $from: String, $away: String',
    'applicationId: $applicationId, planKey: $planKey, from: $from, away: $away',
  ),
  /** R17 */
  RecruitingDebrief: query(
    'RecruitingDebrief',
    'recruitingDebrief',
    '$applicationId: String!',
    'applicationId: $applicationId',
  ),
  RecruitingOffers: query('RecruitingOffers', 'recruitingOffers'),
  /** R19–R22 */
  RecruitingOffer: query(
    'RecruitingOffer',
    'recruitingOffer',
    '$offerId: String!',
    'offerId: $offerId',
  ),
  /** R8 */
  RecruitingBoard: query('RecruitingBoard', 'recruitingBoard'),
  /** S1–S8 */
  RecruitingSettings: query('RecruitingSettings', 'recruitingSettings'),
  /** R23 */
  RecruitingAnalytics: query(
    'RecruitingAnalytics',
    'recruitingAnalytics',
    '$period: String, $jobId: String, $department: String, $source: String',
    'period: $period, jobId: $jobId, department: $department, source: $source',
  ),
  RecruitingExport: query(
    'RecruitingExport',
    'recruitingExport',
    '$candidateId: String!',
    'candidateId: $candidateId',
  ),
  /** What Recruiting has in this person's Inbox (REC-064) */
  RecruitingInbox: `query RecruitingInbox {
    recruitingInbox {
      items { area at count detail due dueVerb from { name personId } icon id kind lane link message module openIn outcome { label tone } replies status { label tone } summary team { mine role takenAt takenBy { name personId } } title tone }
    }
  }`,

  /* -------------------------------------------------------- requisitions -- */
  SaveRequisition: write('SaveRequisition', 'saveRequisition', ...ID('requisitionId')),
  SubmitRequisition: write('SubmitRequisition', 'submitRequisition', ...ID('requisitionId'), false),
  DecideRequisition: write('DecideRequisition', 'decideRequisition', ...ID('requisitionId')),
  CancelRequisition: write('CancelRequisition', 'cancelRequisition', ...ID('requisitionId'), false),

  /* ---------------------------------------------------------------- jobs -- */
  CreateJob: write('CreateJob', 'createJob'),
  SaveJobDetails: write('SaveJobDetails', 'saveJobDetails', ...ID('jobId')),
  SetJobTeam: write('SetJobTeam', 'setJobTeam', ...ID('jobId')),
  SetJobStages: write('SetJobStages', 'setJobStages', ...ID('jobId')),
  SaveJobForm: write('SaveJobForm', 'saveJobForm', ...ID('jobId')),
  SaveJobAd: write('SaveJobAd', 'saveJobAd', ...two('jobId', 'language')),
  SetJobCriteria: write('SetJobCriteria', 'setJobCriteria', ...ID('jobId')),
  SetJobPlan: write('SetJobPlan', 'setJobPlan', ...ID('jobId')),
  MoveJob: write('MoveJob', 'moveJob', ...ID('jobId')),
  PublishJob: write('PublishJob', 'publishJob', ...two('jobId', 'target'), false),
  UnpublishJob: write('UnpublishJob', 'unpublishJob', ...ID('jobId'), false),
  AddCandidate: write('AddCandidate', 'addCandidate', ...ID('jobId')),
  Refer: write('Refer', 'refer', ...ID('jobId')),
  ApplyInternally: write('ApplyInternally', 'applyInternally', ...ID('jobId')),

  /* -------------------------------------------------------- the pipeline -- */
  MoveApplication: write('MoveApplication', 'moveApplication', ...ID('applicationId')),
  UndoMove: write('UndoMove', 'undoMove', ...ID('applicationId')),
  CorrectMove: write('CorrectMove', 'correctMove', ...ID('applicationId')),
  RejectApplication: write('RejectApplication', 'rejectApplication', ...ID('applicationId')),
  BulkApplications: write('BulkApplications', 'bulkApplications'),
  SendMessage: write('SendMessage', 'sendMessage', ...ID('applicationId')),
  AddNote: write('AddNote', 'addNote', ...ID('candidateId')),
  SavePool: write('SavePool', 'savePool', ...ID('poolId')),
  AddToPool: write('AddToPool', 'addToPool', ...ID('poolId')),

  /* ---------------------------------------------------------- interviews -- */
  ScheduleInterview: write('ScheduleInterview', 'scheduleInterview', ...ID('applicationId')),
  SelfScheduleLink: write('SelfScheduleLink', 'selfScheduleLink', ...ID('applicationId')),
  SetInterviewState: write('SetInterviewState', 'setInterviewState', ...ID('interviewId')),
  SaveScorecard: write('SaveScorecard', 'saveScorecard', ...ID('interviewId')),
  DecideApplication: write('DecideApplication', 'decideApplication', ...ID('applicationId')),
  RequestReference: write(
    'RequestReference',
    'requestReference',
    ...two('applicationId', 'referenceId'),
    false,
  ),

  /* -------------------------------------------------------------- offers -- */
  ComposeOffer: write('ComposeOffer', 'composeOffer', ...ID('applicationId')),
  SubmitOffer: write('SubmitOffer', 'submitOffer', ...ID('offerId'), false),
  DecideOffer: write('DecideOffer', 'decideOffer', ...ID('offerId')),
  SendOffer: write('SendOffer', 'sendOffer', ...ID('offerId'), false),
  WithdrawOffer: write('WithdrawOffer', 'withdrawOffer', ...ID('offerId'), false),
  UploadSignedContract: write('UploadSignedContract', 'uploadSignedContract', ...ID('offerId')),
  DecideCondition: write('DecideCondition', 'decideCondition', ...two('applicationId', 'kind')),
  CancelPrehire: write('CancelPrehire', 'cancelPrehire', ...ID('applicationId')),
  PresentToWorksCouncil: write(
    'PresentToWorksCouncil',
    'presentToWorksCouncil',
    ...ID('applicationId'),
    false,
  ),
  WorksCouncilDecides: write('WorksCouncilDecides', 'worksCouncilDecides', ...ID('applicationId')),

  /* ------------------------------------------------------------ settings -- */
  SaveRecruitingSettings: write('SaveRecruitingSettings', 'saveSettings'),
  SaveEntity: write('SaveEntity', 'saveEntity', ...ID('id')),
  SaveLocation: write('SaveLocation', 'saveLocation', ...ID('id')),
  SavePipeline: write('SavePipeline', 'savePipeline', ...ID('id')),
  SaveChain: write('SaveChain', 'saveChain', ...ID('id')),
  SaveQuestionnaire: write('SaveQuestionnaire', 'saveQuestionnaire', ...ID('id')),
  ConsentQuestionnaire: write('ConsentQuestionnaire', 'consentQuestionnaire', ...ID('id'), false),
  SaveScorecardTemplate: write('SaveScorecardTemplate', 'saveScorecardTemplate', ...ID('id')),
  SaveTemplate: write('SaveTemplate', 'saveTemplate', ...ID('id')),
  SaveBenefit: write('SaveBenefit', 'saveBenefit', ...ID('id')),
  SavePayBand: write('SavePayBand', 'savePayBand', ...ID('id')),
  SaveAgency: write('SaveAgency', 'saveAgency', ...ID('id')),
  PlaceHold: write('PlaceHold', 'placeHold', ...ID('candidateId')),
  DeleteCandidate: write('DeleteCandidate', 'deleteCandidate', ...ID('candidateId'), false),
  Chart: write('Chart', 'chart'),
} as const;

export type OperationName = keyof typeof OPERATIONS;
