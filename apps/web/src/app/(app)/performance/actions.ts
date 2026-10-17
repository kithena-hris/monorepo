'use server';

import { performance } from '../../../lib/people';
import { OPERATIONS, type OperationName } from '../../../lib/performance-operations';
import type { Done } from '../recruiting/actions';

/**
 * What the Performance screens' buttons do (PRF-070): Onboarding's one server
 * action, for Performance's operations. The router accepts only the persisted
 * operations, and Performance decides whether this person may. Reads that a
 * dialog asks for on its own (a picker's search, a preview, a PDF) go
 * through here too.
 */
export async function performanceAct(
  name: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<Done> {
  if (!Object.hasOwn(OPERATIONS, name) || name === 'PerformanceLive')
    return { ok: false, message: 'Not something this page can do' };
  const answer = await performance<unknown>(name as OperationName, { ...variables });
  return answer.ok
    ? { ok: true, data: answer.data }
    : { ok: false, message: answer.message, code: answer.code };
}
