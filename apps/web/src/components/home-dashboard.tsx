import { Card, CardContent, EmptyState, PageHeader, icons } from '@reach/ui';
import type { JSX, ReactNode } from 'react';
import { t } from '../lib/t';

/**
 * Home for a company without People, or with a People that offers no Home
 * of its own: the greeting and an honest empty state rather than zeros that
 * look like facts. With People, People draws Home (design B1, B2).
 */
export interface HomeDashboardProps {
  readonly greeting: string;
  /** The account control a phone shows beside the title. */
  readonly account?: ReactNode;
  /** The Inbox's first rows (B1), from every module the company has. */
  readonly toDo?: ReactNode;
}

export function HomeDashboard({ greeting, account, toDo }: HomeDashboardProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="@3xl/page:pe-64"
        title={t('components.home-dashboard.hi', 'Hi {{greeting}}', { greeting })}
        actions={account ? <span className="flex @3xl/page:hidden">{account}</span> : undefined}
      />
      {toDo ?? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              icon={<icons.inbox />}
              title={t('components.home-dashboard.nothing_needs_you_yet', 'Nothing needs you yet')}
              description={t(
                'components.home-dashboard.requests_documents_and_approvals_appear_here_as',
                'Requests, documents and approvals appear here as each module is switched on.',
              )}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
