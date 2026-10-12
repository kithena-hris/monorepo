import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  List,
  ListItem,
  PageHeader,
  Progress,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { AskDialog, Remind } from '../library/library';
import { Loaded, type Loadable } from '../load';
import { AccessBadge, DocIcon, meta, shortDate } from '../shared';
import type { Created, Outcome, PersonFileData, StartUpload } from '../types';
import { UploadDialog, type UploadInput, type UploadPreset } from '../upload';

/**
 * A person's file (B3, MH2): what their document types require, in order,
 * with the one next action on each row, then every document filed to them.
 * The person and HR see it; HR files to it.
 */

export interface PersonFileProps {
  readonly load: Loadable<PersonFileData>;
  readonly onStartUpload?: StartUpload | undefined;
  readonly onUpload?: ((input: UploadInput) => Promise<Created>) | undefined;
  readonly onAsk?:
    | ((input: {
        personId: string;
        typeKey: string;
        dueOn: string | null;
        message: string;
      }) => Promise<Outcome>)
    | undefined;
  readonly onRemind?: ((requestId: string) => Promise<Outcome>) | undefined;
}

export function PersonFile(props: PersonFileProps): JSX.Element {
  if (props.load.status === 'loading') return <Skeleton shape="page" label="Loading the file" />;
  return (
    <div className="flex flex-col gap-6">
      {props.load.status === 'error' ? <PageHeader title="A person’s file" /> : null}
      <Loaded load={props.load} what="the file">
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

const STATE = {
  have: { label: 'In the file', tone: 'success' },
  asked: { label: 'Asked', tone: 'info' },
  expired: { label: 'Expired', tone: 'danger' },
  missing: { label: 'Missing', tone: 'warning' },
} as const;

function Ready({
  data,
  ...props
}: { readonly data: PersonFileData } & Omit<PersonFileProps, 'load'>): JSX.Element {
  const [asking, setAsking] = useState<string | null>(null);
  const [uploading, setUploading] = useState<UploadPreset | null>(null);
  const first = data.person.name.split(' ')[0] ?? data.person.name;
  return (
    <>
      <PageHeader
        title={data.person.name}
        description={data.jobLine}
        meta={<Avatar name={data.person.name} size="lg" />}
        actions={
          data.hr ? (
            <Button
              variant="primary"
              startIcon={<icons.upload aria-hidden />}
              onClick={() => {
                setUploading({
                  typeKey: null,
                  subjectPersonId: data.person.personId,
                  requestId: null,
                  sectionId: null,
                });
              }}
            >
              File a document
            </Button>
          ) : undefined
        }
      />
      {data.of === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              Required{data.hireDate === null ? '' : ' before day one'} · {data.have} of {data.of}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress
              value={(data.have / data.of) * 100}
              label={`${String(data.have)} of ${String(data.of)} required documents`}
            />
            <List>
              {data.checklist.map((r) => (
                <ListItem
                  key={r.typeKey}
                  leading={<DocIcon kind={r.kind} />}
                  description={[
                    r.detail,
                    r.dueOn === null || r.state === 'have'
                      ? null
                      : `Needed by ${shortDate(r.dueOn)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={
                    <Badge tone={STATE[r.state].tone} size="sm" dot>
                      {STATE[r.state].label}
                    </Badge>
                  }
                  trailing={
                    r.action === 'view' && r.documentId !== null ? (
                      <Button size="sm" variant="secondary" asChild>
                        <a href={`/documents/d/${r.documentId}`}>Open</a>
                      </Button>
                    ) : !data.hr ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setUploading({
                            typeKey: r.typeKey,
                            subjectPersonId: data.person.personId,
                            requestId: r.requestId,
                            sectionId: null,
                          });
                        }}
                      >
                        Add it
                      </Button>
                    ) : r.action === 'remind' && r.requestId !== null ? (
                      <Remind id={r.requestId} onRemind={props.onRemind} />
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setAsking(r.typeKey);
                        }}
                      >
                        Ask
                      </Button>
                    )
                  }
                >
                  {r.name}
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      )}
      <section className="flex flex-col gap-3" aria-labelledby="filed">
        <h2 id="filed" className="text-md font-semibold">
          {data.hr ? `Filed to ${first}` : 'Filed to you'}
        </h2>
        {data.rows.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing filed yet.</p>
        ) : (
          <List>
            {data.rows.map((row) => (
              <ListItem
                key={row.id}
                leading={<DocIcon kind={row.kind} />}
                description={`${meta(row)} · ${shortDate(row.updatedAt)}`}
                meta={<AccessBadge row={row} />}
                chevron
                asChild
              >
                <a href={`/documents/d/${row.id}`}>{row.title}</a>
              </ListItem>
            ))}
          </List>
        )}
      </section>
      {asking === null ? null : (
        <AskDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          personId={data.person.personId}
          name={data.person.name}
          typeKey={asking}
          types={data.types}
          onAsk={props.onAsk}
        />
      )}
      {uploading === null ? null : (
        <UploadDialog
          open
          onOpenChange={(open) => {
            if (!open) setUploading(null);
          }}
          hr={data.hr}
          types={data.types.filter((t) => t.filedTo === 'person')}
          people={[data.person]}
          preset={uploading}
          onStartUpload={props.onStartUpload}
          onUpload={props.onUpload}
          onDone={() => {}}
        />
      )}
    </>
  );
}
