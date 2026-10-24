import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Combobox,
  CopyField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Text,
  type ComboboxOption,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { KeyRound, Lock, MessageSquare, Plug, Webhook } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { t } from '../../i18n';

interface Endpoint {
  readonly id: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly events: readonly string[];
  readonly allowlist: readonly string[];
  readonly retrying: number;
  readonly problem: string | null;
  readonly lastDelivery: string | null;
  readonly secretRotated: string | null;
}

interface ScimConnection {
  readonly id: string;
  readonly system: string;
  readonly createdAt: string;
  readonly tokenRotatedAt: string | null;
  readonly revokedAt: string | null;
  readonly linked: number;
  readonly mapping: readonly { readonly path: string; readonly key: string }[];
}

interface ChatState {
  readonly apps: readonly {
    readonly key: string;
    readonly name: string;
    readonly canConnect: boolean;
    readonly connection: { readonly workspace: string; readonly connectedAt: string } | null;
  }[];
  readonly notices: readonly {
    readonly key: string;
    readonly label: string;
    readonly description: string;
    readonly to: string;
    readonly action: string | null;
    readonly on: boolean;
  }[];
  readonly fields: {
    readonly on: readonly { key: string; label: string }[];
    readonly shareable: number;
  };
}

interface State {
  readonly deliveries24h: number;
  readonly events: readonly string[];
  readonly fields: readonly { key: string; label: string; refused: string | null }[];
  readonly endpoints: readonly Endpoint[];
  readonly scim: {
    readonly url: string;
    readonly paths: readonly string[];
    readonly extension: string;
    readonly mappable: readonly { key: string; label: string }[];
    readonly connections: readonly ScimConnection[];
  } | null;
  readonly chat: ChatState | null;
}

/** "people.person.hired" as "Person hired", with the name itself beneath. */
const eventOptions = (events: readonly string[]): ComboboxOption[] =>
  events.map((e) => {
    const words = e.replace(/^people\./, '').replaceAll(/[._]/g, ' ');
    return { value: e, label: words.charAt(0).toUpperCase() + words.slice(1), description: e };
  });

/** Every field; one no endpoint may receive is shown and cannot be chosen. */
const fieldOptions = (fields: State['fields']): ComboboxOption[] =>
  fields.map((f) => ({
    value: f.key,
    label: f.label,
    description:
      f.refused === 'special-category'
        ? t(
            'people.settings.integrations.special_category_data_never_sent',
            '{{key}} · special-category data, never sent',
            { key: f.key },
          )
        : f.refused === 'encrypted'
          ? t(
              'people.settings.integrations.encrypted_never_sent',
              '{{key}} · encrypted, never sent',
              { key: f.key },
            )
          : f.key,
    disabled: f.refused !== null,
  }));

