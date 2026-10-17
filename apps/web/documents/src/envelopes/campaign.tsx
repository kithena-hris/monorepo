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

/** Tracking acknowledgements (F3, MH5): done of total, and who is left. */
export function Campaign({ load }: { readonly load: Loadable<CampaignData> }): JSX.Element {
  if (load.status === 'loading') return <Skeleton shape="page" label="Loading the policy" />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Acknowledgements" /> : null}
      <Loaded load={load} what="the policy">
        {(c) => (
          <>
            <PageHeader
              title={c.title}
              description={`Version ${String(c.version)} · sent ${shortDate(c.sentAt)}${c.dueOn === null ? '' : ` · due ${shortDate(c.dueOn)}`}`}
            />
            <Card padded className="max-w-2xl">
              <CardContent className="flex flex-col gap-3 p-0 first:pt-0 touch:first:pt-0">
                <span className="text-2xl font-semibold tabular-nums">{`${String(c.done)} of ${String(c.of)} done`}</span>
                <Progress
                  value={c.of === 0 ? 0 : (c.done / c.of) * 100}
                  label={`${String(c.done)} of ${String(c.of)} acknowledged`}
                />
              </CardContent>
            </Card>
            <section className="flex max-w-2xl flex-col gap-3" aria-labelledby="left">
              <h2 id="left" className="text-md font-semibold">
                Still to go
              </h2>
              {c.left.length === 0 ? (
                <p className="text-sm text-fg-muted">Everybody has read it.</p>
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
