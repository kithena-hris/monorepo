/**
 * Every GraphQL operation the tenant app sends Documents, through the router
 * (DOC-030): Time Off's rule (`timeoff-operations.ts`), for the third area.
 *
 * One query per screen and one mutation per write, each asking for its whole
 * answer. The router's safelist is generated from this file
 * (`pnpm --filter @kithena/gateway persist`), so an operation not here is
 * refused before Documents sees it. A write's idempotency key is `$key`; its
 * `input` is the REST route's JSON body.
 *
 * Plain text, no `server-only`: the generator reads it too.
 */

const PERSON = 'personId name teamName';
const ROW = `id title kind typeKey typeName level confidential everyone who { label people { ${PERSON} } } subject { ${PERSON} } pages mediaType updatedAt expiresOn status { label tone } mine aboutMe deletedAt sectionIds`;
const TYPE = 'key name kind filedTo confidential';

const write = (name: string, field: string, params: string, args: string, answer: string) =>
  `mutation ${name}(${params}$key: String!) {
    ${field}(${args}idempotencyKey: $key) { ${answer} }
  }`;

export const OPERATIONS = {
  /** B1, B2, B6, H1, H3: the Documents screen, filtered in place */
  DocumentsLibrary: `query DocumentsLibrary($show: String, $q: String, $queue: String, $deleted: Boolean) {
    documentsLibrary(show: $show, q: $q, queue: $queue, deleted: $deleted) {
      viewer { hr name personId askAfterUpload } show q queue deleted
      sections { id kind name count }
      needsYou { id kind title detail dueOn documentId typeKey }
      tiles { key label count detail }
      queueRows { id title kind person { ${PERSON} } detail dueOn tone documentId requestId typeKey action }
      rows { ${ROW} } total types { ${TYPE} } people { ${PERSON} }
    }
  }`,

  /** D1, E2, E3: a document, or who owns it */
  DocumentsDocument: `query DocumentsDocument($documentId: String!) {
    documentsDocument(documentId: $documentId) {
      document {
        row { ${ROW} } owner
        versions { n fileName mediaType size pages note uploadedAt uploadedBy }
        current { n fileName mediaType size pages note uploadedAt uploadedBy }
        grants { kind id label permission endsOn }
        may { edit share download delete protect unprotect }
        confidentialBy views { who action at } activity { who action at }
        accessRequests { id who reason at } held people { ${PERSON} }
        signing { id status signed of mine } campaigns { id done of dueOn acknowledged asked } pdf
      }
      closed { owner requested }
    }
  }`,

  /** A version's bytes: watermarked for a Confidential view */
  DocumentsFile: `query DocumentsFile($documentId: String!, $version: Int, $mode: String, $device: String) {
    documentsFile(documentId: $documentId, version: $version, mode: $mode, device: $device) {
      fileName mediaType url base64 original
    }
  }`,

  /** B3: a person's file */
  DocumentsPersonFile: `query DocumentsPersonFile($personId: String!) {
    documentsPersonFile(personId: $personId) {
      person { ${PERSON} } jobLine hireDate have of hr
      checklist { typeKey name kind state detail documentId requestId dueOn action }
      rows { ${ROW} } types { ${TYPE} }
    }
  }`,

  /** K10: every signature request this person follows or signs */
  DocumentsEnvelopes: `query DocumentsEnvelopes {
    documentsEnvelopes { rows { id documentId title status signed of waitingOn dueOn createdAt needsYou } }
  }`,

  /** K4, K8: a signature request as its signer or its sender sees it */
  DocumentsEnvelope: `query DocumentsEnvelope($envelopeId: String!) {
    documentsEnvelope(envelopeId: $envelopeId) {
      id documentId title version pages status message dueOn createdAt completedAt signedVersion sender voidReason follows
      signers { id order name email check status signedAt allowDelegate }
      fields { id signerId kind page x y w h required label value }
      me { signerId status turn }
      trail { who action at note } people { personId name }
    }
  }`,

  /** The version being signed, or the sealed one */
  DocumentsEnvelopeFile: `query DocumentsEnvelopeFile($envelopeId: String!) {
    documentsEnvelopeFile(envelopeId: $envelopeId) { fileName mediaType url base64 original }
  }`,

  /** F3: who has acknowledged a policy */
  DocumentsCampaign: `query DocumentsCampaign($campaignId: String!) {
    documentsCampaign(campaignId: $campaignId) {
      id documentId title version dueOn sentAt done of left { personId name teamName }
    }
  }`,

  /** What Documents has in this person's Inbox (DOC-025) */
  DocumentsInbox: `query DocumentsInbox {
    documentsInbox {
      items { area at count detail due dueVerb from { name personId } icon id kind lane link message module openIn outcome { label tone } replies status { label tone } summary team { mine role takenAt takenBy { name personId } } title tone }
    }
  }`,

  /** S1–S6: settings */
  DocumentsSettings: `query DocumentsSettings {
    documentsSettings {
      types {
        key name kind filedTo audience confidential medical signers acknowledge requiredFor requiredBy
        expiryReminders retention aiReads aiEnabled archived used retentionWords
      }
      sections { id kind name count }
      access { askAfterUpload peopleMayTurnOffQuestion everyoneShare companyLinks outsideSharing watermark blockDownload personalSections }
      holds { id name setBy setAt count } hr
      ai { summaries questions across sorting fields }
    }
  }`,

  StartDocumentsUpload: write(
    'StartDocumentsUpload',
    'startDocumentsUpload',
    '$input: JSON!, ',
    'input: $input, ',
    'uploadId url method headers',
  ),
  UploadDocument: write(
    'UploadDocument',
    'uploadDocument',
    '$input: JSON!, ',
    'input: $input, ',
    'id',
  ),
  AddDocumentVersion: write(
    'AddDocumentVersion',
    'addDocumentVersion',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'version',
  ),
  ShareDocument: write(
    'ShareDocument',
    'shareDocument',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  SetDocumentConfidential: write(
    'SetDocumentConfidential',
    'setDocumentConfidential',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  RenameDocument: write(
    'RenameDocument',
    'renameDocument',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  SetDocumentExpiry: write(
    'SetDocumentExpiry',
    'setDocumentExpiry',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  DeleteDocument: write(
    'DeleteDocument',
    'deleteDocument',
    '$documentId: String!, ',
    'documentId: $documentId, ',
    'id',
  ),
  RestoreDocument: write(
    'RestoreDocument',
    'restoreDocument',
    '$documentId: String!, ',
    'documentId: $documentId, ',
    'id',
  ),
  RequestDocumentAccess: write(
    'RequestDocumentAccess',
    'requestDocumentAccess',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  DecideDocumentAccess: write(
    'DecideDocumentAccess',
    'decideDocumentAccess',
    '$requestId: String!, $input: JSON!, ',
    'requestId: $requestId, input: $input, ',
    'id',
  ),
  CreateDocumentSection: write(
    'CreateDocumentSection',
    'createDocumentSection',
    '$input: JSON!, ',
    'input: $input, ',
    'id',
  ),
  ChangeDocumentSection: write(
    'ChangeDocumentSection',
    'changeDocumentSection',
    '$sectionId: String!, $input: JSON!, ',
    'sectionId: $sectionId, input: $input, ',
    'id',
  ),
  AskForDocument: write(
    'AskForDocument',
    'askForDocument',
    '$input: JSON!, ',
    'input: $input, ',
    'id',
  ),
  RemindDocumentRequest: write(
    'RemindDocumentRequest',
    'remindDocumentRequest',
    '$requestId: String!, ',
    'requestId: $requestId, ',
    'id',
  ),
  CancelDocumentRequest: write(
    'CancelDocumentRequest',
    'cancelDocumentRequest',
    '$requestId: String!, ',
    'requestId: $requestId, ',
    'id',
  ),
  PlaceLegalHold: write(
    'PlaceLegalHold',
    'placeLegalHold',
    '$input: JSON!, ',
    'input: $input, ',
    'id',
  ),
  LiftLegalHold: write(
    'LiftLegalHold',
    'liftLegalHold',
    '$holdId: String!, ',
    'holdId: $holdId, ',
    'id',
  ),
  ConfirmDocumentDeletion: write(
    'ConfirmDocumentDeletion',
    'confirmDocumentDeletion',
    '$input: JSON!, ',
    'input: $input, ',
    'deleted',
  ),
  SaveDocumentType: write(
    'SaveDocumentType',
    'saveDocumentType',
    '$typeKey: String!, $input: JSON!, ',
    'typeKey: $typeKey, input: $input, ',
    'key',
  ),
  SetDocumentAccessSettings: write(
    'SetDocumentAccessSettings',
    'setDocumentAccessSettings',
    '$input: JSON!, ',
    'input: $input, ',
    'ok',
  ),
  SetAskAfterUpload: write(
    'SetAskAfterUpload',
    'setAskAfterUpload',
    '$input: JSON!, ',
    'input: $input, ',
    'ok',
  ),
  SendForSignature: write(
    'SendForSignature',
    'sendForSignature',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  SignEnvelope: write(
    'SignEnvelope',
    'signEnvelope',
    '$envelopeId: String!, $input: JSON!, ',
    'envelopeId: $envelopeId, input: $input, ',
    'completed',
  ),
  DeclineEnvelope: write(
    'DeclineEnvelope',
    'declineEnvelope',
    '$envelopeId: String!, $input: JSON!, ',
    'envelopeId: $envelopeId, input: $input, ',
    'id',
  ),
  AskEnvelopeSender: write(
    'AskEnvelopeSender',
    'askEnvelopeSender',
    '$envelopeId: String!, $input: JSON!, ',
    'envelopeId: $envelopeId, input: $input, ',
    'id',
  ),
  VoidEnvelope: write(
    'VoidEnvelope',
    'voidEnvelope',
    '$envelopeId: String!, $input: JSON!, ',
    'envelopeId: $envelopeId, input: $input, ',
    'id',
  ),
  RemindEnvelope: write(
    'RemindEnvelope',
    'remindEnvelope',
    '$envelopeId: String!, ',
    'envelopeId: $envelopeId, ',
    'id',
  ),
  ReassignEnvelopeSigner: write(
    'ReassignEnvelopeSigner',
    'reassignEnvelopeSigner',
    '$envelopeId: String!, $input: JSON!, ',
    'envelopeId: $envelopeId, input: $input, ',
    'id',
  ),
  SealEnvelope: write(
    'SealEnvelope',
    'sealEnvelope',
    '$envelopeId: String!, $input: JSON!, ',
    'envelopeId: $envelopeId, input: $input, ',
    'version',
  ),
  SendForAcknowledgement: write(
    'SendForAcknowledgement',
    'sendForAcknowledgement',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'id',
  ),
  AcknowledgeDocument: write(
    'AcknowledgeDocument',
    'acknowledgeDocument',
    '$campaignId: String!, ',
    'campaignId: $campaignId, ',
    'id',
  ),
  /** D1, MR1: the document in plain words, each claim cited to its page */
  DocumentSummary: `query DocumentSummary($documentId: String!) {
    documentSummary(documentId: $documentId) {
      available reason summary { text pages } facts { label value page } watch { text pages } questions dates
    }
  }`,
  /** D2, MR2: a question about one document */
  AskDocument: write(
    'AskDocument',
    'askDocument',
    '$documentId: String!, $input: JSON!, ',
    'documentId: $documentId, input: $input, ',
    'available reason answer { text pages } sources { documentId title pages }',
  ),
  /** B4, MR5: a question across what the asker may open */
  AskDocuments: write(
    'AskDocuments',
    'askDocuments',
    '$input: JSON!, ',
    'input: $input, ',
    'available reason answer { text pages } sources { documentId title pages }',
  ),
  /** D3: what changed between two versions */
  CompareDocumentVersions: `query CompareDocumentVersions($documentId: String!, $from: Int!, $to: Int!) {
    compareDocumentVersions(documentId: $documentId, from: $from, to: $to) { available added removed sentences }
  }`,
  /** C1: what an upload looks like it is */
  SuggestDocumentFiling: write(
    'SuggestDocumentFiling',
    'suggestDocumentFiling',
    '$uploadId: String!, $input: JSON!, ',
    'uploadId: $uploadId, input: $input, ',
    'available title typeKey subjectPersonId expiresOn',
  ),
  /** S4: a type described in words */
  DescribeDocumentType: write(
    'DescribeDocumentType',
    'describeDocumentType',
    '$input: JSON!, ',
    'input: $input, ',
    'available question type { key name kind filedTo audience confidential medical signers acknowledge requiredFor requiredBy expiryReminders retention aiReads aiEnabled }',
  ),
  /** S7: the company's switches */
  SetDocumentsAiSettings: write(
    'SetDocumentsAiSettings',
    'setDocumentsAiSettings',
    '$input: JSON!, ',
    'input: $input, ',
    'ok',
  ),
} as const;

export type OperationName = keyof typeof OPERATIONS;
