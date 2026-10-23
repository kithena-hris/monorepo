import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  AppMark,
  Badge,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageSection,
  Stack,
  Switch,
  type ThirdPartyApp,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../../load';
import { t } from '../../i18n';

/**
 * People in the company's chat apps (Slack today, others later): connect one,
 * choose which of People's notices go there, and see what the assistant may
 * answer about.
 *
 * Nothing here is Slack's: an app is a row with its own mark and name, and a
 * notice goes to whichever app is connected. The notices are the heart of it —
 * each says who receives it and what they can do without opening Kithena.
 */

export interface ChatAppView {
  readonly key: string;
  readonly name: string;
  readonly canConnect: boolean;
  readonly connection: { readonly workspace: string; readonly connectedAt: string } | null;
}

export interface ChatNoticeView {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly to: string;
  /** What the person can do from the message itself, or null for a notice only. */
  readonly action: string | null;
  readonly on: boolean;
}

export interface ChatAppsState {
  readonly apps: readonly ChatAppView[];
  readonly notices: readonly ChatNoticeView[];
  readonly fields: {
    readonly on: readonly { readonly key: string; readonly label: string }[];
    readonly shareable: number;
  };
}

export type ConnectOutcome =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

export interface ChatAppsProps {
  /** Where to send the administrator to connect it. */
  readonly onConnect: (app: string) => Promise<ConnectOutcome>;
  readonly onDisconnect: (app: string) => Promise<Outcome>;
  readonly onNotice: (key: string, on: boolean) => Promise<Outcome>;
  /** Where each field's assistant setting is chosen. */
  readonly fieldsHref: string;
  /** What the connection round trip came back with, said once. */
  readonly returned?: { readonly ok: boolean; readonly message: string } | null;
}

/** The apps Reach draws a mark for; another app is shown by name alone. */
const MARKED = new Set<string>(['slack']);
const markOf = (key: string) => (MARKED.has(key) ? (key as ThirdPartyApp) : null);

export function ChatApps({
  state,
  onConnect,
  onDisconnect,
  onNotice,
  fieldsHref,
  returned,
}: ChatAppsProps & { readonly state: ChatAppsState }): JSX.Element {
  const connected = state.apps.filter((a) => a.connection !== null);
  return (
    <PageSection
      title={t('settings.integrations.chat-apps.chat_apps', 'Chat apps')}
      description={t(
        'settings.integrations.chat-apps.ask_questions_approve_changes_and_fill',
        'Ask questions, approve changes and fill in details from your chat app, with the same access as in Kithena.',
      )}
    >
      <Stack gap={4}>
        {returned === undefined || returned === null ? null : (
          <Alert tone={returned.ok ? 'success' : 'danger'} title={returned.message} />
        )}
        {state.apps.length === 0 ? (
          <Alert
            tone="info"
            title={t(
              'settings.integrations.chat-apps.no_chat_app_is_set_up',
              'No chat app is set up in this deployment',
            )}
          >
            {t(
              'settings.integrations.chat-apps.ask_whoever_runs_kithena_for_you',
              'Ask whoever runs Kithena for you to add one.',
            )}
          </Alert>
        ) : (
          state.apps.map((app) => (
            <AppRow key={app.key} app={app} onConnect={onConnect} onDisconnect={onDisconnect} />
          ))
        )}
        <Notices
          notices={state.notices}
          connected={connected.map((a) => a.name)}
          onNotice={onNotice}
        />
        <Answers fields={state.fields} fieldsHref={fieldsHref} />
      </Stack>
    </PageSection>
  );
}

