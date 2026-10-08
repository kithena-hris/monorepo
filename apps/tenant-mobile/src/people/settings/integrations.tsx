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
        ? `${f.key} · special-category data, never sent`
        : f.refused === 'encrypted'
          ? `${f.key} · encrypted, never sent`
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
        placeholder={value.length === 0 ? 'Choose' : `${String(value.length)} chosen`}
        searchPlaceholder="Search"
        emptyMessage="Nothing by that name."
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
      ? 'Chat apps'
      : tab === 'webhooks'
        ? 'Webhooks'
        : tab === 'provisioning'
          ? 'Provisioning'
          : 'Integrations';
  const back = {
    label: tab === undefined ? 'Settings' : 'Integrations',
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
        <Loading label="Loading the integrations" />
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
  return (
    <Page title={title} back={back}>
      <List>
        {slack === undefined ? null : (
          <ListItem
            icon={MessageSquare}
            description={
              slack.connection === null
                ? 'Not connected'
                : `Connected to ${slack.connection.workspace}`
            }
            chevron
            onPress={() => {
              navigation.push('Integrations', { tab: 'slack' });
            }}
          >
            {slack.name}
          </ListItem>
        )}
        <ListItem
          icon={Webhook}
          {...(retrying > 0 ? { iconTone: 4 as const } : {})}
          description={
            live.length === 0
              ? 'None yet'
              : retrying > 0
                ? `${String(retrying)} retrying`
                : `${String(live.length)} active`
          }
          chevron
          onPress={() => {
            navigation.push('Integrations', { tab: 'webhooks' });
          }}
        >
          Webhooks
        </ListItem>
        {state.scim === null ? null : (
          <ListItem
            icon={KeyRound}
            description={
              scimLive.length === 0
                ? 'Not connected'
                : `From ${scimLive[0]?.system ?? 'one system'}`
            }
            chevron
            onPress={() => {
              navigation.push('Integrations', { tab: 'provisioning' });
            }}
          >
            Provisioning
          </ListItem>
        )}
      </List>
      <Card>
        <Stack gap={2}>
          <CardTitle>{`Sent to third-party tools (${String(sent.length)})`}</CardTitle>
          {sent.length === 0 ? (
            <Text variant="subhead" tone="muted">
              Nothing yet. A field is sent only once you allow it on an enabled endpoint.
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
          <CardTitle>Never sent, whatever is chosen</CardTitle>
          <Text variant="subhead" tone="muted">
            Special-category and encrypted fields are never sent. The AI model never sees values.
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
          ? `To ${n.to.toLowerCase()}. ${n.description}`
          : `To ${n.to.toLowerCase()}, who can ${n.action.toLowerCase()} from the message itself. ${n.description}`
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
        Ask questions, approve changes and fill in details from your chat app, with the same access
        as in Kithena.
      </Text>
      {problem === null ? null : <Alert tone="danger" title={problem} />}
      {chat.apps.length === 0 ? (
        <Alert tone="info" title="No chat app is set up in this deployment">
          Ask whoever runs Kithena for you to add one.
        </Alert>
      ) : (
        chat.apps.map((app) => (
          <Card key={app.key}>
            <Stack gap={2}>
              <View className="flex-row items-center gap-2">
                <CardTitle className="flex-1">{app.name}</CardTitle>
                <Badge size="sm" tone={app.connection === null ? 'neutral' : 'success'}>
                  {app.connection === null ? 'Not connected' : 'Connected'}
                </Badge>
              </View>
              <Text variant="subhead" tone="muted">
                {app.connection === null
                  ? app.canConnect
                    ? `Connect your ${app.name} workspace. You approve it in ${app.name}, then come back here.`
                    : `${app.name} is not set up in this deployment yet.`
                  : `Connected to ${app.connection.workspace}. People can mention Kithena or message it directly to ask a question.`}
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
                  {`Add to ${app.name}`}
                </Button>
              ) : (
                <Button
                  variant="danger-soft"
                  onPress={() => {
                    setDisconnecting(app.key);
                  }}
                >
                  Disconnect
                </Button>
              )}
            </Stack>
          </Card>
        ))
      )}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {connected.length === 0
          ? 'What Kithena sends in chat, once a chat app is connected'
          : `Sent to ${connected.map((a) => a.name).join(' and ')} as well as by email`}
      </Text>
      <Text variant="footnote" tone="muted" className="px-1">
        Things to do, with buttons in the message
      </Text>
      <List>{chat.notices.filter((n) => n.action !== null).map(row)}</List>
      <Text variant="footnote" tone="muted" className="px-1">
        Updates, with nothing to do
      </Text>
      <List>{chat.notices.filter((n) => n.action === null).map(row)}</List>
      <Card>
        <Stack gap={2}>
          <CardTitle>What the assistant and chat can use</CardTitle>
          <Text variant="subhead" tone="muted">
            {`${String(chat.fields.on.length)} of ${String(chat.fields.shareable)} fields that may be shared are. Choose them in Employee fields, under Assistant.`}
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
          title={`Disconnect ${chat.apps.find((a) => a.key === disconnecting)?.name ?? 'it'}?`}
          body="Kithena leaves the workspace. Nobody can ask it questions there, and notices go by email only. Buttons on messages already sent stop working. You can connect it again at any time."
          keep="Keep it connected"
          action="Disconnect"
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
        {`Send People events to other tools, with only the fields you allow. ${String(state.deliveries24h)} deliveries in the last 24 hours.`}
      </Text>
      <Button
        variant="primary"
        onPress={() => {
          setAdding(true);
        }}
      >
        Add endpoint
      </Button>
      {secret === null ? null : (
        <ShownOnce
          title="Copy the signing secret now"
          body={`This is the only time it is shown for ${secret.url}. It cannot be retrieved later; if it is lost, rotate it.`}
          value={secret.value}
          label="Copy the signing secret"
        />
      )}
      {state.endpoints.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No third-party tools connected"
          description="Add a webhook address from another tool, such as your payroll provider."
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
    ? { tone: 'neutral', text: 'Disabled' }
    : endpoint.retrying > 0
      ? { tone: 'warning', text: `${String(endpoint.retrying)} retrying` }
      : { tone: 'success', text: 'Healthy' };
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
                : `Signing secret rotated ${endpoint.secretRotated}`,
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
              accessibilityLabel={`Enabled: ${endpoint.url}`}
              onCheckedChange={(enabled) => {
                update({ enabled }, enabled ? 'Turned on' : 'Turned off');
              }}
            />
          }
        >
          Enabled
        </ListItem>
        {endpoint.problem === null ? null : <Alert tone="warning">{endpoint.problem}</Alert>}
        <PickMany
          label="Events"
          options={eventOptions(state.events)}
          value={events.filter((e) => known.has(e))}
          onChange={setEvents}
        />
        <PickMany
          label="Fields this endpoint receives"
          options={fieldOptions(state.fields)}
          value={allowlist}
          {...(refused.length === 0
            ? {}
            : { hint: `${refused.join(' and ')} can never be sent to an endpoint.` })}
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
          Save changes
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
            Rotate secret
          </Button>
          <Button className="flex-1" onPress={onOpenLog}>
            Delivery log
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
          <DialogTitle>Add an endpoint</DialogTitle>
          <DialogDescription>
            People sends a signed message to this address for each event. The signing secret is
            shown once.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required invalid={shown && badUrl}>
            <FieldLabel>URL</FieldLabel>
            <Input
              value={url}
              onChange={setUrl}
              size="sm"
              keyboardType="url"
              autoCapitalize="none"
              placeholder="https://hooks.your-payroll.com/kithena"
            />
            <FieldError>An https address, reachable from the internet.</FieldError>
          </Field>
          <Field required invalid={shown && badEmail}>
            <FieldLabel>Alert email</FieldLabel>
            <Input
              value={alertEmail}
              onChange={setAlertEmail}
              size="sm"
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="it-team@yourcompany.com"
            />
            <FieldDescription>
              Who hears if deliveries keep failing and the endpoint is turned off.
            </FieldDescription>
            <FieldError>An email address to tell.</FieldError>
          </Field>
          <PickMany
            label="Events"
            options={eventOptions(state.events)}
            value={events}
            invalid={shown && events.length === 0}
            hint={
              shown && events.length === 0
                ? 'Choose at least one event.'
                : 'What the tool is told about.'
            }
            onChange={setEvents}
          />
          <PickMany
            label="Fields this endpoint receives"
            options={fieldOptions(state.fields)}
            value={allowlist}
            hint="Only these details are sent with each event. Choose the fewest the tool needs."
            onChange={setAllowlist}
          />
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
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
            Add endpoint
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
        Add and remove people automatically from Okta, Microsoft Entra or another system. Mapped
        fields become read-only here.
      </Text>
      {scim.url === '' ? null : <CopyField value={scim.url} label="Copy the SCIM base URL" mono />}
      <Button
        onPress={() => {
          setConnecting(true);
        }}
      >
        Connect a system
      </Button>
      {token === null ? null : (
        <ShownOnce
          title="Copy the token now"
          body={`This is the only time the token for ${token.system} is shown. Paste it into ${token.system} as the bearer token. If it is lost, rotate it.`}
          value={token.value}
          label="Copy the SCIM token"
        />
      )}
      {scim.connections.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No systems connected"
          description="Connect Okta, Entra or your HRIS to provision people into People."
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
              <DialogTitle>Connect a system</DialogTitle>
              <DialogDescription>Its token is shown once, after this.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field required>
                <FieldLabel>What you call it</FieldLabel>
                <Input
                  value={system}
                  onChange={setSystem}
                  size="sm"
                  placeholder="Okta"
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
                Cancel
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
                Connect
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
    p.startsWith(`${scim.extension}:`) ? `People: ${p.slice(scim.extension.length + 1)}` : p;
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
            {live ? 'Connected' : 'Disconnected'}
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
            {`Nothing is mapped yet: ${connection.system} can create people, and keeps none of their fields.`}
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
                          accessibilityLabel={`Stop keeping ${labelOf.get(m.key) ?? m.key} in ${connection.system}`}
                          onPress={() => {
                            setMapping(mapping.filter((x) => x.path !== m.path));
                          }}
                        >
                          Remove
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
              <FieldLabel>SCIM attribute</FieldLabel>
              <Select
                value={path}
                onValueChange={(value) => {
                  setPath(value);
                  if (value.startsWith(`${scim.extension}:`))
                    setKey(value.slice(scim.extension.length + 1));
                }}
              >
                <SelectTrigger size="sm" accessibilityLabel="SCIM attribute">
                  <SelectValue placeholder="Choose an attribute" />
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
              <FieldLabel>Field</FieldLabel>
              <Select value={key} disabled={own} onValueChange={setKey}>
                <SelectTrigger size="sm" accessibilityLabel="Field">
                  <SelectValue placeholder="Choose a field" />
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
              Add to mapping
            </Button>
            {changed ? (
              <Alert tone="info">
                {`Saving makes every mapped field read-only in People for the people ${connection.system} provisions. HR, managers and employees change them in ${connection.system}.`}
              </Alert>
            ) : null}
            <Button
              variant="primary"
              disabled={!changed}
              loading={busy === 'SetScimMapping'}
              onPress={() => {
                void act('SetScimMapping', { id: connection.id, mapping }, 'Mapping saved').then(
                  (done) => {
                    if (done !== null) onChanged();
                  },
                );
              }}
            >
              Save mapping
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
                Rotate token
              </Button>
              <Button
                className="flex-1"
                variant="danger-soft"
                onPress={() => {
                  setDisconnecting(true);
                }}
              >
                Disconnect
              </Button>
            </View>
          </>
        ) : null}
      </Stack>
      {disconnecting ? (
        <Confirm
          title={`Disconnect ${connection.system}?`}
          body="Its token stops working, and it no longer adds or removes people here. To provision from it again, connect it as a new system."
          keep="Keep it connected"
          action="Disconnect"
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
const WORD: Record<string, string> = {
  delivered: 'Delivered',
  failed: 'Failed',
  pending: 'Pending',
  skipped: 'Skipped',
};
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

  const back = { label: 'Webhooks', onPress: navigation.goBack };
  return (
    <Page title="Delivery log" back={back}>
      <Text variant="footnote" tone="muted" className="font-mono">
        {route.params.url}
      </Text>
      {failed !== null ? (
        <Failed message={failed} onRetry={() => void page(null)} />
      ) : rows === null ? (
        <Loading label="Loading the deliveries" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="Nothing sent yet"
          description="Deliveries appear here as events are sent."
        />
      ) : (
        <>
          {rows.some((d) => d.status === 'failed') ? (
            <Alert tone="warning">
              Replaying sends the same event again, with the fields the endpoint may receive now.
            </Alert>
          ) : null}
          <List>
            {rows.map((d) => (
              <ListItem
                key={d.id}
                description={[
                  at(d.createdAt),
                  `${String(d.attempts)} ${d.attempts === 1 ? 'attempt' : 'attempts'}`,
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
                      accessibilityLabel={`Replay ${d.eventName} from ${at(d.createdAt)}`}
                      onPress={() => {
                        void act(
                          'ReplayWebhookDelivery',
                          { deliveryId: d.id },
                          'Replayed. It is sent shortly, and listed here as its own delivery.',
                        ).then((done) => {
                          if (done !== null) void page(null);
                        });
                      }}
                    >
                      Replay
                    </Button>
                  ) : (
                    <Badge size="sm" tone={TONE[d.status] ?? 'neutral'}>
                      {WORD[d.status] ?? d.status}
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
              Show older
            </Button>
          )}
        </>
      )}
    </Page>
  );
}
