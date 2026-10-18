/**
 * Every GraphQL operation the tenant app sends Performance, through the router
 * (PRF-070): Onboarding's rule (`onboarding-operations.ts`). One query per
 * screen, one mutation per write; `$key` is the idempotency key and `input`
 * the REST route's JSON body; `PerformanceLive` is the cycle stream (§8.7).
 * The router's safelist is generated from this file
 * (`pnpm --filter @kithena/gateway persist`).
 *
 * Plain text, no `server-only`: the generator reads it too.
 */

export const OPERATIONS = {
  PerformanceWebhooks: `query PerformanceWebhooks {
    performanceWebhooks
  }`,
  AddPerformanceWebhook: `mutation AddPerformanceWebhook($key: String!, $input: JSON!) {
    addPerformanceWebhook(idempotencyKey: $key, input: $input)
  }`,
  ChangePerformanceWebhook: `mutation ChangePerformanceWebhook($id: String!, $key: String!, $input: JSON!) {
    changePerformanceWebhook(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RotatePerformanceWebhook: `mutation RotatePerformanceWebhook($id: String!, $key: String!, $input: JSON!) {
    rotatePerformanceWebhook(id: $id, idempotencyKey: $key, input: $input)
  }`,
  TestPerformanceWebhook: `mutation TestPerformanceWebhook($id: String!, $key: String!, $input: JSON!) {
    testPerformanceWebhook(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RemovePerformanceWebhook: `mutation RemovePerformanceWebhook($id: String!, $key: String!) {
    removePerformanceWebhook(id: $id, idempotencyKey: $key)
  }`,
  PerformanceRetention: `query PerformanceRetention {
    performanceRetention
  }`,
  ConfirmPerformanceRetention: `mutation ConfirmPerformanceRetention($key: String!, $input: JSON!) {
    confirmPerformanceRetention(idempotencyKey: $key, input: $input)
  }`,
  PlacePerformanceHold: `mutation PlacePerformanceHold($key: String!, $input: JSON!) {
    placePerformanceHold(idempotencyKey: $key, input: $input)
  }`,
  LiftPerformanceHold: `mutation LiftPerformanceHold($id: String!, $key: String!, $input: JSON!) {
    liftPerformanceHold(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ExportPerformancePerson: `mutation ExportPerformancePerson($id: String!, $key: String!, $input: JSON!) {
    exportPerformancePerson(id: $id, idempotencyKey: $key, input: $input)
  }`,
  PerformanceAiLog: `query PerformanceAiLog {
    performanceAiLog
  }`,
  PerformanceAnalytics: `query PerformanceAnalytics($cycleId: String, $personId: String, $tab: String) {
    performanceAnalytics(cycleId: $cycleId, personId: $personId, tab: $tab)
  }`,
  PerformanceAttachGoals: `query PerformanceAttachGoals($id: String!) {
    performanceAttachGoals(id: $id)
  }`,
  PerformanceAutomation: `query PerformanceAutomation($id: String!) {
    performanceAutomation(id: $id)
  }`,
  PerformanceAutomations: `query PerformanceAutomations {
    performanceAutomations
  }`,
  PerformanceCalibration: `query PerformanceCalibration($id: String!) {
    performanceCalibration(id: $id)
  }`,
  PerformanceCalibrations: `query PerformanceCalibrations {
    performanceCalibrations
  }`,
  PerformanceConnectedTools: `query PerformanceConnectedTools {
    performanceConnectedTools
  }`,
  PerformanceCycle: `query PerformanceCycle($id: String!, $page: Int, $q: String, $size: Int, $tab: String, $filter: String, $match: String, $group: String) {
    performanceCycle(id: $id, page: $page, q: $q, size: $size, tab: $tab, filter: $filter, match: $match, group: $group)
  }`,
  PerformanceCycleSetup: `query PerformanceCycleSetup($id: String!, $page: Int, $q: String, $size: Int) {
    performanceCycleSetup(id: $id, page: $page, q: $q, size: $size)
  }`,
  PerformanceCycles: `query PerformanceCycles($q: String, $state: String) {
    performanceCycles(q: $q, state: $state)
  }`,
  PerformanceDirectory: `query PerformanceDirectory($q: String) {
    performanceDirectory(q: $q)
  }`,
  PerformanceFeedback: `query PerformanceFeedback($tab: String) {
    performanceFeedback(tab: $tab)
  }`,
  PerformanceGoal: `query PerformanceGoal($id: String!) {
    performanceGoal(id: $id)
  }`,
  PerformanceGoals: `query PerformanceGoals($period: String, $risk: String, $scope: String, $tab: String) {
    performanceGoals(period: $period, risk: $risk, scope: $scope, tab: $tab)
  }`,
  PerformanceHome: `query PerformanceHome {
    performanceHome
  }`,
  PerformanceInbox: `query PerformanceInbox {
    performanceInbox {
      items { area at count detail due dueVerb from { name personId } icon id kind lane link message module openIn outcome { label tone } replies status { label tone } summary team { mine role takenAt takenBy { name personId } } title tone }
    }
  }`,
  PerformanceLearning: `query PerformanceLearning($tab: String) {
    performanceLearning(tab: $tab)
  }`,
  PerformanceLearningItem: `query PerformanceLearningItem($id: String!) {
    performanceLearningItem(id: $id)
  }`,
  PerformanceMyReviews: `query PerformanceMyReviews($tab: String) {
    performanceMyReviews(tab: $tab)
  }`,
  PerformanceNotes: `query PerformanceNotes($about: String) {
    performanceNotes(about: $about)
  }`,
  PerformancePerson: `query PerformancePerson($personId: String!) {
    performancePerson(personId: $personId)
  }`,
  PerformancePicker: `query PerformancePicker($id: String!, $q: String) {
    performancePicker(id: $id, q: $q)
  }`,
  PerformancePublishImpact: `query PerformancePublishImpact($id: String!) {
    performancePublishImpact(id: $id)
  }`,
  PerformanceRecipient: `query PerformanceRecipient($personId: String!) {
    performanceRecipient(personId: $personId)
  }`,
  PerformanceReleased: `query PerformanceReleased($id: String!) {
    performanceReleased(id: $id)
  }`,
  PerformanceReview: `query PerformanceReview($id: String!) {
    performanceReview(id: $id)
  }`,
  PerformanceReviewPdf: `query PerformanceReviewPdf($id: String!) {
    performanceReviewPdf(id: $id)
  }`,
  PerformanceReviewsAbout: `query PerformanceReviewsAbout($cycleId: String!, $subjectId: String!) {
    performanceReviewsAbout(cycleId: $cycleId, subjectId: $subjectId)
  }`,
  PerformanceSession: `query PerformanceSession($id: String!, $sessionId: String!) {
    performanceSession(id: $id, sessionId: $sessionId)
  }`,
  PerformanceSettings: `query PerformanceSettings {
    performanceSettings
  }`,
  PerformanceTemplate: `query PerformanceTemplate($id: String!) {
    performanceTemplate(id: $id)
  }`,
  PerformanceTemplateHistory: `query PerformanceTemplateHistory($id: String!) {
    performanceTemplateHistory(id: $id)
  }`,
  PerformanceTemplatePreview: `query PerformanceTemplatePreview($activity: String, $as: String, $id: String!, $version: Int) {
    performanceTemplatePreview(activity: $activity, as: $as, id: $id, version: $version)
  }`,
  PerformanceTemplates: `query PerformanceTemplates($q: String, $show: String) {
    performanceTemplates(q: $q, show: $show)
  }`,
  PerformanceUnlocks: `query PerformanceUnlocks {
    performanceUnlocks
  }`,
  PerformanceViewer: `query PerformanceViewer {
    performanceViewer
  }`,
  AcknowledgePerformanceLearning: `mutation AcknowledgePerformanceLearning($id: String!, $key: String!) {
    acknowledgePerformanceLearning(id: $id, idempotencyKey: $key)
  }`,
  AcknowledgePerformanceReview: `mutation AcknowledgePerformanceReview($id: String!, $key: String!, $input: JSON!) {
    acknowledgePerformanceReview(id: $id, idempotencyKey: $key, input: $input)
  }`,
  AddPerformanceParticipant: `mutation AddPerformanceParticipant($id: String!, $key: String!, $input: JSON!) {
    addPerformanceParticipant(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ArchivePerformanceCycle: `mutation ArchivePerformanceCycle($id: String!, $key: String!, $input: JSON!) {
    archivePerformanceCycle(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ArchivePerformanceTemplate: `mutation ArchivePerformanceTemplate($id: String!, $key: String!, $input: JSON!) {
    archivePerformanceTemplate(id: $id, idempotencyKey: $key, input: $input)
  }`,
  AskPerformanceChart: `mutation AskPerformanceChart($key: String!, $input: JSON!) {
    askPerformanceChart(idempotencyKey: $key, input: $input)
  }`,
  AssignPerformanceLearning: `mutation AssignPerformanceLearning($id: String!, $key: String!, $input: JSON!) {
    assignPerformanceLearning(id: $id, idempotencyKey: $key, input: $input)
  }`,
  AttachPerformanceGoals: `mutation AttachPerformanceGoals($id: String!, $key: String!, $input: JSON!) {
    attachPerformanceGoals(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ChangePerformanceScore: `mutation ChangePerformanceScore($id: String!, $key: String!, $input: JSON!) {
    changePerformanceScore(id: $id, idempotencyKey: $key, input: $input)
  }`,
  CheckInPerformanceGoal: `mutation CheckInPerformanceGoal($id: String!, $key: String!, $input: JSON!) {
    checkInPerformanceGoal(id: $id, idempotencyKey: $key, input: $input)
  }`,
  CheckPerformanceTemplate: `mutation CheckPerformanceTemplate($id: String!, $key: String!) {
    checkPerformanceTemplate(id: $id, idempotencyKey: $key)
  }`,
  ClosePerformanceCycle: `mutation ClosePerformanceCycle($id: String!, $key: String!, $input: JSON!) {
    closePerformanceCycle(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ConfirmPerformanceSuggestion: `mutation ConfirmPerformanceSuggestion($id: String!, $key: String!, $questionId: String!) {
    confirmPerformanceSuggestion(id: $id, idempotencyKey: $key, questionId: $questionId)
  }`,
  CreatePerformanceAutomation: `mutation CreatePerformanceAutomation($key: String!, $input: JSON!) {
    createPerformanceAutomation(idempotencyKey: $key, input: $input)
  }`,
  CreatePerformanceCalibration: `mutation CreatePerformanceCalibration($key: String!, $input: JSON!) {
    createPerformanceCalibration(idempotencyKey: $key, input: $input)
  }`,
  CreatePerformanceCycle: `mutation CreatePerformanceCycle($key: String!, $input: JSON!) {
    createPerformanceCycle(idempotencyKey: $key, input: $input)
  }`,
  CreatePerformanceGoal: `mutation CreatePerformanceGoal($key: String!, $input: JSON!) {
    createPerformanceGoal(idempotencyKey: $key, input: $input)
  }`,
  CreatePerformanceItem: `mutation CreatePerformanceItem($key: String!, $input: JSON!) {
    createPerformanceItem(idempotencyKey: $key, input: $input)
  }`,
  CreatePerformanceTemplate: `mutation CreatePerformanceTemplate($key: String!, $input: JSON!) {
    createPerformanceTemplate(idempotencyKey: $key, input: $input)
  }`,
  DecidePerformanceNominations: `mutation DecidePerformanceNominations($id: String!, $key: String!, $input: JSON!) {
    decidePerformanceNominations(id: $id, idempotencyKey: $key, input: $input)
  }`,
  DecidePerformanceUnlock: `mutation DecidePerformanceUnlock($id: String!, $key: String!, $input: JSON!) {
    decidePerformanceUnlock(id: $id, idempotencyKey: $key, input: $input)
  }`,
  DeclinePerformanceRequest: `mutation DeclinePerformanceRequest($id: String!, $key: String!) {
    declinePerformanceRequest(id: $id, idempotencyKey: $key)
  }`,
  DeclinePerformanceReview: `mutation DeclinePerformanceReview($id: String!, $key: String!, $input: JSON!) {
    declinePerformanceReview(id: $id, idempotencyKey: $key, input: $input)
  }`,
  DeletePerformanceAutomation: `mutation DeletePerformanceAutomation($id: String!, $key: String!) {
    deletePerformanceAutomation(id: $id, idempotencyKey: $key)
  }`,
  DeletePerformanceNote: `mutation DeletePerformanceNote($id: String!, $key: String!) {
    deletePerformanceNote(id: $id, idempotencyKey: $key)
  }`,
  DeletePerformanceTemplate: `mutation DeletePerformanceTemplate($id: String!, $key: String!) {
    deletePerformanceTemplate(id: $id, idempotencyKey: $key)
  }`,
  DuplicatePerformanceTemplate: `mutation DuplicatePerformanceTemplate($id: String!, $key: String!, $input: JSON!) {
    duplicatePerformanceTemplate(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ExportPerformanceCycle: `mutation ExportPerformanceCycle($id: String!, $key: String!, $input: JSON!) {
    exportPerformanceCycle(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ExtendPerformanceDeadline: `mutation ExtendPerformanceDeadline($id: String!, $key: String!, $input: JSON!) {
    extendPerformanceDeadline(id: $id, idempotencyKey: $key, input: $input)
  }`,
  FinalisePerformanceCalibration: `mutation FinalisePerformanceCalibration($id: String!, $key: String!) {
    finalisePerformanceCalibration(id: $id, idempotencyKey: $key)
  }`,
  GivePerformanceFeedback: `mutation GivePerformanceFeedback($key: String!, $input: JSON!) {
    givePerformanceFeedback(idempotencyKey: $key, input: $input)
  }`,
  HandOverPerformanceReview: `mutation HandOverPerformanceReview($id: String!, $key: String!, $input: JSON!) {
    handOverPerformanceReview(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ImportPerformanceCompletions: `mutation ImportPerformanceCompletions($key: String!, $input: JSON!) {
    importPerformanceCompletions(idempotencyKey: $key, input: $input)
  }`,
  ImportPerformanceMembers: `mutation ImportPerformanceMembers($key: String!, $input: JSON!) {
    importPerformanceMembers(idempotencyKey: $key, input: $input)
  }`,
  KeepPerformanceDetached: `mutation KeepPerformanceDetached($id: String!, $key: String!, $input: JSON!) {
    keepPerformanceDetached(id: $id, idempotencyKey: $key, input: $input)
  }`,
  MarkPerformanceAttendance: `mutation MarkPerformanceAttendance($id: String!, $key: String!, $input: JSON!) {
    markPerformanceAttendance(id: $id, idempotencyKey: $key, input: $input)
  }`,
  MarkPerformancePart: `mutation MarkPerformancePart($id: String!, $key: String!, $partId: String!) {
    markPerformancePart(id: $id, idempotencyKey: $key, partId: $partId)
  }`,
  NominatePerformancePeers: `mutation NominatePerformancePeers($id: String!, $key: String!, $input: JSON!) {
    nominatePerformancePeers(id: $id, idempotencyKey: $key, input: $input)
  }`,
  PausePerformanceAutomation: `mutation PausePerformanceAutomation($id: String!, $key: String!, $input: JSON!) {
    pausePerformanceAutomation(id: $id, idempotencyKey: $key, input: $input)
  }`,
  PerformanceAsk: `mutation PerformanceAsk($key: String!, $input: JSON!) {
    performanceAsk(idempotencyKey: $key, input: $input)
  }`,
  PerformanceAutomationInWords: `mutation PerformanceAutomationInWords($key: String!, $input: JSON!) {
    performanceAutomationInWords(idempotencyKey: $key, input: $input)
  }`,
  PerformanceCalibrationSuggestions: `mutation PerformanceCalibrationSuggestions($id: String!, $key: String!) {
    performanceCalibrationSuggestions(id: $id, idempotencyKey: $key)
  }`,
  PerformanceHowItReads: `mutation PerformanceHowItReads($id: String!, $key: String!) {
    performanceHowItReads(id: $id, idempotencyKey: $key)
  }`,
  PerformanceLearningSuggestions: `mutation PerformanceLearningSuggestions($key: String!, $personId: String!) {
    performanceLearningSuggestions(idempotencyKey: $key, personId: $personId)
  }`,
  PerformanceOverviewInWords: `mutation PerformanceOverviewInWords($id: String!, $key: String!, $input: JSON!) {
    performanceOverviewInWords(id: $id, idempotencyKey: $key, input: $input)
  }`,
  PerformanceParticipantsInWords: `mutation PerformanceParticipantsInWords($id: String!, $key: String!, $input: JSON!) {
    performanceParticipantsInWords(id: $id, idempotencyKey: $key, input: $input)
  }`,
  PerformanceSentiment: `mutation PerformanceSentiment($key: String!, $input: JSON!) {
    performanceSentiment(idempotencyKey: $key, input: $input)
  }`,
  PerformanceToneCheck: `mutation PerformanceToneCheck($key: String!, $input: JSON!) {
    performanceToneCheck(idempotencyKey: $key, input: $input)
  }`,
  PrefillPerformanceReview: `mutation PrefillPerformanceReview($id: String!, $key: String!) {
    prefillPerformanceReview(id: $id, idempotencyKey: $key)
  }`,
  PublishPerformanceTemplate: `mutation PublishPerformanceTemplate($id: String!, $key: String!) {
    publishPerformanceTemplate(id: $id, idempotencyKey: $key)
  }`,
  ReleasePerformanceCycle: `mutation ReleasePerformanceCycle($id: String!, $key: String!, $input: JSON!) {
    releasePerformanceCycle(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ReleasePerformanceSubject: `mutation ReleasePerformanceSubject($cycleId: String!, $key: String!, $input: JSON!, $subjectId: String!) {
    releasePerformanceSubject(cycleId: $cycleId, idempotencyKey: $key, input: $input, subjectId: $subjectId)
  }`,
  RemindPerformanceCycle: `mutation RemindPerformanceCycle($id: String!, $key: String!, $input: JSON!) {
    remindPerformanceCycle(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RemovePerformanceCalibrationSubject: `mutation RemovePerformanceCalibrationSubject($id: String!, $key: String!, $input: JSON!) {
    removePerformanceCalibrationSubject(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RemovePerformanceParticipant: `mutation RemovePerformanceParticipant($id: String!, $key: String!, $input: JSON!) {
    removePerformanceParticipant(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RephrasePerformanceAnswer: `mutation RephrasePerformanceAnswer($id: String!, $key: String!, $input: JSON!) {
    rephrasePerformanceAnswer(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RequestPerformanceFeedback: `mutation RequestPerformanceFeedback($key: String!, $input: JSON!) {
    requestPerformanceFeedback(idempotencyKey: $key, input: $input)
  }`,
  RequestPerformanceUnlock: `mutation RequestPerformanceUnlock($id: String!, $key: String!, $input: JSON!) {
    requestPerformanceUnlock(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RespondPerformanceSession: `mutation RespondPerformanceSession($id: String!, $key: String!, $input: JSON!, $sessionId: String!) {
    respondPerformanceSession(id: $id, idempotencyKey: $key, input: $input, sessionId: $sessionId)
  }`,
  RestorePerformanceVersion: `mutation RestorePerformanceVersion($id: String!, $key: String!, $input: JSON!) {
    restorePerformanceVersion(id: $id, idempotencyKey: $key, input: $input)
  }`,
  RetryPerformanceLaunch: `mutation RetryPerformanceLaunch($id: String!, $key: String!) {
    retryPerformanceLaunch(id: $id, idempotencyKey: $key)
  }`,
  RunPerformanceAsk: `mutation RunPerformanceAsk($key: String!, $input: JSON!) {
    runPerformanceAsk(idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceAnswers: `mutation SavePerformanceAnswers($id: String!, $key: String!, $input: JSON!) {
    savePerformanceAnswers(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceAutomation: `mutation SavePerformanceAutomation($id: String!, $key: String!, $input: JSON!) {
    savePerformanceAutomation(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceChart: `mutation SavePerformanceChart($key: String!, $input: JSON!) {
    savePerformanceChart(idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceCycle: `mutation SavePerformanceCycle($id: String!, $key: String!, $input: JSON!) {
    savePerformanceCycle(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceGoal: `mutation SavePerformanceGoal($id: String!, $key: String!, $input: JSON!) {
    savePerformanceGoal(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceItem: `mutation SavePerformanceItem($id: String!, $key: String!, $input: JSON!) {
    savePerformanceItem(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceNote: `mutation SavePerformanceNote($key: String!, $input: JSON!) {
    savePerformanceNote(idempotencyKey: $key, input: $input)
  }`,
  SavePerformanceSettings: `mutation SavePerformanceSettings($key: String!, $input: JSON!, $section: String!) {
    savePerformanceSettings(idempotencyKey: $key, input: $input, section: $section)
  }`,
  SavePerformanceTemplate: `mutation SavePerformanceTemplate($id: String!, $key: String!, $input: JSON!) {
    savePerformanceTemplate(id: $id, idempotencyKey: $key, input: $input)
  }`,
  ScanPerformanceSession: `mutation ScanPerformanceSession($key: String!, $input: JSON!) {
    scanPerformanceSession(idempotencyKey: $key, input: $input)
  }`,
  SetPerformanceGoalVisibility: `mutation SetPerformanceGoalVisibility($id: String!, $key: String!, $input: JSON!) {
    setPerformanceGoalVisibility(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SetPerformanceGoalStatus: `mutation SetPerformanceGoalStatus($id: String!, $key: String!, $input: JSON!) {
    setPerformanceGoalStatus(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SetPerformanceGrant: `mutation SetPerformanceGrant($key: String!, $input: JSON!, $source: String!) {
    setPerformanceGrant(idempotencyKey: $key, input: $input, source: $source)
  }`,
  StartPerformanceCycle: `mutation StartPerformanceCycle($id: String!, $key: String!) {
    startPerformanceCycle(id: $id, idempotencyKey: $key)
  }`,
  SubmitPerformanceQuiz: `mutation SubmitPerformanceQuiz($id: String!, $key: String!, $input: JSON!) {
    submitPerformanceQuiz(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SubmitPerformanceReview: `mutation SubmitPerformanceReview($id: String!, $key: String!, $input: JSON!) {
    submitPerformanceReview(id: $id, idempotencyKey: $key, input: $input)
  }`,
  SummarisePerformanceReview: `mutation SummarisePerformanceReview($id: String!, $key: String!) {
    summarisePerformanceReview(id: $id, idempotencyKey: $key)
  }`,
  TranslatePerformanceTemplate: `mutation TranslatePerformanceTemplate($id: String!, $key: String!, $input: JSON!) {
    translatePerformanceTemplate(id: $id, idempotencyKey: $key, input: $input)
  }`,
  UndoPerformanceFeedback: `mutation UndoPerformanceFeedback($id: String!, $key: String!) {
    undoPerformanceFeedback(id: $id, idempotencyKey: $key)
  }`,
  UnschedulePerformanceCycle: `mutation UnschedulePerformanceCycle($id: String!, $key: String!) {
    unschedulePerformanceCycle(id: $id, idempotencyKey: $key)
  }`,
  WithdrawPerformanceUnlock: `mutation WithdrawPerformanceUnlock($id: String!, $key: String!) {
    withdrawPerformanceUnlock(id: $id, idempotencyKey: $key)
  }`,
  WritePerformanceTemplate: `mutation WritePerformanceTemplate($key: String!, $input: JSON!) {
    writePerformanceTemplate(idempotencyKey: $key, input: $input)
  }`,
  PerformanceLive: `subscription PerformanceLive($cycleId: String) {
    performanceLive(cycleId: $cycleId) { cycleId state version counts }
  }`,
} as const;

export type OperationName = keyof typeof OPERATIONS;
