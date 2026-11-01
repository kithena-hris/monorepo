'use client';

import { PerformanceInboxDetail } from '@kithena/contracts';
import { Avatar, Button } from '@reach/ui';
import { useState, type JSX } from 'react';

import { performanceAct } from '../../app/(app)/performance/actions';
import { NoteDialog } from './dialogs';
import { Actions, type BodyProps, OpenHere } from './pane';
import { t as tr } from '../../lib/t';

/**
 * Performance's tasks decided in the Inbox: an unlock asked for, granted or
 * declined with a reason; the peers nominated for someone, approved as they
 * stand. Changing a nomination, writing a review or feedback opens
 * Performance, whose forms those are.
 */

function Unlock({
  item,
  act,
  d,
}: BodyProps & { readonly d: Extract<PerformanceInboxDetail, { kind: 'unlock' }> }): JSX.Element {
  const [declining, setDeclining] = useState(false);
  const who = item.from?.name ?? tr('components.inbox.detail-performance.they', 'They');
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Actions>
        <Button
          disabled={act.pending}
          onClick={() => {
            act.run(
              () =>
                performanceAct('DecidePerformanceUnlock', {
                  id: d.reviewId,
                  input: {
                    approve: true,
                    note: tr('components.inbox.detail-performance.unlocked', 'Unlocked'),
                  },
                }),
              {
                title: tr('components.inbox.detail-performance.unlocked', 'Unlocked'),
                description: tr(
                  'components.inbox.detail-performance.who_can_edit_it_again',
                  '{{who}} can edit it again',
                  { who },
                ),
                next: true,
              },
            );
          }}
        >
          {tr('components.inbox.detail-performance.unlock', 'Unlock')}
        </Button>
        <Button
          variant="secondary"
          disabled={act.pending}
          onClick={() => {
            setDeclining(true);
          }}
        >
          {tr('components.inbox.detail-performance.decline', 'Decline')}
        </Button>
      </Actions>
      {declining ? (
        <NoteDialog
          title={tr('components.inbox.detail-performance.decline_the_unlock', 'Decline the unlock')}
          description={tr(
            'components.inbox.detail-performance.who_sees_your_reason',
            '{{who}} sees your reason.',
            { who },
          )}
          label={tr('components.inbox.detail-performance.reason', 'Reason')}
          confirm={tr('components.inbox.detail-performance.decline', 'Decline')}
          onClose={() => {
            setDeclining(false);
          }}
          onConfirm={(note) => {
            setDeclining(false);
            act.run(
              () =>
                performanceAct('DecidePerformanceUnlock', {
                  id: d.reviewId,
                  input: { approve: false, note },
                }),
              {
                title: tr('components.inbox.detail-performance.declined', 'Declined'),
                next: true,
              },
            );
          }}
        />
      ) : null}
    </div>
  );
}

function Nominations({
  item,
  act,
  d,
}: BodyProps & {
  readonly d: Extract<PerformanceInboxDetail, { kind: 'nominations' }>;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <ul className="flex flex-col gap-2">
        {d.nominees.map((n) => (
          <li key={n.personId} className="flex items-center gap-2">
            <Avatar name={n.name} size="xs" />
            <span>{n.name}</span>
          </li>
        ))}
      </ul>
      <Actions>
        <Button
          disabled={act.pending || d.nominees.length === 0}
          onClick={() => {
            act.run(
              () =>
                performanceAct('DecidePerformanceNominations', {
                  id: d.nominationId,
                  input: {
                    decisions: d.nominees.map((n) => ({
                      personId: n.personId,
                      approve: true,
                      reason: null,
                    })),
                    replacements: [],
                  },
                }),
              {
                title: tr('components.inbox.detail-performance.approved', 'Approved'),
                description: tr(
                  'components.inbox.detail-performance.they_are_asked_for_their_review',
                  'Each is asked for their review',
                ),
                next: true,
              },
            );
          }}
        >
          {tr('components.inbox.detail-performance.approve_all', 'Approve all')}
        </Button>
        <OpenHere href={item.link} variant="secondary">
          {tr('components.inbox.detail-performance.change_someone', 'Change someone')}
        </OpenHere>
      </Actions>
    </div>
  );
}

export function PerformanceBody(props: BodyProps): JSX.Element {
  const parsed = PerformanceInboxDetail.safeParse(props.item.detail);
  if (parsed.success && props.item.lane === 'task') {
    const d = parsed.data;
    return d.kind === 'unlock' ? <Unlock {...props} d={d} /> : <Nominations {...props} d={d} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {props.item.summary === null ? null : (
        <p className="text-base text-fg-muted">{props.item.summary}</p>
      )}
      <Actions>
        <OpenHere href={props.item.link}>
          {tr('components.inbox.detail-performance.open_in_performance', 'Open in Performance')}
        </OpenHere>
      </Actions>
    </div>
  );
}
