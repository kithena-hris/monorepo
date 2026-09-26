/**
 * Every GraphQL operation the tenant app sends People, through the router
 * (PEO-113).
 *
 * A fixed list, and the only one: the router runs a persisted-operation
 * safelist in production, and `apps/gateway/persisted/` is generated from this
 * file (`pnpm --filter @kithena/gateway persist`), so an operation that is not
 * here is refused before People sees it. The browser never chooses one — the
 * server actions and the page loader name them.
 *
 * Plain text, no `server-only`: the generator reads it too.
 */

const RECORD_FIELD = `
  fragment RecordFieldParts on RecordField {
    key label description dataType options { value label } required readOnly currency ownedBy keptIn sensitive
  }`;

const ENTRY = `
  fragment EntryParts on FormEntry {
    __typename
    ... on TextEntry { key text }
    ... on FlagEntry { key flag }
    ... on ListEntry { key items }
    ... on MoneyEntry { key amountMinor currency }
    ... on SealedEntry { key last4 }
    ... on EmptyEntry { key }
  }`;

const STAGE = `
  fragment StageParts on ImportStage {
    __typename
    ... on ImportMapStage {
      step file { name rows sheet }
      columns { index header status key source confidence reason }
      fields { key label sensitive }
    }
    ... on ImportReviewStage {
      step file { name rows sheet }
      dryRun {
        counts { create update unchanged blocked duplicate }
        incomplete { count byField { label count } }
        ignoredColumns
        sheets { sheet key imported }
        corrections { row from to }
        blocked { row person problem cell }
        findings { row cell label level message }
        sensitive { fields values }
      }
      blockedUrl
    }
    ... on ImportDoneStage {
      step file { name rows sheet } created updated blocked reportUrl forReview held appliedWithoutApproval
    }
  }`;

/** A person's doubted identifiers still open (PEO-125). Never the value. */
const REVIEW = `
  fragment ReviewParts on IdentifierReviewEntry {
    key label state findings { level code message } note
  }`;

/** A value waiting for HR's approval (PEO-077), masked as its field is. */
const PENDING = `
  fragment PendingParts on PendingField {
    id key label kind value { ...EntryParts } effectiveFrom requestedAt expiresAt requestedBy reason
    mine canDecide canSelfApprove awaitingReview findings { level code message }
  }`;

/** What the country checks warned about, on a save or before one (PEO-125). */
const FINDINGS = 'findings { key label level code message review }';

/** The same, per grid cell: which person each is about. */
const GRID_FINDINGS = 'findings { personId key label level code message review }';

