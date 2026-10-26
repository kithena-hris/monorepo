import { redirect } from 'next/navigation';

import { onboarding } from '../../../../lib/people';

/**
 * The signed-in person's own plan: where a hire lands after registering
 * (`apps/auth`'s enrol page). Without one, home.
 */
export default async function Mine(): Promise<never> {
  const board = await onboarding<{ rows: { id: string; mine: boolean }[] }>('OnboardingBoard', {
    state: null,
  });
  const plan = board.ok ? board.data.rows.find((r) => r.mine) : undefined;
  redirect(plan === undefined ? '/' : `/onboarding/plans/${plan.id}`);
}