function AppRow({
  app,
  onConnect,
  onDisconnect,
}: {
  readonly app: ChatAppView;
  readonly onConnect: ChatAppsProps['onConnect'];
  readonly onDisconnect: ChatAppsProps['onDisconnect'];
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mark = markOf(app.key);
  const since =
    app.connection === null
      ? null
      : new Date(app.connection.connectedAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

  const connect = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const answer = await onConnect(app.key);
    if (answer.ok) {
      window.location.assign(answer.url);
      return;
    }
    setBusy(false);
    setProblem(answer.message);
  };

  return (
    <PageSection
      surface
      aria-label={app.name}
      title={
        <span className="flex items-center gap-2.5">
          {mark === null ? null : <AppMark app={mark} className="size-6" />}
          {app.name}
        </span>
      }
      description={
        app.connection === null
          ? app.canConnect
            ? t(
                'settings.integrations.chat-apps.connect_your_workspace_you_approve_it',
                'Connect your {{name}} workspace. You approve it in {{name2}}, then come straight back here.',
                { name: app.name, name2: app.name },
              )
            : t(
                'settings.integrations.chat-apps.is_not_set_up_in_this',
                '{{name}} is not set up in this deployment yet.',
                { name: app.name },
              )
          : t(
              'settings.integrations.chat-apps.connected_to_since_people_can_mention',
              'Connected to {{workspace}} since {{value}}. People can mention Kithena or message it directly to ask a question.',
              { workspace: app.connection.workspace, value: since ?? '' },
            )
      }
      actions={
        <span className="flex items-center gap-3">
          <Badge tone={app.connection === null ? 'neutral' : 'success'}>
            {app.connection === null
              ? t('settings.integrations.chat-apps.not_connected', 'Not connected')
              : t('settings.integrations.chat-apps.connected', 'Connected')}
          </Badge>
          {app.connection === null ? (
            <Button
              variant="primary"
              disabled={!app.canConnect}
              loading={busy}
              loadingLabel={t('settings.integrations.chat-apps.opening', 'Opening')}
              startIcon={mark === null ? undefined : <AppMark app={mark} tone="mono" />}
              onClick={() => {
                void connect();
              }}
            >
              {t('settings.integrations.chat-apps.add_to', 'Add to')} {app.name}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  loading={busy}
                  loadingLabel={t('settings.integrations.chat-apps.disconnecting', 'Disconnecting')}
                >
                  {t('settings.integrations.chat-apps.disconnect', 'Disconnect')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  {t('settings.integrations.chat-apps.disconnect', 'Disconnect')} {app.name}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    'settings.integrations.chat-apps.kithena_leaves_nobody_can_ask_it',
                    'Kithena leaves {{workspace}}. Nobody can ask it questions there, and notices go by email only. Buttons on messages already sent stop working. You can connect it again at any time.',
                    { workspace: app.connection.workspace },
                  )}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button>
                      {t('settings.integrations.chat-apps.keep_it_connected', 'Keep it connected')}
                    </Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setBusy(true);
                        setProblem(null);
                        void onDisconnect(app.key).then((outcome) => {
                          setBusy(false);
                          if (!outcome.ok) setProblem(outcome.message);
                        });
                      }}
                    >
                      {t('settings.integrations.chat-apps.disconnect', 'Disconnect')}
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </span>
      }
    >
      {problem === null ? null : <Alert tone="danger" title={problem} />}
    </PageSection>
  );
}