function PickMany({
  label,
  options,
  value,
  onChange,
  hint,
  invalid = false,
}: {
  label: string;
  options: readonly ComboboxOption[];
  value: readonly string[];
  onChange: (value: readonly string[]) => void;
  hint?: string;
  invalid?: boolean;
}): React.JSX.Element {
  return (
    <Field invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        multiple
        chips
        size="sm"
        label={label}
        options={options}
        value={value}
        placeholder={
          value.length === 0
            ? t('people.settings.integrations.choose', 'Choose')
            : t('people.settings.integrations.chosen', '{{String}} chosen', {
                String: String(value.length),
              })
        }
        searchPlaceholder={t('people.settings.integrations.search', 'Search')}
        emptyMessage={t(
          'people.settings.integrations.nothing_by_that_name',
          'Nothing by that name.',
        )}
        onChange={(next) => {
          onChange(Array.isArray(next) ? (next as readonly string[]) : []);
        }}
      />
      {hint === undefined ? null : <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

/** A secret or token, shown once, here, and never again. */
function ShownOnce({
  title,
  body,
  value,
  label,
}: {
  title: string;
  body: string;
  value: string;
  label: string;
}) {
  return (
    <Alert tone="warning" title={title}>
      <Stack gap={2}>
        <Text>{body}</Text>
        <CopyField value={value} label={label} mono />
      </Stack>
    </Alert>
  );
}

/**
 * Integrations (design H5): the overview as a list, each opening its own
 * page — chat apps, webhooks, provisioning — and what can and can never
 * leave Kithena.
 */
export function Integrations({
  navigation,
  route,
}: PeopleScreen<'Integrations'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const tab = route.params?.tab;
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const [integrations, chat] = await Promise.all([
      ask<Omit<State, 'chat'>>(signed, 'Integrations'),
      ask<ChatState>(signed, 'Chat'),
    ]);
    if (!integrations.ok) {
      setFailed(integrations.message);
      return;
    }
    setFailed(null);
    setState({ ...integrations.data, chat: chat.ok ? chat.data : null });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  const title =
    tab === 'slack'
      ? t('people.settings.integrations.chat_apps', 'Chat apps')
      : tab === 'webhooks'
        ? 'Webhooks'
        : tab === 'provisioning'
          ? 'Provisioning'
          : 'Integrations';
  const back = {
    label:
      tab === undefined
        ? t('people.settings.integrations.settings', 'Settings')
        : t('people.settings.integrations.integrations', 'Integrations'),
    onPress: navigation.goBack,
  };
  if (failed !== null) {
    return (
      <Page title={title} back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (state === null) {
    return (
      <Page title={title} back={back}>
        <Loading
          label={t(
            'people.settings.integrations.loading_the_integrations',
            'Loading the integrations',
          )}
        />
      </Page>
    );
  }
  const reload = (): void => {
    void load();
  };

  if (tab === 'slack' && state.chat !== null) {
    return (
      <Page title={title} back={back}>
        <ChatApps chat={state.chat} onChanged={reload} />
      </Page>
    );
  }
  if (tab === 'webhooks') {
    return (
      <Page title={title} back={back}>
        <Webhooks
          state={state}
          onChanged={reload}
          onOpenLog={(e) => {
            navigation.navigate('WebhookLog', { id: e.id, url: e.url });
          }}
        />
      </Page>
    );
  }
  if (tab === 'provisioning' && state.scim !== null) {
    return (
      <Page title={title} back={back}>
        <Provisioning scim={state.scim} onChanged={reload} />
      </Page>
    );
  }

  const slack = state.chat?.apps.find((a) => a.key === 'slack') ?? state.chat?.apps[0];
  const live = state.endpoints.filter((e) => e.enabled);
  const retrying = live.filter((e) => e.retrying > 0).length;
  const scimLive = (state.scim?.connections ?? []).filter((c) => c.revokedAt === null);
  const label = new Map(state.fields.map((f) => [f.key, f.label]));
  const sent = [...new Set(live.flatMap((e) => e.allowlist))];
  const never = state.fields.filter((f) => f.refused !== null);
  // One page instead of four (v3 S9): the connection, what goes to chat, then identity and webhooks.
  const notices = state.chat?.notices ?? [];
  const toggle = (n: (typeof notices)[number]): React.JSX.Element => (
    <ListItem
      key={n.key}
      listitem={false}
      description={n.description}
      wrap
      trailing={
        <Switch
          checked={n.on}
          disabled={busy === 'SetChatNotice'}
          accessibilityLabel={n.label}
          onCheckedChange={(on) => {
            void act('SetChatNotice', { notice: n.key, on }).then((done) => {
              if (done !== null) reload();
            });
          }}
        />
      }
    >
      {n.label}
    </ListItem>
  );
  return (
    <Page title={title} back={back}>
      {slack === undefined ? null : (
        <Card padded={false} className="overflow-hidden">
          <ListItem
            listitem={false}
            icon={MessageSquare}
            description={
              slack.connection === null
                ? t('people.settings.integrations.not_connected', 'Not connected')
                : t('people.settings.integrations.connected_to', 'Connected to {{workspace}}', {
                    workspace: slack.connection.workspace,
                  })
            }
            trailing={
              <Button
                size="sm"
                onPress={() => {
                  navigation.push('Integrations', { tab: 'slack' });
                }}
              >
                {slack.connection === null
                  ? t('people.settings.integrations.connect', 'Connect')
                  : t('people.settings.integrations.manage', 'Manage')}
              </Button>
            }
          >
            {slack.name}
          </ListItem>
        </Card>
      )}
      {notices.length === 0 ? null : (
        <Card padded={false} className="overflow-hidden">
          <View className="px-4 pb-1 pt-4">
            <Text variant="headline">
              {t(
                'people.settings.integrations.what_kithena_sends_in_chat',
                'What Kithena sends in chat',
              )}
            </Text>
          </View>
          <Text variant="footnote" weight="semibold" tone="subtle" className="px-4 pt-2">
            {t(
              'people.settings.integrations.things_to_do_arrive_with_buttons',
              'Things to do · arrive with buttons',
            )}
          </Text>
          {notices.filter((n) => n.action !== null).map(toggle)}
          <Text variant="footnote" weight="semibold" tone="subtle" className="px-4 pt-3">
            {t('people.settings.integrations.updates_nothing_to_do', 'Updates · nothing to do')}
          </Text>
          {notices.filter((n) => n.action === null).map(toggle)}
        </Card>
      )}
      <Card padded={false} className="overflow-hidden">
        <View className="px-4 pb-1 pt-4">
          <Text variant="headline">
            {t('people.settings.integrations.identity_and_data', 'Identity and data')}
          </Text>
        </View>
        {state.scim === null ? null : (
          <ListItem
            listitem={false}
            icon={KeyRound}
            description={
              scimLive.length === 0
                ? t('people.settings.integrations.not_connected', 'Not connected')
                : t('people.settings.integrations.from', 'From {{value}}', {
                    value: scimLive[0]?.system ?? 'one system',
                  })
            }
            chevron
            onPress={() => {
              navigation.push('Integrations', { tab: 'provisioning' });
            }}
          >
            {t('people.settings.integrations.provisioning', 'Provisioning')}
          </ListItem>
        )}
        <ListItem
          listitem={false}
          icon={Webhook}
          {...(retrying > 0 ? { iconTone: 4 as const } : {})}
          description={
            live.length === 0
              ? t('people.settings.integrations.none_set_up', 'None set up')
              : retrying > 0
                ? t('people.settings.integrations.retrying', '{{String}} retrying', {
                    String: String(retrying),
                  })
                : t('people.settings.integrations.active', '{{String}} active', {
                    String: String(live.length),
                  })
          }
          {...(retrying > 0
            ? {
                trailing: (
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => {
                      navigation.push('Integrations', { tab: 'webhooks' });
                    }}
                  >
                    {t('people.settings.integrations.fix', 'Fix')}
                  </Button>
                ),
              }
            : {
                chevron: true,
                onPress: () => {
                  navigation.push('Integrations', { tab: 'webhooks' });
                },
              })}
        >
          {t('people.settings.integrations.webhooks', 'Webhooks')}
        </ListItem>
      </Card>
      <Card>
        <Stack gap={2}>
          <CardTitle>
            {t(
              'people.settings.integrations.sent_to_third_party_tools',
              'Sent to third-party tools ({{String}})',
              { String: String(sent.length) },
            )}
          </CardTitle>
          {sent.length === 0 ? (
            <Text variant="subhead" tone="muted">
              {t(
                'people.settings.integrations.nothing_yet_a_field_is_sent',
                'Nothing yet. A field is sent only once you allow it on an enabled endpoint.',
              )}
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-1.5">
              {sent.map((key) => (
                <Badge key={key} size="sm" tone="info">
                  {label.get(key) ?? key}
                </Badge>
              ))}
            </View>
          )}
        </Stack>
      </Card>
      <Card>
        <Stack gap={2}>
          <CardTitle>
            {t(
              'people.settings.integrations.never_sent_whatever_is_chosen',
              'Never sent, whatever is chosen',
            )}
          </CardTitle>
          <Text variant="subhead" tone="muted">
            {t(
              'people.settings.integrations.special_category_and_encrypted_fields_are',
              'Special-category and encrypted fields are never sent. The AI model never sees values.',
            )}
          </Text>
          {never.length === 0 ? null : (
            <View className="flex-row flex-wrap gap-1.5">
              {never.map((f) => (
                <Badge key={f.key} size="sm" icon={Lock}>
                  {f.label}
                </Badge>
              ))}
            </View>
          )}
        </Stack>
      </Card>
    </Page>
  );
}

/** Chat apps: connect one, choose People's notices to it, and what the assistant may use. */
function ChatApps({
  chat,
  onChanged,
}: {
  chat: ChatState;
  onChanged: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [problem, setProblem] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const connected = chat.apps.filter((a) => a.connection !== null);
  const row = (n: ChatState['notices'][number]): React.JSX.Element => (
    <ListItem
      key={n.key}
      description={
        n.action === null
          ? t('people.settings.integrations.to', 'To {{toLowerCase}}. {{description}}', {
              toLowerCase: n.to.toLowerCase(),
              description: n.description,
            })
          : t(
              'people.settings.integrations.to_who_can_from_the_message',
              'To {{toLowerCase}}, who can {{toLowerCase2}} from the message itself. {{description}}',
              {
                toLowerCase: n.to.toLowerCase(),
                toLowerCase2: n.action.toLowerCase(),
                description: n.description,
              },
            )
      }
      trailing={
        <Switch
          checked={n.on}
          disabled={busy === 'SetChatNotice'}
          accessibilityLabel={n.label}
          onCheckedChange={(on) => {
            void act('SetChatNotice', { notice: n.key, on }).then((done) => {
              if (done !== null) onChanged();
            });
          }}
        />
      }
    >
      {n.label}
    </ListItem>
  );
  return (
    <>
      <Text tone="muted">
        {t(
          'people.settings.integrations.ask_questions_approve_changes_and_fill',
          'Ask questions, approve changes and fill in details from your chat app, with the same access as in Kithena.',
        )}
      </Text>
      {problem === null ? null : <Alert tone="danger" title={problem} />}
      {chat.apps.length === 0 ? (
        <Alert
          tone="info"
          title={t(
            'people.settings.integrations.no_chat_app_is_set_up',
            'No chat app is set up in this deployment',
          )}
        >
          {t(
            'people.settings.integrations.ask_whoever_runs_kithena_for_you',
            'Ask whoever runs Kithena for you to add one.',
          )}
        </Alert>
      ) : (
        chat.apps.map((app) => (
          <Card key={app.key}>
            <Stack gap={2}>
              <View className="flex-row items-center gap-2">
                <CardTitle className="flex-1">{app.name}</CardTitle>
                <Badge size="sm" tone={app.connection === null ? 'neutral' : 'success'}>
                  {app.connection === null
                    ? t('people.settings.integrations.not_connected', 'Not connected')
                    : t('people.settings.integrations.connected', 'Connected')}
                </Badge>
              </View>
              <Text variant="subhead" tone="muted">
                {app.connection === null
                  ? app.canConnect
                    ? t(
                        'people.settings.integrations.connect_your_workspace_you_approve_it',
                        'Connect your {{name}} workspace. You approve it in {{name}}, then come back here.',
                        { name: app.name },
                      )
                    : t(
                        'people.settings.integrations.is_not_set_up_in_this',
                        '{{name}} is not set up in this deployment yet.',
                        { name: app.name },
                      )
                  : t(
                      'people.settings.integrations.connected_to_people_can_mention_kithena',
                      'Connected to {{workspace}}. People can mention Kithena or message it directly to ask a question.',
                      { workspace: app.connection.workspace },
                    )}
              </Text>
              {app.connection === null ? (
                <Button
                  variant="primary"
                  disabled={!app.canConnect}
                  loading={busy === 'ConnectChatApp'}
                  onPress={() => {
                    setProblem(null);
                    // The approval comes back to the company's own address, which finishes it.
                    void act<string>('ConnectChatApp', {
                      app: app.key,
                      origin: signed.company.origin,
                    }).then(async (url) => {
                      if (url === null) return;
                      await WebBrowser.openBrowserAsync(url);
                      onChanged();
                    });
                  }}
                >
                  {t('people.settings.integrations.add_to', 'Add to {{name}}', { name: app.name })}
                </Button>
              ) : (
                <Button
                  variant="danger-soft"
                  onPress={() => {
                    setDisconnecting(app.key);
                  }}
                >
                  {t('people.settings.integrations.disconnect', 'Disconnect')}
                </Button>
              )}
            </Stack>
          </Card>
        ))
      )}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {connected.length === 0
          ? t(
              'people.settings.integrations.what_kithena_sends_in_chat_once',
              'What Kithena sends in chat, once a chat app is connected',
            )
          : t(
              'people.settings.integrations.sent_to_as_well_as_by',
              'Sent to {{join}} as well as by email',
              { join: connected.map((a) => a.name).join(' and ') },
            )}
      </Text>
      <Text variant="footnote" tone="muted" className="px-1">
        {t(
          'people.settings.integrations.things_to_do_with_buttons_in',
          'Things to do, with buttons in the message',
        )}
      </Text>
      <List>{chat.notices.filter((n) => n.action !== null).map(row)}</List>
      <Text variant="footnote" tone="muted" className="px-1">
        {t(
          'people.settings.integrations.updates_with_nothing_to_do',
          'Updates, with nothing to do',
        )}
      </Text>
      <List>{chat.notices.filter((n) => n.action === null).map(row)}</List>
      <Card>
        <Stack gap={2}>
          <CardTitle>
            {t(
              'people.settings.integrations.what_the_assistant_and_chat_can',
              'What the assistant and chat can use',
            )}
          </CardTitle>
          <Text variant="subhead" tone="muted">
            {t(
              'people.settings.integrations.of_fields_that_may_be_shared',
              '{{String}} of {{String2}} fields that may be shared are. Choose them in Employee fields, under Assistant.',
              { String: String(chat.fields.on.length), String2: String(chat.fields.shareable) },
            )}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {chat.fields.on.map((f) => (
              <Badge key={f.key} size="sm">
                {f.label}
              </Badge>
            ))}
          </View>
        </Stack>
      </Card>
      {disconnecting === null ? null : (
        <Confirm
          title={t('people.settings.integrations.disconnect_2', 'Disconnect {{value}}?', {
            value: chat.apps.find((a) => a.key === disconnecting)?.name ?? 'it',
          })}
          body={t(
            'people.settings.integrations.kithena_leaves_the_workspace_nobody_can',
            'Kithena leaves the workspace. Nobody can ask it questions there, and notices go by email only. Buttons on messages already sent stop working. You can connect it again at any time.',
          )}
          keep="Keep it connected"
          action={t('people.settings.integrations.disconnect', 'Disconnect')}
          busy={busy === 'DisconnectChatApp'}
          onClose={() => {
            setDisconnecting(null);
          }}
          onConfirm={() => {
            void act('DisconnectChatApp', { app: disconnecting }, 'Disconnected').then((done) => {
              setDisconnecting(null);
              if (done !== null) onChanged();
            });
          }}
        />
      )}
    </>
  );
}

function Confirm({
  title,
  body,
  keep,
  action,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  keep: string;
  action: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {keep}
          </Button>
          <Button className="flex-1" variant="danger" loading={busy} onPress={onConfirm}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Webhooks: each endpoint's events and fields, on or off, its secret rotated, its log. */
function Webhooks({
  state,
  onChanged,
  onOpenLog,
}: {
  state: State;
  onChanged: () => void;
  onOpenLog: (endpoint: Endpoint) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);
  const refused = state.fields.filter((f) => f.refused !== null).map((f) => f.key);
  return (
    <>
      <Text tone="muted">
        {t(
          'people.settings.integrations.send_people_events_to_other_tools',
          'Send People events to other tools, with only the fields you allow. {{String}} deliveries in the last 24 hours.',
          { String: String(state.deliveries24h) },
        )}
      </Text>
      <Button
        variant="primary"
        onPress={() => {
          setAdding(true);
        }}
      >
        {t('people.settings.integrations.add_endpoint', 'Add endpoint')}
      </Button>
      {secret === null ? null : (
        <ShownOnce
          title={t(
            'people.settings.integrations.copy_the_signing_secret_now',
            'Copy the signing secret now',
          )}
          body={`This is the only time it is shown for ${secret.url}. It cannot be retrieved later; if it is lost, rotate it.`}
          value={secret.value}
          label={t(
            'people.settings.integrations.copy_the_signing_secret',
            'Copy the signing secret',
          )}
        />
      )}
      {state.endpoints.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={t(
            'people.settings.integrations.no_third_party_tools_connected',
            'No third-party tools connected',
          )}
          description={t(
            'people.settings.integrations.add_a_webhook_address_from_another',
            'Add a webhook address from another tool, such as your payroll provider.',
          )}
        />
      ) : (
        state.endpoints.map((e) => (
          <EndpointCard
            key={e.id}
            endpoint={e}
            state={state}
            refused={refused}
            onChanged={onChanged}
            onSecret={(value) => {
              setSecret({ url: e.url, value });
            }}
            onOpenLog={() => {
              onOpenLog(e);
            }}
          />
        ))
      )}
      {adding ? (
        <AddEndpoint
          state={state}
          onClose={() => {
            setAdding(false);
          }}
          onAdded={(url, value) => {
            setAdding(false);
            setSecret({ url, value });
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function EndpointCard({
  endpoint,
  state,
  refused,
  onChanged,
  onSecret,
  onOpenLog,
}: {
  endpoint: Endpoint;
  state: State;
  refused: readonly string[];
  onChanged: () => void;
  onSecret: (secret: string) => void;
  onOpenLog: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [events, setEvents] = useState(endpoint.events);
  const [allowlist, setAllowlist] = useState(endpoint.allowlist);
  const known = new Set(state.events);
  const changed =
    events.join() !== endpoint.events.join() || allowlist.join() !== endpoint.allowlist.join();
  const health: { tone: 'neutral' | 'warning' | 'success'; text: string } = !endpoint.enabled
    ? { tone: 'neutral', text: t('people.settings.integrations.disabled', 'Disabled') }
    : endpoint.retrying > 0
      ? {
          tone: 'warning',
          text: t('people.settings.integrations.retrying', '{{String}} retrying', {
            String: String(endpoint.retrying),
          }),
        }
      : { tone: 'success', text: t('people.settings.integrations.healthy', 'Healthy') };
  const update = (patch: Record<string, unknown>, done: string): void => {
    void act('UpdateWebhookEndpoint', { id: endpoint.id, ...patch }, done).then((ok) => {
      if (ok !== null) onChanged();
    });
  };
  return (
    <Card>
      <Stack gap={3}>
        <View className="flex-row items-center gap-2">
          <Text weight="semibold" className="flex-1 font-mono" numberOfLines={2}>
            {endpoint.url}
          </Text>
          <Badge size="sm" tone={health.tone}>
            {health.text}
          </Badge>
        </View>
        {endpoint.lastDelivery === null && endpoint.secretRotated === null ? null : (
          <Text variant="footnote" tone="muted">
            {[
              endpoint.secretRotated === null
                ? null
                : t(
                    'people.settings.integrations.signing_secret_rotated',
                    'Signing secret rotated {{secretRotated}}',
                    { secretRotated: endpoint.secretRotated },
                  ),
              endpoint.lastDelivery === null ? null : `last delivery ${endpoint.lastDelivery}`,
            ]
              .filter((x) => x !== null)
              .join(' · ')}
          </Text>
        )}
        <ListItem
          listitem={false}
          trailing={
            <Switch
              checked={endpoint.enabled}
              disabled={busy !== null}
              accessibilityLabel={t('people.settings.integrations.enabled_2', 'Enabled: {{url}}', {
                url: endpoint.url,
              })}
              onCheckedChange={(enabled) => {
                update(
                  { enabled },
                  enabled
                    ? t('people.settings.integrations.turned_on', 'Turned on')
                    : t('people.settings.integrations.turned_off', 'Turned off'),
                );
              }}
            />
          }
        >
          {t('people.settings.integrations.enabled', 'Enabled')}
        </ListItem>
        {endpoint.problem === null ? null : <Alert tone="warning">{endpoint.problem}</Alert>}
        <PickMany
          label={t('people.settings.integrations.events', 'Events')}
          options={eventOptions(state.events)}
          value={events.filter((e) => known.has(e))}
          onChange={setEvents}
        />
        <PickMany
          label={t(
            'people.settings.integrations.fields_this_endpoint_receives',
            'Fields this endpoint receives',
          )}
          options={fieldOptions(state.fields)}
          value={allowlist}
          {...(refused.length === 0
            ? {}
            : {
                hint: t(
                  'people.settings.integrations.can_never_be_sent_to_an',
                  '{{join}} can never be sent to an endpoint.',
                  { join: refused.join(' and ') },
                ),
              })}
          onChange={setAllowlist}
        />
        <Button
          variant="primary"
          disabled={!changed || events.length === 0}
          loading={busy === 'UpdateWebhookEndpoint'}
          onPress={() => {
            update({ events, allowlist }, 'Saved');
          }}
        >
          {t('people.settings.integrations.save_changes', 'Save changes')}
        </Button>
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            loading={busy === 'RotateWebhookSecret'}
            onPress={() => {
              void act<{ secret: string }>('RotateWebhookSecret', { id: endpoint.id }).then((r) => {
                if (r !== null) {
                  onSecret(r.secret);
                  onChanged();
                }
              });
            }}
          >
            {t('people.settings.integrations.rotate_secret', 'Rotate secret')}
          </Button>
          <Button className="flex-1" onPress={onOpenLog}>
            {t('people.settings.integrations.delivery_log', 'Delivery log')}
          </Button>
        </View>
      </Stack>
    </Card>
  );
}

function AddEndpoint({
  state,
  onClose,
  onAdded,
}: {
  state: State;
  onClose: () => void;
  onAdded: (url: string, secret: string) => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [url, setUrl] = useState('');
  const [alertEmail, setAlertEmail] = useState('');
  const [events, setEvents] = useState<readonly string[]>([]);
  const [allowlist, setAllowlist] = useState<readonly string[]>([]);
  const [shown, setShown] = useState(false);
  const badUrl = !/^https:\/\/\S+$/.test(url);
  const badEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('people.settings.integrations.add_an_endpoint', 'Add an endpoint')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.settings.integrations.people_sends_a_signed_message_to',
              'People sends a signed message to this address for each event. The signing secret is shown once.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required invalid={shown && badUrl}>
            <FieldLabel>{t('people.settings.integrations.url', 'URL')}</FieldLabel>
            <Input
              value={url}
              onChange={setUrl}
              size="sm"
              keyboardType="url"
              autoCapitalize="none"
              placeholder="https://hooks.your-payroll.com/kithena"
            />
            <FieldError>
              {t(
                'people.settings.integrations.an_https_address_reachable_from_the',
                'An https address, reachable from the internet.',
              )}
            </FieldError>
          </Field>
          <Field required invalid={shown && badEmail}>
            <FieldLabel>{t('people.settings.integrations.alert_email', 'Alert email')}</FieldLabel>
            <Input
              value={alertEmail}
              onChange={setAlertEmail}
              size="sm"
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder={t(
                'people.settings.integrations.it_team_yourcompany_com',
                'it-team@yourcompany.com',
              )}
            />
            <FieldDescription>
              {t(
                'people.settings.integrations.who_hears_if_deliveries_keep_failing',
                'Who hears if deliveries keep failing and the endpoint is turned off.',
              )}
            </FieldDescription>
            <FieldError>
              {t(
                'people.settings.integrations.an_email_address_to_tell',
                'An email address to tell.',
              )}
            </FieldError>
          </Field>
          <PickMany
            label={t('people.settings.integrations.events', 'Events')}
            options={eventOptions(state.events)}
            value={events}
            invalid={shown && events.length === 0}
            hint={
              shown && events.length === 0
                ? t(
                    'people.settings.integrations.choose_at_least_one_event',
                    'Choose at least one event.',
                  )
                : t(
                    'people.settings.integrations.what_the_tool_is_told_about',
                    'What the tool is told about.',
                  )
            }
            onChange={setEvents}
          />
          <PickMany
            label={t(
              'people.settings.integrations.fields_this_endpoint_receives',
              'Fields this endpoint receives',
            )}
            options={fieldOptions(state.fields)}
            value={allowlist}
            hint={t(
              'people.settings.integrations.only_these_details_are_sent_with',
              'Only these details are sent with each event. Choose the fewest the tool needs.',
            )}
            onChange={setAllowlist}
          />
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.integrations.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy === 'CreateWebhookEndpoint'}
            onPress={() => {
              setShown(true);
              if (badUrl || badEmail || events.length === 0) return;
              void act<{ secret: string }>('CreateWebhookEndpoint', {
                url,
                events,
                allowlist,
                alertEmail,
              }).then((made) => {
                if (made !== null) onAdded(url, made.secret);
              });
            }}
          >
            {t('people.settings.integrations.add_endpoint', 'Add endpoint')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Provisioning over SCIM: each system, its token and the fields it keeps upstream. */
function Provisioning({
  scim,
  onChanged,
}: {
  scim: NonNullable<State['scim']>;
  onChanged: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [connecting, setConnecting] = useState(false);
  const [system, setSystem] = useState('');
  const [token, setToken] = useState<{ system: string; value: string } | null>(null);
  return (
    <>
      <Text tone="muted">
        {t(
          'people.settings.integrations.add_and_remove_people_automatically_from',
          'Add and remove people automatically from Okta, Microsoft Entra or another system. Mapped fields become read-only here.',
        )}
      </Text>
      {scim.url === '' ? null : (
        <CopyField
          value={scim.url}
          label={t('people.settings.integrations.copy_the_scim_base_url', 'Copy the SCIM base URL')}
          mono
        />
      )}
      <Button
        onPress={() => {
          setConnecting(true);
        }}
      >
        {t('people.settings.integrations.connect_a_system', 'Connect a system')}
      </Button>
      {token === null ? null : (
        <ShownOnce
          title={t('people.settings.integrations.copy_the_token_now', 'Copy the token now')}
          body={t(
            'people.settings.integrations.this_is_the_only_time_the',
            'This is the only time the token for {{system}} is shown. Paste it into {{system}} as the bearer token. If it is lost, rotate it.',
            { system: token.system },
          )}
          value={token.value}
          label={t('people.settings.integrations.copy_the_scim_token', 'Copy the SCIM token')}
        />
      )}
      {scim.connections.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('people.settings.integrations.no_systems_connected', 'No systems connected')}
          description={t(
            'people.settings.integrations.connect_okta_entra_or_your_hris',
            'Connect Okta, Entra or your HRIS to provision people into People.',
          )}
        />
      ) : (
        scim.connections.map((c) => (
          <Connection
            key={c.id}
            connection={c}
            scim={scim}
            onChanged={onChanged}
            onToken={(value) => {
              setToken({ system: c.system, value });
            }}
          />
        ))
      )}
      {connecting ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setConnecting(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('people.settings.integrations.connect_a_system', 'Connect a system')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'people.settings.integrations.its_token_is_shown_once_after',
                  'Its token is shown once, after this.',
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field required>
                <FieldLabel>
                  {t('people.settings.integrations.what_you_call_it', 'What you call it')}
                </FieldLabel>
                <Input
                  value={system}
                  onChange={setSystem}
                  size="sm"
                  placeholder={t('people.settings.integrations.okta', 'Okta')}
                  maxLength={60}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setConnecting(false);
                }}
              >
                {t('people.settings.integrations.cancel', 'Cancel')}
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                disabled={system.trim() === ''}
                loading={busy === 'CreateScimConnection'}
                onPress={() => {
                  const name = system.trim();
                  void act<{ token: string }>('CreateScimConnection', { system: name }).then(
                    (made) => {
                      if (made === null) return;
                      setConnecting(false);
                      setSystem('');
                      setToken({ system: name, value: made.token });
                      onChanged();
                    },
                  );
                }}
              >
                {t('people.settings.integrations.connect', 'Connect')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function Connection({
  connection,
  scim,
  onChanged,
  onToken,
}: {
  connection: ScimConnection;
  scim: NonNullable<State['scim']>;
  onChanged: () => void;
  onToken: (token: string) => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [mapping, setMapping] = useState(connection.mapping);
  const [path, setPath] = useState('');
  const [key, setKey] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const live = connection.revokedAt === null;
  const labelOf = new Map(scim.mappable.map((a) => [a.key, a.label]));
  const pathLabel = (p: string): string =>
    p.startsWith(`${scim.extension}:`)
      ? t('people.settings.integrations.people', 'People: {{slice}}', {
          slice: p.slice(scim.extension.length + 1),
        })
      : p;
  const changed = JSON.stringify(mapping) !== JSON.stringify(connection.mapping);
  const usedPaths = new Set(mapping.map((m) => m.path));
  const usedKeys = new Set(mapping.map((m) => m.key));
  const paths = [...scim.paths, ...scim.mappable.map((a) => `${scim.extension}:${a.key}`)].filter(
    (p) => !usedPaths.has(p),
  );
  const own = path.startsWith(`${scim.extension}:`);
  return (
    <Card>
      <Stack gap={3}>
        <View className="flex-row items-center gap-2">
          <CardTitle className="flex-1">{connection.system}</CardTitle>
          <Badge size="sm" tone={live ? 'success' : 'neutral'}>
            {live
              ? t('people.settings.integrations.connected', 'Connected')
              : t('people.settings.integrations.disconnected', 'Disconnected')}
          </Badge>
        </View>
        <Text variant="footnote" tone="muted">
          {[
            `${String(connection.linked)} people provisioned`,
            `connected ${connection.createdAt.slice(0, 10)}`,
            connection.tokenRotatedAt === null
              ? null
              : `token rotated ${connection.tokenRotatedAt.slice(0, 10)}`,
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </Text>
        {mapping.length === 0 ? (
          <Text variant="subhead" tone="muted">
            {t(
              'people.settings.integrations.nothing_is_mapped_yet_can_create',
              'Nothing is mapped yet: {{system}} can create people, and keeps none of their fields.',
              { system: connection.system },
            )}
          </Text>
        ) : (
          <List>
            {mapping.map((m) => (
              <ListItem
                key={m.path}
                description={pathLabel(m.path)}
                {...(live
                  ? {
                      trailing: (
                        <Button
                          size="sm"
                          variant="ghost"
                          accessibilityLabel={t(
                            'people.settings.integrations.stop_keeping_in',
                            'Stop keeping {{value}} in {{system}}',
                            { value: labelOf.get(m.key) ?? m.key, system: connection.system },
                          )}
                          onPress={() => {
                            setMapping(mapping.filter((x) => x.path !== m.path));
                          }}
                        >
                          {t('people.settings.integrations.remove', 'Remove')}
                        </Button>
                      ),
                    }
                  : {})}
              >
                {labelOf.get(m.key) ?? m.key}
              </ListItem>
            ))}
          </List>
        )}
        {live ? (
          <>
            <Field>
              <FieldLabel>
                {t('people.settings.integrations.scim_attribute', 'SCIM attribute')}
              </FieldLabel>
              <Select
                value={path}
                onValueChange={(value) => {
                  setPath(value);
                  if (value.startsWith(`${scim.extension}:`))
                    setKey(value.slice(scim.extension.length + 1));
                }}
              >
                <SelectTrigger
                  size="sm"
                  accessibilityLabel={t(
                    'people.settings.integrations.scim_attribute',
                    'SCIM attribute',
                  )}
                >
                  <SelectValue
                    placeholder={t(
                      'people.settings.integrations.choose_an_attribute',
                      'Choose an attribute',
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {paths.map((p) => (
                    <SelectItem key={p} value={p}>
                      {pathLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('people.settings.integrations.field', 'Field')}</FieldLabel>
              <Select value={key} disabled={own} onValueChange={setKey}>
                <SelectTrigger
                  size="sm"
                  accessibilityLabel={t('people.settings.integrations.field', 'Field')}
                >
                  <SelectValue
                    placeholder={t('people.settings.integrations.choose_a_field', 'Choose a field')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {scim.mappable
                    .filter((a) => !usedKeys.has(a.key))
                    .map((a) => (
                      <SelectItem key={a.key} value={a.key}>
                        {a.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Button
              disabled={path === '' || key === '' || usedKeys.has(key)}
              onPress={() => {
                setMapping([...mapping, { path, key }]);
                setPath('');
                setKey('');
              }}
            >
              {t('people.settings.integrations.add_to_mapping', 'Add to mapping')}
            </Button>
            {changed ? (
              <Alert tone="info">
                {t(
                  'people.settings.integrations.saving_makes_every_mapped_field_read',
                  'Saving makes every mapped field read-only in People for the people {{system}} provisions. HR, managers and employees change them in {{system}}.',
                  { system: connection.system },
                )}
              </Alert>
            ) : null}
            <Button
              variant="primary"
              disabled={!changed}
              loading={busy === 'SetScimMapping'}
              onPress={() => {
                void act(
                  'SetScimMapping',
                  { id: connection.id, mapping },
                  t('people.settings.integrations.mapping_saved', 'Mapping saved'),
                ).then((done) => {
                  if (done !== null) onChanged();
                });
              }}
            >
              {t('people.settings.integrations.save_mapping', 'Save mapping')}
            </Button>
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                loading={busy === 'RotateScimToken'}
                onPress={() => {
                  void act<{ token: string }>('RotateScimToken', { id: connection.id }).then(
                    (r) => {
                      if (r !== null) {
                        onToken(r.token);
                        onChanged();
                      }
                    },
                  );
                }}
              >
                {t('people.settings.integrations.rotate_token', 'Rotate token')}
              </Button>
              <Button
                className="flex-1"
                variant="danger-soft"
                onPress={() => {
                  setDisconnecting(true);
                }}
              >
                {t('people.settings.integrations.disconnect', 'Disconnect')}
              </Button>
            </View>
          </>
        ) : null}
      </Stack>
      {disconnecting ? (
        <Confirm
          title={t('people.settings.integrations.disconnect_3', 'Disconnect {{system}}?', {
            system: connection.system,
          })}
          body={t(
            'people.settings.integrations.its_token_stops_working_and_it',
            'Its token stops working, and it no longer adds or removes people here. To provision from it again, connect it as a new system.',
          )}
          keep="Keep it connected"
          action={t('people.settings.integrations.disconnect', 'Disconnect')}
          busy={busy === 'RevokeScimConnection'}
          onClose={() => {
            setDisconnecting(false);
          }}
          onConfirm={() => {
            void act('RevokeScimConnection', { id: connection.id }, 'Disconnected').then((done) => {
              setDisconnecting(false);
              if (done !== null) onChanged();
            });
          }}
        />
      ) : null}
    </Card>
  );
}

interface Delivery {
  readonly id: string;
  readonly eventName: string;
  readonly status: string;
  readonly attempts: number;
  readonly lastResponse: number | null;
  readonly createdAt: string;
  readonly replayOf: string | null;
}

const TONE: Partial<Record<string, 'success' | 'danger' | 'warning' | 'neutral'>> = {
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
  skipped: 'neutral',
};
const WORD = (): Record<string, string> => ({
  delivered: t('people.settings.integrations.delivered', 'Delivered'),
  failed: t('people.settings.integrations.failed', 'Failed'),
  pending: t('people.settings.integrations.pending', 'Pending'),
  skipped: t('people.settings.integrations.skipped', 'Skipped'),
});
const at = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** An endpoint's deliveries, newest first, a failed one replayable. */
export function WebhookLog({ navigation, route }: PeopleScreen<'WebhookLog'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [rows, setRows] = useState<readonly Delivery[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const page = async (after: string | null): Promise<void> => {
    const answer = await ask<{ deliveries: Delivery[]; next: string | null }>(
      signed,
      'WebhookDeliveries',
      {
        endpointId: route.params.id,
        after,
      },
    );
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    setFailed(null);
    setRows((held) => [...(after === null ? [] : (held ?? [])), ...answer.data.deliveries]);
    setNext(answer.data.next);
  };
  useEffect(() => {
    void page(null);
  }, [signed, route.params.id]);

  const back = {
    label: t('people.settings.integrations.webhooks', 'Webhooks'),
    onPress: navigation.goBack,
  };
  return (
    <Page title={t('people.settings.integrations.delivery_log', 'Delivery log')} back={back}>
      <Text variant="footnote" tone="muted" className="font-mono">
        {route.params.url}
      </Text>
      {failed !== null ? (
        <Failed message={failed} onRetry={() => void page(null)} />
      ) : rows === null ? (
        <Loading
          label={t('people.settings.integrations.loading_the_deliveries', 'Loading the deliveries')}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title={t('people.settings.integrations.nothing_sent_yet', 'Nothing sent yet')}
          description={t(
            'people.settings.integrations.deliveries_appear_here_as_events_are',
            'Deliveries appear here as events are sent.',
          )}
        />
      ) : (
        <>
          {rows.some((d) => d.status === 'failed') ? (
            <Alert tone="warning">
              {t(
                'people.settings.integrations.replaying_sends_the_same_event_again',
                'Replaying sends the same event again, with the fields the endpoint may receive now.',
              )}
            </Alert>
          ) : null}
          <List>
            {rows.map((d) => (
              <ListItem
                key={d.id}
                description={[
                  at(d.createdAt),
                  t(
                    'people.settings.integrations.attempts',
                    { one: '{{count}} attempt', other: '{{count}} attempts' },
                    { count: d.attempts },
                  ),
                  d.lastResponse === null ? null : `HTTP ${String(d.lastResponse)}`,
                  d.replayOf === null ? null : 'A replay',
                ]
                  .filter((x) => x !== null)
                  .join(' · ')}
                trailing={
                  d.status === 'failed' ? (
                    <Button
                      size="sm"
                      loading={busy === `ReplayWebhookDelivery`}
                      accessibilityLabel={t(
                        'people.settings.integrations.replay_from',
                        'Replay {{eventName}} from {{at}}',
                        { eventName: d.eventName, at: at(d.createdAt) },
                      )}
                      onPress={() => {
                        void act(
                          'ReplayWebhookDelivery',
                          { deliveryId: d.id },
                          t(
                            'people.settings.integrations.replayed_it_is_sent_shortly_and',
                            'Replayed. It is sent shortly, and listed here as its own delivery.',
                          ),
                        ).then((done) => {
                          if (done !== null) void page(null);
                        });
                      }}
                    >
                      {t('people.settings.integrations.replay', 'Replay')}
                    </Button>
                  ) : (
                    <Badge size="sm" tone={TONE[d.status] ?? 'neutral'}>
                      {WORD()[d.status] ?? d.status}
                    </Badge>
                  )
                }
              >
                {d.eventName}
              </ListItem>
            ))}
          </List>
          {next === null ? null : (
            <Button
              loading={more}
              onPress={() => {
                setMore(true);
                void page(next).then(() => {
                  setMore(false);
                });
              }}
            >
              {t('people.settings.integrations.show_older', 'Show older')}
            </Button>
          )}
        </>
      )}
    </Page>
  );
}
