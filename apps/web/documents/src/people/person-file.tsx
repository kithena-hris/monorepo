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
import { t as tr } from '../i18n';

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
  if (props.load.status === 'loading')
    return (
      <Skeleton
        shape="page"
        label={tr('people.person-file.loading_the_file', 'Loading the file')}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      {props.load.status === 'error' ? (
        <PageHeader title={tr('people.person-file.a_persons_file', 'A person’s file')} />
      ) : null}
      <Loaded load={props.load} what={tr('people.person-file.the_file', 'the file')}>
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

const STATE = {
  have: {
    get label(): string {
      return tr('people.person-file.in_the_file', 'In the file');
    },
    tone: 'success',
  },
  asked: {
    get label(): string {
      return tr('people.person-file.asked', 'Asked');
    },
    tone: 'info',
  },
  expired: {
    get label(): string {
      return tr('people.person-file.expired', 'Expired');
    },
    tone: 'danger',
  },
  missing: {
    get label(): string {
      return tr('people.person-file.missing', 'Missing');
    },
    tone: 'warning',
  },
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
              {tr('people.person-file.file_a_document', 'File a document')}
            </Button>
          ) : undefined
        }
      />
      {data.of === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('people.person-file.required', 'Required')}
              {data.hireDate === null
                ? ''
                : ' ' + tr('people.person-file.before_day_one', 'before day one')}{' '}
              · {data.have} {tr('people.person-file.of', 'of')} {data.of}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress
              value={(data.have / data.of) * 100}
              label={tr(
                'people.person-file.of_required_documents',
                '{{have}} of {{of}} required documents',
                { have: String(data.have), of: String(data.of) },
              )}
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
                      : tr('people.person-file.needed_by', 'Needed by {{dueOn}}', {
                          dueOn: shortDate(r.dueOn),
                        }),
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
                        <a href={`/documents/d/${r.documentId}`}>
                          {tr('people.person-file.open', 'Open')}
                        </a>
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
                        {tr('people.person-file.add_it', 'Add it')}
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
                        {tr('people.person-file.ask', 'Ask')}
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
          {data.hr
            ? tr('people.person-file.filed_to', 'Filed to {{first}}', { first })
            : tr('people.person-file.filed_to_you', 'Filed to you')}
        </h2>
        {data.rows.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {tr('people.person-file.nothing_filed_yet', 'Nothing filed yet.')}
          </p>
        ) : (
          <List>
            {data.rows.map((row) => (
              <ListItem
                key={row.id}
                leading={<DocIcon kind={row.kind} />}
                description={tr('people.person-file.text', '{{meta}} · {{updatedAt}}', {
                  meta: meta(row),
                  updatedAt: shortDate(row.updatedAt),
                })}
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
