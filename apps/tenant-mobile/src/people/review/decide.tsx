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
import { t } from '../../i18n';

/** A request for full values (E7), as HR decides it: who, which fields, why, then Approve or Reject. */
export function ReviewAccess({
  navigation,
  route,
}: PeopleScreen<'ReviewAccess'>): React.JSX.Element {
  const { load, reload } = useRead<AccessState>('FullValues', { request: route.params.id });
  const { act, busy } = useAct();
  const [note, setNote] = useState('');
  const back = {
    label: t('people.review.decide.all_items', 'All items'),
    onPress: navigation.goBack,
  };
  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label={t('people.review.decide.loading_the_request', 'Loading the request')} />
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
        <Alert tone="info" title={t('people.review.decide.already_decided', 'Already decided')}>
          {t(
            'people.review.decide.this_request_is_no_longer_waiting',
            'This request is no longer waiting.',
          )}
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
      title={t('people.review.decide.full_values', 'Full values')}
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
                  {t('people.review.decide.reject', 'Reject')}
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
                  {t('people.review.decide.approve', 'Approve')}
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
              label: t('people.review.decide.asked_by', 'Asked by'),
              value: request.mine ? 'You' : (request.requestedBy ?? 'Somebody'),
            },
            { label: t('people.review.decide.fields', 'Fields'), value: request.fields.join(', ') },
            ...(request.people === null
              ? []
              : [{ label: t('people.review.decide.whose', 'Whose'), value: request.people }]),
            { label: t('people.review.decide.reason', 'Reason'), value: request.reason },
            {
              label: t('people.review.decide.asked_on', 'Asked on'),
              value: longDate(request.requestedAt.slice(0, 10)),
            },
            {
              label: t('people.review.decide.expires', 'Expires'),
              value: longDate(request.expiresAt.slice(0, 10)),
            },
          ]}
        />
      </Card>
      <Text variant="footnote" tone="muted">
        {t(
          'people.review.decide.approved_the_requester_downloads_the_values',
          'Approved, the requester downloads the values once, within 24 hours.',
        )}
      </Text>
      {pending ? (
        <Field>
          <FieldLabel>{t('people.review.decide.note', 'Note')}</FieldLabel>
          <Textarea
            value={note}
            onChange={setNote}
            maxLength={500}
            placeholder={t('people.review.decide.optional', 'Optional')}
          />
        </Field>
      ) : request.note === null ? null : (
        <Text>{t('people.review.decide.note_2', 'Note: “{{note}}”', { note: request.note })}</Text>
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
  const back = {
    label: t('people.review.decide.all_items', 'All items'),
    onPress: navigation.goBack,
  };
  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label={t('people.review.decide.loading_the_request', 'Loading the request')} />
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
        <Alert tone="info" title={t('people.review.decide.not_found', 'Not found')}>
          {t(
            'people.review.decide.this_request_is_gone_or_it',
            'This request is gone, or it is not yours to decide.',
          )}
        </Alert>
      </Page>
    );
  }
  const decide = (approve: boolean): void => {
    void act(
      'DecideExportShare',
      { id: share.id, approve, note: note.trim() === '' ? null : note.trim() },
      approve ? t('people.review.decide.approved_it_is_sent', 'Approved: it is sent') : 'Rejected',
    ).then((done) => {
      if (done !== null) navigation.goBack();
    });
  };
  const pending = share.state === 'pending' && share.canDecide;
  return (
    <Page
      title={t('people.review.decide.export', 'Export')}
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
                  {t('people.review.decide.reject', 'Reject')}
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
                  {t('people.review.decide.approve_and_send', 'Approve and send')}
                </Button>
              </>
            ),
          }
        : {})}
    >
      <Inline gap={3} wrap={false}>
        <Avatar name={share.requestedBy.name ?? 'A colleague'} size={44} decorative />
        <Stack gap={1} className="flex-1">
          <Text variant="title3">{`${share.requestedBy.name ?? t('people.review.decide.a_colleague', 'A colleague')} → ${share.recipient.name ?? 'a colleague'}`}</Text>
          <Text variant="footnote" tone="muted">
            {t('people.review.decide.asked_expires', 'Asked {{longDate}} · expires {{longDate2}}', {
              longDate: longDate(share.requestedAt.slice(0, 10)),
              longDate2: longDate(share.expiresAt.slice(0, 10)),
            })}
          </Text>
        </Stack>
        {share.state === 'pending' ? null : <Badge size="sm">{share.state}</Badge>}
      </Inline>
      <Card>
        <KeyValues
          layout="stacked"
          items={[
            { label: t('people.review.decide.reason', 'Reason'), value: share.reason },
            { label: t('people.review.decide.fields', 'Fields'), value: share.fields.join(', ') },
            ...(share.people === null
              ? []
              : [
                  {
                    label: t('people.review.decide.people', 'People'),
                    value: String(share.people),
                  },
                ]),
            ...(share.asOf === null
              ? []
              : [{ label: t('people.review.decide.as_of', 'As of'), value: longDate(share.asOf) }]),
            {
              label: t('people.review.decide.format', 'Format'),
              value: share.format.toUpperCase(),
            },
          ]}
        />
      </Card>
      {share.gap === null || share.gap.fields.length === 0 ? null : (
        <Alert
          tone="warning"
          title={t('people.review.decide.cant_see_all_of_it', '{{value}} can’t see all of it', {
            value: share.recipient.name ?? 'They',
          })}
        >
          {`${share.gap.fields.map((f) => t('people.review.decide.people_2', '{{label}} ({{String}} people)', { label: f.label, String: String(f.people) })).join(', ')}${
            share.gap.unlisted > 0
              ? `, and ${String(share.gap.unlisted)} people they can’t list`
              : ''
          }.`}
        </Alert>
      )}
      {pending ? (
        <Field>
          <FieldLabel>{t('people.review.decide.note', 'Note')}</FieldLabel>
          <Textarea
            value={note}
            onChange={setNote}
            maxLength={500}
            placeholder={t('people.review.decide.optional', 'Optional')}
          />
        </Field>
      ) : share.note === null ? null : (
        <Text>{t('people.review.decide.note_2', 'Note: “{{note}}”', { note: share.note })}</Text>
      )}
    </Page>
  );
}