function Notices({
  notices,
  connected,
  onNotice,
}: {
  readonly notices: readonly ChatNoticeView[];
  readonly connected: readonly string[];
  readonly onNotice: ChatAppsProps['onNotice'];
}): JSX.Element {
  const [on, setOn] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(notices.map((n) => [n.key, n.on])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const count = [...on.values()].filter(Boolean).length;

  const toggle = async (key: string, next: boolean): Promise<void> => {
    setBusy(key);
    setProblem(null);
    setOn((m) => new Map(m).set(key, next));
    const outcome = await onNotice(key, next);
    setBusy(null);
    if (!outcome.ok) {
      setOn((m) => new Map(m).set(key, !next));
      setProblem(outcome.message);
    }
  };

  const row = (n: ChatNoticeView): JSX.Element => (
    <li key={n.key} className="py-3 first:pt-0 last:pb-0">
      <Field orientation="horizontal" className="items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FieldLabel>{n.label}</FieldLabel>
          <FieldDescription>
            {n.action === null
              ? t('settings.integrations.chat-apps.to', 'To {{to}}. {{description}}', {
                  to: n.to.toLowerCase(),
                  description: n.description,
                })
              : t(
                  'settings.integrations.chat-apps.to_who_can_from_the_message',
                  'To {{to}}, who can {{action}} from the message itself. {{description}}',
                  {
                    to: n.to.toLowerCase(),
                    action: n.action.toLowerCase(),
                    description: n.description,
                  },
                )}
          </FieldDescription>
        </div>
        <FieldControl>
          <Switch
            checked={on.get(n.key) === true}
            disabled={busy === n.key}
            onCheckedChange={(next) => {
              void toggle(n.key, next);
            }}
          />
        </FieldControl>
      </Field>
    </li>
  );
  const actions = notices.filter((n) => n.action !== null);
  const updates = notices.filter((n) => n.action === null);

  return (
    <PageSection
      surface
      title={t(
        'settings.integrations.chat-apps.what_kithena_sends_in_chat',
        'What Kithena sends in chat',
      )}
      description={
        connected.length === 0
          ? 'Choose what goes to chat. Nothing is sent until a chat app is connected; email carries on as it does now.'
          : t(
              'settings.integrations.chat-apps.of_on_sent_to_as_a',
              '{{count}} of {{length}} on, sent to {{join}} as a direct message to the person it is for, as well as by email.',
              {
                count: String(count),
                length: String(notices.length),
                join: connected.join(' and '),
              },
            )
      }
    >
      <Stack gap={6}>
        {problem === null ? null : <Alert tone="danger" title={problem} />}
        <section aria-labelledby="chat-actions" className="flex flex-col gap-3">
          <div>
            <h3 id="chat-actions" className="text-sm font-semibold text-fg">
              {t('settings.integrations.chat-apps.things_to_do', 'Things to do')}
            </h3>
            <p className="text-sm text-fg-muted">
              {t(
                'settings.integrations.chat-apps.each_arrives_with_buttons_so_it',
                'Each arrives with buttons, so it is done in the chat without opening Kithena.',
              )}
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-border">{actions.map(row)}</ul>
        </section>
        <section aria-labelledby="chat-updates" className="flex flex-col gap-3">
          <div>
            <h3 id="chat-updates" className="text-sm font-semibold text-fg">
              {t('settings.integrations.chat-apps.updates', 'Updates')}
            </h3>
            <p className="text-sm text-fg-muted">
              {t(
                'settings.integrations.chat-apps.to_let_somebody_know_how_something',
                'To let somebody know how something turned out. Nothing to do.',
              )}
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-border">{updates.map(row)}</ul>
        </section>
      </Stack>
    </PageSection>
  );
}

function Answers({
  fields,
  fieldsHref,
}: {
  readonly fields: ChatAppsState['fields'];
  readonly fieldsHref: string;
}): JSX.Element {
  const shown = fields.on.slice(0, 12);
  const more = fields.on.length - shown.length;
  return (
    <PageSection
      surface
      title={t(
        'settings.integrations.chat-apps.what_the_assistant_and_chat_can',
        'What the assistant and chat can use',
      )}
      description={t(
        'settings.integrations.chat-apps.of_fields_that_may_be_shared',
        '{{length}} of {{shareable}} fields that may be shared are. The assistant can answer questions about them, and a chat message may show their values to somebody who can see them in Kithena. The model itself learns a field’s name and options, never anybody’s value.',
        { length: String(fields.on.length), shareable: String(fields.shareable) },
      )}
      actions={
        <Button asChild variant="secondary">
          <a href={fieldsHref}>
            {t('settings.integrations.chat-apps.choose_fields', 'Choose fields')}
          </a>
        </Button>
      }
    >
      {fields.on.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {t(
            'settings.integrations.chat-apps.no_field_is_shared_yet_so',
            'No field is shared yet, so the assistant can only say who is who. Choose fields in Employee fields, under Assistant.',
          )}
        </p>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {shown.map((f) => (
            <Badge key={f.key} tone="neutral">
              {f.label}
            </Badge>
          ))}
          {more > 0 ? (
            <Badge tone="neutral">
              {t('settings.integrations.chat-apps.and_more', 'and {{more}} more', {
                more: String(more),
              })}
            </Badge>
          ) : null}
        </span>
      )}
    </PageSection>
  );
}
