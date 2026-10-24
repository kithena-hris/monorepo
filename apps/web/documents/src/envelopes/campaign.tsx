import {
  Avatar,
  Card,
  CardContent,
  List,
  ListItem,
  PageHeader,
  Progress,
  Skeleton,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { shortDate } from '../shared';
import type { CampaignData } from '../types';
import { t } from '../i18n';

/** Tracking acknowledgements (F3, MH5): done of total, and who is left. */
export function Campaign({ load }: { readonly load: Loadable<CampaignData> }): JSX.Element {
  if (load.status === 'loading')
    return (
      <Skeleton
        shape="page"
        label={t('envelopes.campaign.loading_the_policy', 'Loading the policy')}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={t('envelopes.campaign.acknowledgements', 'Acknowledgements')} />
      ) : null}
      <Loaded load={load} what={t('envelopes.campaign.the_policy', 'the policy')}>
        {(c) => (
          <>
            <PageHeader
              title={c.title}
              description={
                c.dueOn === null
                  ? t('envelopes.campaign.version_sent', 'Version {{version}} · sent {{sentAt}}', {
                      version: c.version,
                      sentAt: shortDate(c.sentAt),
                    })
                  : t(
                      'envelopes.campaign.version_sent_due',
                      'Version {{version}} · sent {{sentAt}} · due {{dueOn}}',
                      {
                        version: c.version,
                        sentAt: shortDate(c.sentAt),
                        dueOn: shortDate(c.dueOn),
                      },
                    )
              }
            />
            <Card padded className="max-w-2xl">
              <CardContent className="flex flex-col gap-3 p-0 first:pt-0 touch:first:pt-0">
                <span className="text-2xl font-semibold tabular-nums">
                  {t('envelopes.campaign.of_done', '{{done}} of {{of}} done', {
                    done: String(c.done),
                    of: String(c.of),
                  })}
                </span>
                <Progress
                  value={c.of === 0 ? 0 : (c.done / c.of) * 100}
                  label={t(
                    'envelopes.campaign.of_acknowledged',
                    '{{done}} of {{of}} acknowledged',
                    { done: String(c.done), of: String(c.of) },
                  )}
                />
              </CardContent>
            </Card>
            <section className="flex max-w-2xl flex-col gap-3" aria-labelledby="left">
              <h2 id="left" className="text-md font-semibold">
                {t('envelopes.campaign.still_to_go', 'Still to go')}
              </h2>
              {c.left.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {t('envelopes.campaign.everybody_has_read_it', 'Everybody has read it.')}
                </p>
              ) : (
                <List>
                  {c.left.map((p) => (
                    <ListItem
                      key={p.personId}
                      leading={<Avatar name={p.name} size="md" />}
                      description={p.teamName ?? undefined}
                    >
                      {p.name}
                    </ListItem>
                  ))}
                </List>
              )}
            </section>
          </>
        )}
      </Loaded>
    </div>
  );
}
