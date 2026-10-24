'use server';

import { onboarding } from '../../../lib/people';
import type { OperationName } from '../../../lib/onboarding-operations';
import type { Done } from '../recruiting/actions';
import { serverWords } from '../../../lib/server-words';

/**
 * What the Onboarding screens' buttons do (ONB-010): Recruiting's one server
 * action, for Onboarding's writes. The router accepts only the persisted
 * operations, and Onboarding decides whether this person may.
 */

const WRITES = new Set<OperationName>([
  'CompleteOnboardingTask',
  'ReopenOnboardingTask',
  'SetOnboardingBuddy',
  'MoveOnboardingStart',
  'OnboardingCheckIn',
  'ReviewProbation',
  'SaveOnboardingTemplate',
  'SaveOnboardingSettings',
  'AddHire',
]);

export async function onboardingAct(
  name: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<Done> {
  const t = await serverWords();
  if (!WRITES.has(name as OperationName))
    return {
      ok: false,
      message: t(
        'app.app.onboarding.actions.not_something_this_page_can_do',
        'Not something this page can do',
      ),
    };
  const answer = await onboarding<unknown>(name as OperationName, { ...variables });
  return answer.ok
    ? { ok: true, data: answer.data }
    : { ok: false, message: answer.message, code: answer.code };
}
