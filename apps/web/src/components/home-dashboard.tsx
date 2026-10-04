import { Card, CardContent, EmptyState, PageHeader, icons } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

/**
 * Home for a company without People, or with a People that offers no Home
 * of its own: the greeting and an honest empty state rather than zeros that
 * look like facts. With People, People draws Home (design B1, B2).
 */
export interface HomeDashboardProps {
  readonly greeting: string;
  /** The account control a phone shows beside the title. */
  readonly account?: ReactNode;
}

export function HomeDashboard({ greeting, account }: HomeDashboardProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="@3xl/page:pe-64"
        title={`Hi ${greeting}`}
        actions={account ? <span className="flex @3xl/page:hidden">{account}</span> : undefined}
      />
      <Card>
        <CardContent className="pt-5">
          <EmptyState
            icon={<icons.inbox />}
            title="Nothing needs you yet"
            description="Requests, documents and approvals appear here as each module is switched on."
          />
        </CardContent>
      </Card>
    </div>
  );
}
