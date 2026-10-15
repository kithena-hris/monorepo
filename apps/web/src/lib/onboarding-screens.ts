import 'server-only';

import { onboarding } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import type { OperationName } from './onboarding-operations';

/**
 * The data each Onboarding screen is drawn from, fetched on the server before
 * the page is sent, through the router, as the person signed in (ONB-010).
 */

async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<ScreenLoad> {
  const answer = await onboarding<unknown>(name, variables);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  const state = query.search['state'];
  switch (component) {
    case 'Home':
      return read('OnboardingBoard', { state: state === undefined || state === '' ? null : state });
    case 'Plan':
      return read('OnboardingPlan', { planId: query.params['id'] ?? '' });
    case 'Tasks':
      return read('OnboardingTasks');
    case 'Templates':
      return read('OnboardingTemplates');
    case 'Settings':
      return read('OnboardingSettings');
    case 'Analytics':
      return read('OnboardingAnalytics');
    default:
      return { status: 'none' };
  }
}
