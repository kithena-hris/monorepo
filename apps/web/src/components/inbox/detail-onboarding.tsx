'use client';

import { OnboardingTaskDetail } from '@kithena/contracts';
import { Button } from '@reach/ui';
import type { JSX } from 'react';

import { onboardingAct } from '../../app/(app)/onboarding/actions';
import { Actions, type BodyProps, OpenHere } from './pane';
import { t as tr } from '../../lib/t';

/**
 * An onboarding task, ticked off in the Inbox. What it links (a People form,
 * a Documents request, a policy, a goal) opens beside it; the plan it belongs
 * to is one step further.
 */
export function OnboardingBody({ item, act }: BodyProps): JSX.Element {
  const parsed = OnboardingTaskDetail.safeParse(item.detail);
  const d = parsed.success && item.lane === 'task' ? parsed.data : null;
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Actions>
        {d === null ? null : (
          <Button
            disabled={act.pending}
            onClick={() => {
              act.run(
                () =>
                  onboardingAct('CompleteOnboardingTask', { planId: d.planId, taskId: d.taskId }),
                {
                  title: tr('components.inbox.detail-onboarding.done', 'Done: {{title}}', {
                    title: item.title,
                  }),
                  undo: () =>
                    onboardingAct('ReopenOnboardingTask', { planId: d.planId, taskId: d.taskId }),
                  next: true,
                },
              );
            }}
          >
            {tr('components.inbox.detail-onboarding.mark_done', 'Mark done')}
          </Button>
        )}
        {d?.link == null ? null : (
          <OpenHere href={d.link} variant="secondary">
            {tr('components.inbox.detail-onboarding.do_it', 'Do it')}
          </OpenHere>
        )}
        <OpenHere href={item.link} variant="ghost">
          {tr('components.inbox.detail-onboarding.see_the_plan', 'See the plan')}
        </OpenHere>
      </Actions>
    </div>
  );
}