export const OPERATIONS = {
  /* ------------------------------------------------------------- reads -- */
  Onboarding: `query Onboarding {
    peopleOnboarding {
      firstName
      sections { key label visibility ask fields { ...RecordFieldParts } }
      values { ...EntryParts }
      saved
      reviews { ...ReviewParts }
    }
  }${RECORD_FIELD}${ENTRY}${REVIEW}`,

  Profile: `query Profile($personId: ID) {
    peopleProfile(personId: $personId) {
      person { name summary avatarUrl missing }
      sections { key label visibility readsLogged fields { ...RecordFieldParts } }
      values { ...EntryParts }
      calendar { today timeZone }
      employment {
        status
        periods {
          period startedOn lastWorkingDay leavingReason eligibleForRehire noticeFrom rehireOverrideReason
        }
      }
      placement {
        legalEntityId locationId
        entities { value label }
        locations { value label legalEntityId }
      }
      reviews { ...ReviewParts }
      pending { ...PendingParts }
    }
  }${RECORD_FIELD}${ENTRY}${REVIEW}${PENDING}`,

  /** A record as of a date, and every change behind it (PEO-064). */
  History: `query History($personId: ID, $asOf: String) {
    peopleHistory(personId: $personId, asOf: $asOf) {
      person { id name }
      asOf
      sections { key label visibility fields { ...RecordFieldParts } }
      dated
      values { ...EntryParts }
      changes {
        id key effectiveFrom recordedAt by supersedes supersededBy
        value { ...EntryParts }
      }
    }
  }${RECORD_FIELD}${ENTRY}`,

  /** Changes waiting for approval (PEO-077): every one for HR, the viewer's own otherwise. */
  Approvals: `query Approvals {
    peopleApprovals {
      isHr
      items {
        id personId name key label kind readable effectiveFrom requestedAt expiresAt requestedBy
        reason mine canDecide canSelfApprove awaitingReview findings { level code message }
        value { ...EntryParts }
        current { ...EntryParts }
      }
    }
  }${ENTRY}`,

  IdentifierReviews: `query IdentifierReviews {
    peopleIdentifierReviews {
      items { personId name attributeKey label last4 findings { level code message } enteredAt held }
    }
  }`,

  Duplicates: `query Duplicates($a: ID, $b: ID) {
    peopleDuplicates(a: $a, b: $b) {
      items { personIds names reasons }
      comparison {
        people { id name status refusal }
        rows { key label values same takeable }
      }
    }
  }`,

  GridCheck: `query GridCheck($changes: [GridChangeInput!]!) {
    peopleGridCheck(changes: $changes) { ${GRID_FINDINGS} }
  }`,

  /** The people chosen for a bulk edit, and what HR may set on them (PEO-071). */
  BulkEdit: `query BulkEdit($personIds: [ID!]!) {
    peopleBulkEdit(personIds: $personIds) {
      people { id name }
      sections { key label visibility fields { ...RecordFieldParts } }
      today limit
    }
  }${RECORD_FIELD}`,

  /** What a page of a bulk edit would change and refuse; nothing is kept. */
  BulkEditPreview: `query BulkEditPreview(
    $personIds: [ID!]!, $values: [FormValueInput!]!, $effectiveFrom: String!, $applySensitiveWithoutApproval: Boolean
  ) {
    peopleBulkEditPreview(
      personIds: $personIds, values: $values, effectiveFrom: $effectiveFrom,
      applySensitiveWithoutApproval: $applySensitiveWithoutApproval
    ) {
      committed rows { personId name outcome held changes { key label dated before { ...EntryParts } after { ...EntryParts } } refusal { code message keys } ${FINDINGS} }
    }
  }${ENTRY}`,

  /** Who a page of a bulk hire would hire and skip, and why; nothing is kept. */
  BulkHirePreview: `query BulkHirePreview($hires: [BulkHireInput!]!) {
    peopleBulkHirePreview(hires: $hires) {
      committed rows { personId name outcome held changes { key label dated before { ...EntryParts } after { ...EntryParts } } refusal { code message keys } ${FINDINGS} }
    }
  }${ENTRY}`,

  IdentifierCheck: `query IdentifierCheck($personId: ID, $changed: [FormValueInput!]!) {
    peopleIdentifierCheck(personId: $personId, changed: $changed) { ${FINDINGS} }
  }`,

  FullValues: `query FullValues {
    peopleFullValues {
      canRequest canDecide
      fields { key label }
      requests { id state mine requestedBy reason fields requestedAt expiresAt note link }
    }
  }`,

  WebhookDeliveries: `query WebhookDeliveries($endpointId: ID!, $after: ID) {
    peopleWebhookDeliveries(endpointId: $endpointId, after: $after) {
      endpoint { id url enabled }
      deliveries { id eventName status attempts lastResponse createdAt deliveredAt replayOf }
      next
    }
  }`,

  Home: `query Home {
    peopleHome { hr admin finance }
  }`,

  Organisation: `query Organisation {
    peopleOrganisation {
      canManage
      settings { defaultTimeZone cohortMinimum slug displayName }
      legalEntities { id name country timeZone archived }
      locations { id legalEntityId name country timeZone zones { effectiveFrom timeZone } archived }
      numberings { legalEntityId prefix digits nextValue }
      countries { code name }
      timeZones
      retentionFloors { floor months status reviewedBy reviewedOn }
      payBands { id grade currency minimumMinor midpointMinor maximumMinor effectiveFrom recordedAt supersedes }
    }
  }`,

  Directory: `query Directory($search: String, $filter: String, $after: ID, $segment: ID) {
    peopleDirectory(search: $search, filter: $filter, after: $after, segment: $segment) {
      total active notStarted incomplete
      segment { id name }
      segments { id name }
      columns { key label }
      filterable { key label options { value label } }
      people { id name email avatarUrl values { key value } missing }
      next
      can { import export bulkEdit }
    }
  }`,

  Completeness: `query Completeness($after: ID) {
    peopleCompleteness(after: $after) {
      since
      waiting { people lastReminded }
      completedThisWeek
      toFill
      fields { key label options { value label } person sensitive }
      rows { personId name department manager missing }
      next
    }
  }`,

  PeoplePicker: `query PeoplePicker($search: String, $after: ID) {
    peoplePicker(search: $search, after: $after) {
      options { value label }
      next
    }
  }`,

  RoleSettings: `query RoleSettings {
    peopleRoleSettings {
      viewerAccountId canManage
      people { accountId personId name workEmail roles }
    }
  }`,

  Registry: `query Registry {
    peopleRegistry {
      published { version publishedAt }
      unpublishedChanges
      sections { key label visibility ownership origin fixed }
      fields {
        key sectionKey label description dataType options requiredness ownership visibility
        collectAt classification piiKind requiresApproval origin pending
        requiredWhen { ...PredicateParts }
        visibilityRules { scopes when { ...PredicateParts } }
      }
      choices { legalEntities { value label } countries { value label } }
    }
  }
  fragment PredicateParts on PersonPredicate {
    combine
    clauses { operand in key is equals }
  }`,

  Setup: `query Setup {
    peopleSetup {
      legalEntity { name country }
      entityConfirmed
      countries { code name }
      packs {
        country countryName fields
        sections { key label summary required requiredByLaw onByDefault }
      }
      published
      profile {
        sections { key label visibility fields { ...RecordFieldParts } }
        values { ...EntryParts }
        pending { ...PendingParts }
      }
    }
  }${RECORD_FIELD}${ENTRY}${PENDING}`,

  Integrations: `query Integrations {
    peopleIntegrations {
      schemaVersion deliveries24h events
      fields { key label refused }
      endpoints {
        id url enabled events allowlist alertEmail retrying problem lastDelivery secretRotated
      }
      scim {
        url paths extension
        mappable { key label }
        connections { id system createdAt tokenRotatedAt revokedAt linked mapping { path key } }
      }
    }
  }`,

  ExportBuilder: `query ExportBuilder {
    peopleExportBuilder {
      today
      who { value label count }
      sections { key label fields { key label } }
    }
  }`,

  /* A scheduled report's file, from the link in its email (PEO-069): the requester's own only. */
  ScheduledExport: `query ScheduledExport($id: ID!) {
    peopleExport(id: $id) { id status expiresAt links { name url } }
  }`,

  Analytics: `query Analytics($segment: ID) {
    peopleAnalytics(segment: $segment) {
      asOf source sourceNote
      segment { id name }
      segments { id name }
      headcount { value change trend { label value } }
      attrition { percent leavers formula trend { label value } }
      complete { percent incomplete }
      expiringIn90Days
      expiries { today items { kind personId name day } }
      movement { period opening joiners moves leavers closing }
      completenessBySection { label value }
      tenure { label headcount leavers }
      span { label value }
      joiners { months departments cells { row column value } }
      composition { categories series { label values } }
      selfId { key label status minimum publishedAsOf total note cells { label value } }
      pay {
        asOf minimum
        grade { ...PayGroup }
        tenure { ...PayGroup }
        compa { ...PayGroup }
      }
    }
  }
  fragment PayGroup on AnalyticsPayGroup {
    label currency status people p25 median p75
    band { minimumMinor midpointMinor maximumMinor }
  }`,

  PublishPreview: `query PublishPreview($requiredFrom: String!) {
    peoplePublishPreview(requiredFrom: $requiredFrom) {
      nextVersion unchanged
      changes { kind key summary specialCategory }
      impact { evaluated becomingIncomplete becomingComplete forEmployees forStaff }
      integrationsNotified
    }
  }`,

  ClassificationAdvice: `query ClassificationAdvice(
    $label: String!, $description: String, $dataType: String!, $sectionKey: String!, $options: [String!]!
  ) {
    peopleClassificationAdvice(
      label: $label, description: $description, dataType: $dataType, sectionKey: $sectionKey, options: $options
    ) { kind classification piiKind reason floor }
  }`,

  /* ------------------------------------------------------------ writes -- */
  SaveOwnSection: `mutation SaveOwnSection($changed: [FormValueInput!]!, $key: String!) {
    saveOwnSection(changed: $changed, idempotencyKey: $key) { ok held ${FINDINGS} }
  }`,

  SavePersonSection: `mutation SavePersonSection($personId: ID!, $changed: [FormValueInput!]!, $key: String!) {
    savePersonSection(personId: $personId, changed: $changed, idempotencyKey: $key) { ok held ${FINDINGS} }
  }`,

  ReviewIdentifier: `mutation ReviewIdentifier(
    $personId: ID!, $attributeKey: String!, $decision: IdentifierReviewDecision!, $note: String, $key: String!
  ) {
    reviewIdentifier(
      personId: $personId, attributeKey: $attributeKey, decision: $decision, note: $note, idempotencyKey: $key
    ) { reviewId state }
  }`,

  RevealIdentifier: `mutation RevealIdentifier($personId: ID!, $attributeKey: String!) {
    revealIdentifier(personId: $personId, attributeKey: $attributeKey) { attributeKey value }
  }`,

  PlacePerson: `mutation PlacePerson($personId: ID!, $legalEntityId: ID, $locationId: ID, $effectiveFrom: String, $key: String!) {
    placePerson(personId: $personId, legalEntityId: $legalEntityId, locationId: $locationId, effectiveFrom: $effectiveFrom, idempotencyKey: $key) { id }
  }`,

  BulkEditPeople: `mutation BulkEditPeople(
    $personIds: [ID!]!, $values: [FormValueInput!]!, $effectiveFrom: String!, $applySensitiveWithoutApproval: Boolean,
    $key: String!
  ) {
    bulkEditPeople(
      personIds: $personIds, values: $values, effectiveFrom: $effectiveFrom,
      applySensitiveWithoutApproval: $applySensitiveWithoutApproval, idempotencyKey: $key
    ) {
      committed rows { personId name outcome held changes { key label dated before { ...EntryParts } after { ...EntryParts } } refusal { code message keys } ${FINDINGS} }
    }
  }${ENTRY}`,

  /** A page of a bulk hire: provisional people, each from a start date. */
  BulkHirePeople: `mutation BulkHirePeople($hires: [BulkHireInput!]!, $key: String!) {
    bulkHirePeople(hires: $hires, idempotencyKey: $key) {
      committed rows { personId name outcome held changes { key label dated before { ...EntryParts } after { ...EntryParts } } refusal { code message keys } ${FINDINGS} }
    }
  }${ENTRY}`,

  SaveCompletenessGrid: `mutation SaveCompletenessGrid($changes: [GridChangeInput!]!, $key: String!) {
    saveCompletenessGrid(changes: $changes, idempotencyKey: $key) { ok held ${GRID_FINDINGS} }
  }`,

  ConfirmSetupEntity: `mutation ConfirmSetupEntity($name: String!, $country: String!, $key: String!) {
    confirmSetupEntity(name: $name, country: $country, idempotencyKey: $key) { ok }
  }`,

  PublishSetup: `mutation PublishSetup($country: String!, $sections: [String!]!, $key: String!) {
    publishSetup(country: $country, sections: $sections, idempotencyKey: $key) { version }
  }`,

  AddDraftSection: `mutation AddDraftSection($label: String!, $key: String!) {
    addDraftSection(label: $label, idempotencyKey: $key) { ok }
  }`,

  ReorderDraftSections: `mutation ReorderDraftSections($order: [String!]!, $key: String!) {
    reorderDraftSections(order: $order, idempotencyKey: $key) { ok }
  }`,

  ReorderDraftFields: `mutation ReorderDraftFields($sectionKey: String!, $order: [String!]!, $key: String!) {
    reorderDraftFields(sectionKey: $sectionKey, order: $order, idempotencyKey: $key) { ok }
  }`,

  SaveDraftField: `mutation SaveDraftField($input: DraftFieldInput!, $editing: String, $key: String!) {
    saveDraftField(input: $input, editing: $editing, idempotencyKey: $key) { ok }
  }`,

  PublishDraft: `mutation PublishDraft($requiredFrom: String!, $key: String!) {
    publishDraft(requiredFrom: $requiredFrom, idempotencyKey: $key) { version }
  }`,

  CreateWebhookEndpoint: `mutation CreateWebhookEndpoint(
    $url: String!, $events: [String!]!, $allowlist: [String!]!, $alertEmail: String!, $key: String!
  ) {
    createWebhookEndpoint(
      url: $url, events: $events, allowlist: $allowlist, alertEmail: $alertEmail, idempotencyKey: $key
    ) { id secret }
  }`,

  UpdateWebhookEndpoint: `mutation UpdateWebhookEndpoint(
    $id: ID!, $url: String, $events: [String!], $allowlist: [String!], $alertEmail: String,
    $enabled: Boolean, $key: String!
  ) {
    updateWebhookEndpoint(
      id: $id, url: $url, events: $events, allowlist: $allowlist, alertEmail: $alertEmail,
      enabled: $enabled, idempotencyKey: $key
    ) { ok }
  }`,

  RotateWebhookSecret: `mutation RotateWebhookSecret($id: ID!, $key: String!) {
    rotateWebhookSecret(id: $id, idempotencyKey: $key) { id secret }
  }`,

  CreateScimConnection: `mutation CreateScimConnection($system: String!, $key: String!) {
    createScimConnection(system: $system, idempotencyKey: $key) { id token }
  }`,

  RotateScimToken: `mutation RotateScimToken($id: ID!, $key: String!) {
    rotateScimToken(id: $id, idempotencyKey: $key) { id token }
  }`,

  RevokeScimConnection: `mutation RevokeScimConnection($id: ID!, $key: String!) {
    revokeScimConnection(id: $id, idempotencyKey: $key) { ok }
  }`,

  SetScimMapping: `mutation SetScimMapping($id: ID!, $mapping: [ScimMappingInput!]!, $key: String!) {
    setScimMapping(id: $id, mapping: $mapping, idempotencyKey: $key) { ok }
  }`,

  ReplayWebhookDelivery: `mutation ReplayWebhookDelivery($deliveryId: ID!, $key: String!) {
    replayWebhookDelivery(deliveryId: $deliveryId, idempotencyKey: $key) { deliveryId }
  }`,

  RequestFullValues: `mutation RequestFullValues($fields: [String!]!, $reason: String!, $key: String!) {
    requestFullValues(fields: $fields, reason: $reason, idempotencyKey: $key) { id }
  }`,

  DecideFullValues: `mutation DecideFullValues($id: ID!, $approve: Boolean!, $note: String, $key: String!) {
    decideFullValues(id: $id, approve: $approve, note: $note, idempotencyKey: $key) { id }
  }`,

  GrantRole: `mutation GrantRole($accountId: ID!, $role: TenantRole!, $reason: String!, $key: String!) {
    grantRole(accountId: $accountId, role: $role, reason: $reason, idempotencyKey: $key) { accountId roles }
  }`,

  RevokeRole: `mutation RevokeRole($accountId: ID!, $role: TenantRole!, $reason: String!, $key: String!) {
    revokeRole(accountId: $accountId, role: $role, reason: $reason, idempotencyKey: $key) { accountId roles }
  }`,

  UpdatePeopleSettings: `mutation UpdatePeopleSettings($defaultTimeZone: String, $cohortMinimum: Int, $key: String!) {
    updatePeopleSettings(defaultTimeZone: $defaultTimeZone, cohortMinimum: $cohortMinimum, idempotencyKey: $key) {
      defaultTimeZone
    }
  }`,

  CreateLegalEntity: `mutation CreateLegalEntity($name: String!, $country: String!, $timeZone: String!, $key: String!) {
    createLegalEntity(name: $name, country: $country, timeZone: $timeZone, idempotencyKey: $key) { id }
  }`,

  UpdateLegalEntity: `mutation UpdateLegalEntity(
    $id: ID!, $name: String, $timeZone: String, $archived: Boolean, $key: String!
  ) {
    updateLegalEntity(id: $id, name: $name, timeZone: $timeZone, archived: $archived, idempotencyKey: $key) { id }
  }`,

  CreateLocation: `mutation CreateLocation(
    $legalEntityId: ID!, $name: String!, $country: String!, $timeZone: String!, $effectiveFrom: String, $key: String!
  ) {
    createLocation(
      legalEntityId: $legalEntityId, name: $name, country: $country, timeZone: $timeZone,
      effectiveFrom: $effectiveFrom, idempotencyKey: $key
    ) { id }
  }`,

  UpdateLocation: `mutation UpdateLocation($id: ID!, $name: String, $archived: Boolean, $key: String!) {
    updateLocation(id: $id, name: $name, archived: $archived, idempotencyKey: $key) { id }
  }`,

  ChangeLocationZone: `mutation ChangeLocationZone($id: ID!, $timeZone: String!, $effectiveFrom: String!, $key: String!) {
    changeLocationZone(id: $id, timeZone: $timeZone, effectiveFrom: $effectiveFrom, idempotencyKey: $key) { id }
  }`,

  SetEmployeeNumbering: `mutation SetEmployeeNumbering(
    $legalEntityId: ID!, $prefix: String!, $digits: Int!, $start: Float!, $key: String!
  ) {
    setEmployeeNumbering(
      legalEntityId: $legalEntityId, prefix: $prefix, digits: $digits, start: $start, idempotencyKey: $key
    ) { legalEntityId }
  }`,

  SetPayBand: `mutation SetPayBand(
    $grade: String!, $currency: String!, $minimumMinor: String!, $midpointMinor: String!,
    $maximumMinor: String!, $effectiveFrom: String!, $key: String!
  ) {
    setPayBand(
      grade: $grade, currency: $currency, minimumMinor: $minimumMinor, midpointMinor: $midpointMinor,
      maximumMinor: $maximumMinor, effectiveFrom: $effectiveFrom, idempotencyKey: $key
    ) { id }
  }`,

  GiveNotice: `mutation GiveNotice($personId: ID!, $lastWorkingDay: String!, $reason: LeavingReason, $key: String!) {
    giveNotice(personId: $personId, lastWorkingDay: $lastWorkingDay, reason: $reason, idempotencyKey: $key) { id }
  }`,

  WithdrawNotice: `mutation WithdrawNotice($personId: ID!, $key: String!) {
    withdrawNotice(personId: $personId, idempotencyKey: $key) { id }
  }`,

  TerminatePerson: `mutation TerminatePerson(
    $personId: ID!, $lastWorkingDay: String!, $reason: LeavingReason!, $note: String,
    $eligibleForRehire: Boolean, $endAccessNow: Boolean, $key: String!
  ) {
    terminatePerson(
      personId: $personId, lastWorkingDay: $lastWorkingDay, reason: $reason, note: $note,
      eligibleForRehire: $eligibleForRehire, endAccessNow: $endAccessNow, idempotencyKey: $key
    ) { id }
  }`,

  EndPersonAccess: `mutation EndPersonAccess($personId: ID!, $key: String!) {
    endPersonAccess(personId: $personId, idempotencyKey: $key) { id }
  }`,

  StartLeave: `mutation StartLeave($personId: ID!, $key: String!) {
    startLeave(personId: $personId, idempotencyKey: $key) { id }
  }`,

  EndLeave: `mutation EndLeave($personId: ID!, $key: String!) {
    endLeave(personId: $personId, idempotencyKey: $key) { id }
  }`,

  CreatePerson: `mutation CreatePerson($attributes: [AttributeValueInput!]!, $hireDate: String, $key: String!) {
    createPerson(attributes: $attributes, hireDate: $hireDate, idempotencyKey: $key) { id }
  }`,

  DiscardPerson: `mutation DiscardPerson($personId: ID!, $key: String!) {
    discardPerson(personId: $personId, idempotencyKey: $key) { id }
  }`,

  HirePerson: `mutation HirePerson($personId: ID!, $hireDate: String!, $legalEntityId: ID, $locationId: ID, $key: String!) {
    hirePerson(personId: $personId, hireDate: $hireDate, legalEntityId: $legalEntityId, locationId: $locationId, idempotencyKey: $key) { id }
  }`,

  RehirePerson: `mutation RehirePerson($personId: ID!, $startDate: String!, $overrideReason: String, $key: String!) {
    rehirePerson(personId: $personId, startDate: $startDate, overrideReason: $overrideReason, idempotencyKey: $key) { id }
  }`,

  MergePerson: `mutation MergePerson($personId: ID!, $absorbedPersonId: ID!, $take: [String!], $key: String!) {
    mergePerson(personId: $personId, absorbedPersonId: $absorbedPersonId, take: $take, idempotencyKey: $key) { id }
  }`,

  DismissDuplicate: `mutation DismissDuplicate($personIds: [ID!]!, $key: String!) {
    dismissDuplicate(personIds: $personIds, idempotencyKey: $key) { decision }
  }`,

  StartImportUpload: `mutation StartImportUpload($name: String!, $size: Int!) {
    startImportUpload(name: $name, size: $size) { uploadId url method headers { name value } expiresAt }
  }`,

  CompleteImportUpload: `mutation CompleteImportUpload($uploadId: ID!) {
    completeImportUpload(uploadId: $uploadId) { ...StageParts }
  }${STAGE}`,

  DryRunImport: `mutation DryRunImport($uploadId: ID!, $mapping: [ImportColumnInput!]!) {
    dryRunImport(uploadId: $uploadId, mapping: $mapping) { ...StageParts }
  }${STAGE}`,

  CommitImport: `mutation CommitImport(
    $uploadId: ID!, $mapping: [ImportColumnInput!]!, $applySensitiveWithoutApproval: Boolean, $key: String!
  ) {
    commitImport(
      uploadId: $uploadId, mapping: $mapping,
      applySensitiveWithoutApproval: $applySensitiveWithoutApproval, idempotencyKey: $key
    ) { ...StageParts }
  }${STAGE}`,

  DecidePendingChange: `mutation DecidePendingChange(
    $id: ID!, $approve: Boolean!, $note: String, $soleApprover: Boolean, $key: String!
  ) {
    decidePendingChange(
      id: $id, approve: $approve, note: $note, soleApprover: $soleApprover, idempotencyKey: $key
    ) { ok }
  }`,

  WithdrawPendingChange: `mutation WithdrawPendingChange($id: ID!, $key: String!) {
    withdrawPendingChange(id: $id, idempotencyKey: $key) { ok }
  }`,

  RequestExport: `mutation RequestExport(
    $format: String!, $fields: [String!], $asOf: String, $segmentId: ID, $recordOf: ID, $reason: String, $key: String!
  ) {
    requestExport(
      format: $format, fields: $fields, asOf: $asOf, segmentId: $segmentId, recordOf: $recordOf, reason: $reason,
      idempotencyKey: $key
    ) {
      id status rowCount expiresAt links { name url }
    }
  }`,

  SaveSegment: `mutation SaveSegment(
    $name: String!, $filter: [PeopleSegmentConditionInput!]!, $shared: Boolean!, $key: String!
  ) {
    savePeopleSegment(name: $name, filter: $filter, shared: $shared, idempotencyKey: $key) { id }
  }`,

  /* Scheduled reports (PEO-069): HR's list, a schedule's history, and the five writes. */
  ReportSchedules: `query ReportSchedules {
    peopleReportSchedules {
      canManage
      schedules {
        id name ownerName paused segmentId segmentName filter { key value }
        kind format fields reason every weekday day hour legalEntityId
        recipients { accountId name }
        lastRun { period missed startedAt finishedAt outcome }
      }
      segments { id name forExport forSummary }
      people { accountId name workEmail }
      legalEntities { id name }
      fields { key label section }
    }
  }`,

  ReportRuns: `query ReportRuns($id: ID!) {
    peopleReportRuns(id: $id) {
      id name
      runs { period missed startedAt finishedAt outcome recipients { accountId name outcome } }
    }
  }`,

  CreateReportSchedule: `mutation CreateReportSchedule(
    $name: String!, $segmentId: ID, $filter: [ReportConditionInput!], $kind: ReportKind!,
    $format: ReportFormat, $fields: [String!], $reason: String, $every: ReportEvery!,
    $weekday: Int, $day: Int, $hour: Int!, $legalEntityId: ID, $recipients: [ID!]!, $key: String!
  ) {
    createReportSchedule(
      name: $name, segmentId: $segmentId, filter: $filter, kind: $kind, format: $format,
      fields: $fields, reason: $reason, every: $every, weekday: $weekday, day: $day, hour: $hour,
      legalEntityId: $legalEntityId, recipients: $recipients, idempotencyKey: $key
    ) { id }
  }`,

  UpdateReportSchedule: `mutation UpdateReportSchedule(
    $id: ID!, $name: String!, $segmentId: ID, $filter: [ReportConditionInput!], $kind: ReportKind!,
    $format: ReportFormat, $fields: [String!], $reason: String, $every: ReportEvery!,
    $weekday: Int, $day: Int, $hour: Int!, $legalEntityId: ID, $recipients: [ID!]!, $key: String!
  ) {
    updateReportSchedule(
      id: $id, name: $name, segmentId: $segmentId, filter: $filter, kind: $kind, format: $format,
      fields: $fields, reason: $reason, every: $every, weekday: $weekday, day: $day, hour: $hour,
      legalEntityId: $legalEntityId, recipients: $recipients, idempotencyKey: $key
    ) { id }
  }`,

  PauseReportSchedule: `mutation PauseReportSchedule($id: ID!, $key: String!) {
    pauseReportSchedule(id: $id, idempotencyKey: $key) { id }
  }`,

  ResumeReportSchedule: `mutation ResumeReportSchedule($id: ID!, $key: String!) {
    resumeReportSchedule(id: $id, idempotencyKey: $key) { id }
  }`,

  DeleteReportSchedule: `mutation DeleteReportSchedule($id: ID!, $key: String!) {
    deleteReportSchedule(id: $id, idempotencyKey: $key) { id }
  }`,
} as const;

export type OperationName = keyof typeof OPERATIONS;

/** Who the router's safelist and logs know this client as. */
export const CLIENT_NAME = 'kithena-web';
