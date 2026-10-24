import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Stack,
  usePages,
} from '@reach/ui';
import { useCallback, useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../../load';
import { t } from '../../i18n';

/**
 * One endpoint's delivery log, and replaying a delivery (PEO-121; PRD §13.3).
 *
 * What was sent and how it went, newest first, never a body, older pages of
 * fifty loading as the log scrolls (`onLoadMore`, from the last one's cursor):
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
  /** The page after `after`: People's answer for it, as the first page's, or null. */
  readonly onLoadMore?: (after: string) => Promise<unknown>;
}

const TONE: Partial<Record<string, 'success' | 'danger' | 'warning' | 'neutral'>> = {
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
  skipped: 'neutral',
};

const WORD: Record<string, string> = {
  get delivered(): string {
    return t('settings.integrations.webhook-log.delivered', 'Delivered');
  },
  get failed(): string {
    return t('settings.integrations.webhook-log.failed', 'Failed');
  },
  get pending(): string {
    return t('settings.integrations.webhook-log.pending', 'Pending');
  },
  get skipped(): string {
    return t('settings.integrations.webhook-log.skipped', 'Skipped');
  },
};

/** An instant as the log shows it: to the minute, in UTC, the same on every screen. */
const when = (iso: string): string =>
  t('settings.integrations.webhook-log.utc', '{{replace}} UTC', {
    replace: iso.slice(0, 16).replace('T', ' '),
  });

export function WebhookLog(props: WebhookLogProps): JSX.Element {
  return (
    <Loaded
      load={props.load}
      what={t('settings.integrations.webhook-log.the_delivery_log', 'the delivery log')}
    >
      {(state) => <Log {...props} state={state} />}
    </Loaded>
  );
}

function Log({
  state,
  onReplay,
  onBack,
  onLoadMore,
}: WebhookLogProps & { readonly state: WebhookLogState }): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; result: Outcome } | null>(null);
  const more = useCallback(
    async (after: string) => {
      const page = (await onLoadMore?.(after)) as WebhookLogState | null | undefined;
      return page == null ? null : { items: page.deliveries, next: page.next };
    },
    [onLoadMore],
  );
  const pages = usePages(state.deliveries, state.next, onLoadMore === undefined ? undefined : more);
  const deliveries = pages.items;
  const failed = deliveries.filter((d) => d.status === 'failed').length;

  return (
    <Stack gap={6}>
      <PageHeader
        title={t('settings.integrations.webhook-log.delivery_log', 'Delivery log')}
        description={
          state.endpoint.enabled
            ? state.endpoint.url
            : t('settings.integrations.webhook-log.url_turned_off', '{{url}} · turned off', {
                url: state.endpoint.url,
              })
        }
        actions={
          onBack === undefined ? undefined : (
            <Button onClick={onBack}>
              {t('settings.integrations.webhook-log.all_endpoints', 'All endpoints')}
            </Button>
          )
        }
      />
      {failed === 0 ? null : (
        <Alert tone="warning">
          {failed === 1
            ? t('settings.integrations.webhook-log.one_delivery', 'One delivery')
            : t('settings.integrations.webhook-log.deliveries', '{{failed}} deliveries', {
                failed: String(failed),
              })}{' '}
          {t(
            'settings.integrations.webhook-log.shown_here_failed_replaying_sends_the',
            'shown here failed. Replaying sends the same event again, with the fields the endpoint may receive now.',
          )}
        </Alert>
      )}
      {outcome === null ? null : outcome.result.ok ? (
        <Alert tone="success">
          {t(
            'settings.integrations.webhook-log.replayed_it_is_sent_shortly_and',
            'Replayed. It is sent shortly, and listed here as its own delivery.',
          )}
        </Alert>
      ) : (
        <Alert
          tone="danger"
          title={t('settings.integrations.webhook-log.not_replayed', 'Not replayed')}
        >
          {outcome.result.message}
        </Alert>
      )}
      {deliveries.length === 0 ? (
        <EmptyState
          title={t(
            'settings.integrations.webhook-log.nothing_delivered_yet',
            'Nothing delivered yet',
          )}
          description={t(
            'settings.integrations.webhook-log.a_delivery_appears_here_once_an',
            'A delivery appears here once an event this endpoint subscribes to happens.',
          )}
        />
      ) : (
        <DataTable<Delivery>
          label={t('settings.integrations.webhook-log.deliveries_2', 'Deliveries')}
          rows={deliveries}
          rowId={(d) => d.id}
          describeRow={(d) => d.eventName}
          // Infinite: the log is the page's one scroll, older deliveries load
          // near its end, and only the rows on screen are drawn.
          fill
          {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
          loadingMore={pages.loading}
          columns={[
            {
              id: 'event',
              header: t('settings.integrations.webhook-log.event', 'Event'),
              cell: (d) => (
                <>
                  <span className="font-medium">{d.eventName}</span>
                  {d.replayOf === null ? null : (
                    <span className="block text-fg-muted text-sm">
                      {t('settings.integrations.webhook-log.a_replay', 'A replay')}
                    </span>
                  )}
                </>
              ),
            },
            {
              id: 'status',
              header: t('settings.integrations.webhook-log.status', 'Status'),
              cardTrailing: true,
              cell: (d) => (
                <>
                  <Badge tone={TONE[d.status] ?? 'neutral'}>{WORD[d.status] ?? d.status}</Badge>
                  {d.lastResponse === null ? null : (
                    <span className="block text-fg-muted text-sm">
                      {t('settings.integrations.webhook-log.http', 'HTTP')} {d.lastResponse}
                    </span>
                  )}
                </>
              ),
            },
            {
              id: 'attempts',
              header: t('settings.integrations.webhook-log.attempts', 'Attempts'),
              shortHeader: t('settings.integrations.webhook-log.attempts', 'Attempts'),
              numeric: true,
              cell: (d) => d.attempts,
            },
            {
              id: 'sent',
              header: t('settings.integrations.webhook-log.sent', 'Sent'),
              cell: (d) => when(d.deliveredAt ?? d.createdAt),
            },
            {
              id: 'replay',
              header: t('settings.integrations.webhook-log.replay', 'Replay'),
              cell: (d) => (
                <Button
                  size="sm"
                  loading={busy === d.id}
                  loadingLabel={t('settings.integrations.webhook-log.replaying', 'Replaying')}
                  aria-label={t(
                    'settings.integrations.webhook-log.replay_from',
                    'Replay {{eventName}} from {{createdAt}}',
                    { eventName: d.eventName, createdAt: when(d.createdAt) },
                  )}
                  onClick={() => {
                    setBusy(d.id);
                    setOutcome(null);
                    void onReplay(d.id).then((result) => {
                      setBusy(null);
                      setOutcome({ id: d.id, result });
                    });
                  }}
                >
                  {t('settings.integrations.webhook-log.replay', 'Replay')}
                </Button>
              ),
            },
          ]}
        />
      )}
    </Stack>
  );
}
