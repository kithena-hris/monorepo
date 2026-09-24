import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../../load';

/**
 * One endpoint's delivery log, and replaying a delivery (PEO-121; PRD §13.3).
 *
 * What was sent and how it went, newest first, fifty at a time, never a body:
 * a payload is the person's data and the log is not a second copy of it. A
 * replay sends the stored event again, filtered by the endpoint's allowlist
 * as it is now, and appears here as a delivery of its own naming the one it
 * replayed.
 */

export interface Delivery {
  readonly id: string;
  readonly eventName: string;
  /** pending, delivered, failed or skipped. */
  readonly status: string;
  readonly attempts: number;
  readonly lastResponse: number | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly replayOf: string | null;
}

export interface WebhookLogState {
  readonly endpoint: { readonly id: string; readonly url: string; readonly enabled: boolean };
  readonly deliveries: readonly Delivery[];
  readonly next: string | null;
}

export interface WebhookLogProps {
  readonly load: Loadable<WebhookLogState>;
  readonly onReplay: (deliveryId: string) => Promise<Outcome>;
  readonly onBack?: () => void;
  /** The older page; absent on the last. */
  readonly onOlder?: () => void;
  /** Back to the newest; absent on the first page. */
  readonly onNewest?: () => void;
}

const TONE: Partial<Record<string, 'success' | 'danger' | 'warning' | 'neutral'>> = {
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
  skipped: 'neutral',
};

const WORD: Record<string, string> = {
  delivered: 'Delivered',
  failed: 'Failed',
  pending: 'Pending',
  skipped: 'Skipped',
};

/** An instant as the log shows it: to the minute, in UTC, the same on every screen. */
const when = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

export function WebhookLog(props: WebhookLogProps): JSX.Element {
  return (
    <Loaded load={props.load} what="the delivery log">
      {(state) => <Log {...props} state={state} />}
    </Loaded>
  );
}

function Log({
  state,
  onReplay,
  onBack,
  onOlder,
  onNewest,
}: WebhookLogProps & { readonly state: WebhookLogState }): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; result: Outcome } | null>(null);
  const failed = state.deliveries.filter((d) => d.status === 'failed').length;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Delivery log"
        description={`${state.endpoint.url}${state.endpoint.enabled ? '' : ' · turned off'}`}
        actions={onBack === undefined ? undefined : <Button onClick={onBack}>All endpoints</Button>}
      />
      {failed === 0 ? null : (
        <Alert tone="warning">
          {failed === 1 ? 'One delivery' : `${String(failed)} deliveries`} on this page failed.
          Replaying sends the same event again, with the fields the endpoint may receive now.
        </Alert>
      )}
      {outcome === null ? null : outcome.result.ok ? (
        <Alert tone="success">Replayed. It is sent shortly, and listed here as its own delivery.</Alert>
      ) : (
        <Alert tone="danger" title="Not replayed">
          {outcome.result.message}
        </Alert>
      )}
      {state.deliveries.length === 0 ? (
        <EmptyState
          title="Nothing delivered yet"
          description="A delivery appears here once an event this endpoint subscribes to happens."
        />
      ) : (
        <Table aria-label="Deliveries">
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Replay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.deliveries.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <span className="font-medium">{d.eventName}</span>
                  {d.replayOf === null ? null : (
                    <span className="block text-fg-muted text-sm">A replay</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={TONE[d.status] ?? 'neutral'}>
                    {WORD[d.status] ?? d.status}
                  </Badge>
                  {d.lastResponse === null ? null : (
                    <span className="block text-fg-muted text-sm">HTTP {d.lastResponse}</span>
                  )}
                </TableCell>
                <TableCell>{d.attempts}</TableCell>
                <TableCell>{when(d.deliveredAt ?? d.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    loading={busy === d.id}
                    loadingLabel="Replaying"
                    aria-label={`Replay ${d.eventName} from ${when(d.createdAt)}`}
                    onClick={() => {
                      setBusy(d.id);
                      setOutcome(null);
                      void onReplay(d.id).then((result) => {
                        setBusy(null);
                        setOutcome({ id: d.id, result });
                      });
                    }}
                  >
                    Replay
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {onOlder === undefined && onNewest === undefined ? null : (
        <div className="flex flex-wrap gap-2">
          {onNewest === undefined ? null : <Button onClick={onNewest}>Newest</Button>}
          {onOlder === undefined ? null : <Button onClick={onOlder}>Older</Button>}
        </div>
      )}
    </Stack>
  );
}
