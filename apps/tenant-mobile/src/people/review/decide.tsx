import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  FieldLabel,
  Inline,
  KeyValues,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { useRead } from '../api';
import { longDate } from '../display';
import type { PeopleScreen } from '../routes';
import { parsed } from './load';
import type { AccessState, Share } from './model';

/** A request for full values (E7), as HR decides it: who, which fields, why, then Approve or Reject. */
export function ReviewAccess({
  navigation,
  route,
}: PeopleScreen<'ReviewAccess'>): React.JSX.Element {
  const { load, reload } = useRead<AccessState>('FullValues', { request: route.params.id });
  const { act, busy } = useAct();
  const [note, setNote] = useState('');
  const back = { label: 'All items', onPress: navigation.goBack };
  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label="Loading the request" />
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  const request = load.data.requests.find((r) => r.id === route.params.id);
  if (request === undefined) {
    return (
      <Page back={back}>
        <Alert tone="info" title="Already decided">
          This request is no longer waiting.
        </Alert>
      </Page>
    );
  }
  const decide = (approve: boolean): void => {
    void act(
      'DecideFullValues',
      { id: request.id, approve, note: note.trim() === '' ? null : note.trim() },
      approve ? 'Approved' : 'Rejected',
    ).then((done) => {
      if (done !== null) navigation.goBack();
    });
  };
  const pending = request.state === 'pending' && load.data.canDecide && !request.mine;
  return (
    <Page
      title="Full values"
      back={back}
      {...(pending
        ? {
            foot: (
              <>
                <Button
                  className="flex-1"
                  fullWidth
                  loading={busy !== null}
                  onPress={() => {
                    decide(false);
                  }}
                >
                  Reject
                </Button>
                <Button
                  className="flex-1"
                  fullWidth
                  variant="primary"
                  loading={busy !== null}
                  onPress={() => {
                    decide(true);
                  }}
                >
                  Approve
                </Button>
              </>
            ),
          }
        : {})}
    >
      <Card>
        <KeyValues
          layout="stacked"
          items={[
            {
              label: 'Asked by',
              value: request.mine ? 'You' : (request.requestedBy ?? 'Somebody'),
            },
            { label: 'Fields', value: request.fields.join(', ') },
            ...(request.people === null ? [] : [{ label: 'Whose', value: request.people }]),
            { label: 'Reason', value: request.reason },
            { label: 'Asked on', value: longDate(request.requestedAt.slice(0, 10)) },
            { label: 'Expires', value: longDate(request.expiresAt.slice(0, 10)) },
          ]}
        />
      </Card>
      <Text variant="footnote" tone="muted">
        Approved, the requester downloads the values once, within 24 hours.
      </Text>
      {pending ? (
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea value={note} onChange={setNote} maxLength={500} placeholder="Optional" />
        </Field>
      ) : request.note === null ? null : (
        <Text>{`Note: “${request.note}”`}</Text>
      )}
    </Page>
  );
}

/**
 * A request to send an export to somebody who cannot see all of it (E5 on the
 * web, `export-done.tsx`): what is in it, what the recipient lacks access to,
 * and the decision.
 */
export function ReviewShare({ navigation, route }: PeopleScreen<'ReviewShare'>): React.JSX.Element {
  const { load, reload } = useRead<string>('ExportShare', { id: route.params.id });
  const { act, busy } = useAct();
  const [note, setNote] = useState('');
  const back = { label: 'All items', onPress: navigation.goBack };
  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label="Loading the request" />
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  const share = parsed(load.data) as Share | null;
  if (share === null) {
    return (
      <Page back={back}>
        <Alert tone="info" title="Not found">
          This request is gone, or it is not yours to decide.
        </Alert>
      </Page>
    );
  }
  const decide = (approve: boolean): void => {
    void act(
      'DecideExportShare',
      { id: share.id, approve, note: note.trim() === '' ? null : note.trim() },
      approve ? 'Approved: it is sent' : 'Rejected',
    ).then((done) => {
      if (done !== null) navigation.goBack();
    });
  };
  const pending = share.state === 'pending' && share.canDecide;
  return (
    <Page
      title="Export"
      back={back}
      {...(pending
        ? {
            foot: (
              <>
                <Button
                  className="flex-1"
                  fullWidth
                  loading={busy !== null}
                  onPress={() => {
                    decide(false);
                  }}
                >
                  Reject
                </Button>
                <Button
                  className="flex-1"
                  fullWidth
                  variant="primary"
                  loading={busy !== null}
                  onPress={() => {
                    decide(true);
                  }}
                >
                  Approve and send
                </Button>
              </>
            ),
          }
        : {})}
    >
      <Inline gap={3} wrap={false}>
        <Avatar name={share.requestedBy.name ?? 'A colleague'} size={44} decorative />
        <Stack gap={1} className="flex-1">
          <Text variant="title3">{`${share.requestedBy.name ?? 'A colleague'} → ${share.recipient.name ?? 'a colleague'}`}</Text>
          <Text variant="footnote" tone="muted">
            {`Asked ${longDate(share.requestedAt.slice(0, 10))} · expires ${longDate(share.expiresAt.slice(0, 10))}`}
          </Text>
        </Stack>
        {share.state === 'pending' ? null : <Badge size="sm">{share.state}</Badge>}
      </Inline>
      <Card>
        <KeyValues
          layout="stacked"
          items={[
            { label: 'Reason', value: share.reason },
            { label: 'Fields', value: share.fields.join(', ') },
            ...(share.people === null ? [] : [{ label: 'People', value: String(share.people) }]),
            ...(share.asOf === null ? [] : [{ label: 'As of', value: longDate(share.asOf) }]),
            { label: 'Format', value: share.format.toUpperCase() },
          ]}
        />
      </Card>
      {share.gap === null || share.gap.fields.length === 0 ? null : (
        <Alert tone="warning" title={`${share.recipient.name ?? 'They'} can’t see all of it`}>
          {`${share.gap.fields.map((f) => `${f.label} (${String(f.people)} people)`).join(', ')}${
            share.gap.unlisted > 0
              ? `, and ${String(share.gap.unlisted)} people they can’t list`
              : ''
          }.`}
        </Alert>
      )}
      {pending ? (
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea value={note} onChange={setNote} maxLength={500} placeholder="Optional" />
        </Field>
      ) : share.note === null ? null : (
        <Text>{`Note: “${share.note}”`}</Text>
      )}
    </Page>
  );
}
