/**
 * Every GraphQL operation the tenant app sends Onboarding, through the router
 * (ONB-010): Recruiting's rule (`recruiting-operations.ts`). One query per
 * screen, one mutation per write; `$key` is the idempotency key and `input`
 * the REST route's JSON body. The router's safelist is generated from this
 * file (`pnpm --filter @kithena/gateway persist`).
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

const PLAN = ['$planId: String!, ', 'planId: $planId, '] as const;
const TASK = [
  '$planId: String!, $taskId: String!, ',
  'planId: $planId, taskId: $taskId, ',
] as const;

export const OPERATIONS = {
  /** O1, O6 */
  OnboardingBoard: query('OnboardingBoard', 'onboardingBoard', '$state: String', 'state: $state'),
  /** O3 */
  OnboardingPlan: query('OnboardingPlan', 'onboardingPlan', '$planId: String!', 'planId: $planId'),
  /** O4 */
  OnboardingTasks: query('OnboardingTasks', 'onboardingTasks'),
  /** O2 */
  OnboardingTemplates: query('OnboardingTemplates', 'onboardingTemplates'),
  /** O7 */
  OnboardingSettings: query('OnboardingSettings', 'onboardingSettings'),
  /** O9 */
  OnboardingAnalytics: query('OnboardingAnalytics', 'onboardingAnalytics'),
  /** What Onboarding has in this person's Inbox (ONB-012) */
  OnboardingInbox: `query OnboardingInbox {
    onboardingInbox {
      items { area at count detail due dueVerb from { name personId } icon id kind lane link message module openIn outcome { label tone } replies status { label tone } summary team { mine role takenAt takenBy { name personId } } title tone }
    }
  }`,

  CompleteOnboardingTask: write('CompleteOnboardingTask', 'completeOnboardingTask', ...TASK, false),
  ReopenOnboardingTask: write('ReopenOnboardingTask', 'reopenOnboardingTask', ...TASK, false),
  SetOnboardingBuddy: write('SetOnboardingBuddy', 'setOnboardingBuddy', ...PLAN),
  MoveOnboardingStart: write('MoveOnboardingStart', 'moveOnboardingStart', ...PLAN),
  OnboardingCheckIn: write('OnboardingCheckIn', 'onboardingCheckIn', ...PLAN),
  ReviewProbation: write('ReviewProbation', 'reviewOnboardingProbation', ...PLAN),
  SaveOnboardingTemplate: write(
    'SaveOnboardingTemplate',
    'saveOnboardingTemplate',
    '$id: String!, ',
    'id: $id, ',
  ),
  SaveOnboardingSettings: write('SaveOnboardingSettings', 'saveOnboardingSettings'),
  AddHire: write('AddHire', 'addOnboardingHire'),
} as const;

export type OperationName = keyof typeof OPERATIONS;
