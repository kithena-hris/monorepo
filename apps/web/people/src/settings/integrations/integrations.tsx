import {
  Alert,
  AppMark,
  AutoGrid,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Combobox,
  type ComboboxOption,
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
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  formatList,
  icons,
  Input,
  PageHeader,
  PageSection,
  Stack,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useHeld } from '../../held';
import { Loaded, type Loadable, type Outcome } from '../../load';
import { ChatApps, type ChatAppsProps, type ChatAppsState } from './chat-apps';
import { Provisioning, type ProvisioningProps, type ScimState } from './provisioning';
import { t } from '../../i18n';

/** A field in the published schema, and whether an allowlist may name it. */
export interface AllowableField {
  readonly key: string;
  readonly label: string;
  /** Why it can never be sent, or null when it can. */
  readonly refused: 'special-category' | 'encrypted' | null;
}

export interface Endpoint {
  readonly id: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly events: readonly string[];
  readonly allowlist: readonly string[];
  /** Deliveries waiting on a retry. */
  readonly retrying: number;
  /** What went wrong most recently, in words, or null. */
  readonly problem: string | null;
  readonly lastDelivery: string | null;
  readonly secretRotated: string | null;
}

export interface IntegrationsState {
  readonly schemaVersion: number;
  readonly deliveries24h: number;
  /** The events an endpoint may subscribe to. */
  readonly events: readonly string[];
  readonly fields: readonly AllowableField[];
  readonly endpoints: readonly Endpoint[];
  /** SCIM provisioning and what it keeps upstream (PEO-072, PEO-073); absent where not served. */
  readonly scim?: ScimState;
  /** Chat apps and People's notices to them; absent where no chat service answered. */
  readonly chat?: ChatAppsState;
}

export interface EndpointInput {
  readonly url: string;
  readonly events: readonly string[];
  readonly allowlist: readonly string[];
  /** Emailed if the endpoint is turned off after failing for a day (PEO-093). Required. */
  readonly alertEmail: string;
}

/** A secret is shown once, here, and is never retrievable again. */
export type WithSecret =
  { readonly ok: true; readonly secret: string } | { readonly ok: false; readonly message: string };

export interface IntegrationsProps {
  readonly load: Loadable<IntegrationsState>;
  readonly onCreate: (input: EndpointInput) => Promise<WithSecret>;
  readonly onUpdate: (
    id: string,
    patch: Partial<EndpointInput> & { readonly enabled?: boolean },
  ) => Promise<Outcome>;
  readonly onRotate: (id: string) => Promise<WithSecret>;
  /** Open an endpoint's delivery log (PEO-121). */
  readonly onOpenLog?: (id: string) => void;
  /** SCIM connections (PEO-072); absent, the section is not drawn. */
  readonly scim?: Omit<ProvisioningProps, 'scim'>;
  /** Chat apps (Slack today) and People's notices to them; absent, not drawn. */
  readonly chat?: ChatAppsProps;
  /** The tab on screen, from its address, held by the host. */
  readonly tab?: string | null;
  readonly onTabChange?: (tab: string) => void;
  /**
   * The overview's address, each other tab at `<tabsAt>/<tab>`. Given, an
   * overview card opens its tab as a link, which works before the screen has
   * hydrated; a button drawn by the server does nothing until then.
   */
  readonly tabsAt?: string;
  /**
   * The dialog open over the tab, held by the host so a link opens it in the
   * server's HTML: `endpoint` to add a webhook endpoint, `connect` to connect
   * a system over SCIM. Any other value is closed.
   */
  readonly open?: string | null;
  readonly onOpenChange?: (open: string | null) => void;
}

/**
 * What leaves the building, and to whom (PRD §13.3, design screen 9).
 *
 * Each endpoint subscribes to events and to a field allowlist. The allowlist
 * is chosen from the published schema's fields, so it cannot name a field
 * that does not exist or one the policy forbids — and People refuses the same
 * two things if anything else tries (`allowable` in the webhook service). A
 * signing secret is a `CopyField`, shown once and never retrievable, the shape
 * the back office already uses for an enrolment link.
 */
export function Integrations(props: IntegrationsProps): JSX.Element {
  return (
    <Loaded
      load={props.load}
      what={t('settings.integrations.integrations.the_integrations', 'the integrations')}
    >
      {(state) => <Endpoints {...props} state={state} />}
    </Loaded>
  );
}

/** "people.person.hired" as "Person hired", with the name itself beneath. */
function eventOptions(events: readonly string[]): ComboboxOption[] {
  return events.map((e) => {
    const words = e.replace(/^people\./, '').replaceAll(/[._]/g, ' ');
    return {
      value: e,
      label: words.charAt(0).toUpperCase() + words.slice(1),
      description: e,
      group:
        e.split('.')[1] === 'person'
          ? t('settings.integrations.integrations.a_person', 'A person')
          : t('settings.integrations.integrations.the_company', 'The company'),
    };
  });
}

/** Every field of the published schema; one no endpoint may receive is shown and cannot be chosen. */
function fieldOptions(fields: readonly AllowableField[]): ComboboxOption[] {
  return fields.map((f) => ({
    value: f.key,
    label: f.label,
    description:
      f.refused === 'special-category'
        ? t(
            'settings.integrations.integrations.special_category_data_never_sent',
            '{{key}} · special-category data, never sent',
            { key: f.key },
          )
        : f.refused === 'encrypted'
          ? t(
              'settings.integrations.integrations.encrypted_never_sent',
              '{{key}} · encrypted, never sent',
              { key: f.key },
            )
          : f.key,
    disabled: f.refused !== null,
  }));
}

/** Several of a known list, searched and chosen, shown as chips. */
function PickMany({
  label,
  options,
  value,
  onChange,
  hint,
  invalid = false,
}: {
  readonly label: string;
  readonly options: readonly ComboboxOption[];
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly hint?: string | undefined;
  readonly invalid?: boolean;
}): JSX.Element {
  return (
    <Field invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Combobox
          multiple
          chips
          label={label}
          options={options}
          value={value}
          placeholder={
            value.length === 0
              ? t('settings.integrations.integrations.choose', 'Choose')
              : t('settings.integrations.integrations.chosen', '{{length}} chosen', {
                  length: String(value.length),
                })
          }
          searchPlaceholder={t('settings.integrations.integrations.search', 'Search')}
          emptyMessage={t(
            'settings.integrations.integrations.nothing_by_that_name',
            'Nothing by that name.',
          )}
          onChange={(next) => {
            onChange(Array.isArray(next) ? next : []);
          }}
        />
      </FieldControl>
      {hint === undefined ? null : <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

function Endpoints({
  state,
  onCreate,
  onUpdate,
  onRotate,
  onOpenLog,
  scim,
  chat,
  tab: heldTab,
  onTabChange,
  tabsAt,
  open: heldOpen,
  onOpenChange,
}: IntegrationsProps & { readonly state: IntegrationsState }): JSX.Element {
  const [open, setOpen] = useHeld<string | null>(heldOpen, onOpenChange, null);
  const dialog = (name: string) => ({
    open: open === name,
    onOpenChange: (next: boolean) => {
      setOpen(next ? name : null);
    },
  });
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);
  // Back where Slack sent them: straight to its tab.
  const [chosen, setTab] = useHeld<string>(
    heldTab,
    onTabChange,
    chat?.returned === undefined || chat.returned === null ? 'overview' : 'slack',
  );
  // A tab this viewer has; a link to one that is not drawn here opens the overview.
  const tabs = [
    'overview',
    'webhooks',
    ...(chat === undefined || state.chat === undefined ? [] : ['slack']),
    ...(state.scim === undefined || scim === undefined ? [] : ['provisioning']),
  ];
  const tab = tabs.includes(chosen) ? chosen : 'overview';
  const refusedLabels = state.fields.filter((f) => f.refused !== null).map((f) => f.key);

  return (
    <Stack gap={6}>
      <PageHeader
        title={t('settings.integrations.integrations.integrations', 'Integrations')}
        description={t(
          'settings.integrations.integrations.connect_people_to_the_tools_your',
          'Connect People to the tools your company already uses.',
        )}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('settings.integrations.integrations.integrations', 'Integrations')}>
          <TabsTrigger value="overview">
            {t('settings.integrations.integrations.overview', 'Overview')}
          </TabsTrigger>
          {chat === undefined || state.chat === undefined ? null : (
            <TabsTrigger value="slack">
              {t('settings.integrations.integrations.slack', 'Slack')}
            </TabsTrigger>
          )}
          <TabsTrigger value="webhooks">
            {t('settings.integrations.integrations.webhooks', 'Webhooks')}
          </TabsTrigger>
          {state.scim === undefined || scim === undefined ? null : (
            <TabsTrigger value="provisioning">
              {t('settings.integrations.integrations.provisioning', 'Provisioning')}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="overview" className="pt-6">
          <Stack gap={6}>
            <Directory
              state={state}
              chatShown={chat !== undefined}
              scimShown={scim !== undefined}
              onOpen={setTab}
              {...(tabsAt === undefined ? {} : { tabsAt })}
            />
            <Outgoing state={state} />
          </Stack>
        </TabsContent>
        {chat === undefined || state.chat === undefined ? null : (
          <TabsContent value="slack" className="pt-6">
            <ChatApps {...chat} state={state.chat} />
          </TabsContent>
        )}
        <TabsContent value="webhooks" className="pt-6">
          <PageSection
            title={t('settings.integrations.integrations.webhooks', 'Webhooks')}
            description={t(
              'settings.integrations.integrations.send_people_events_to_other_tools',
              {
                one: 'Send People events to other tools, with only the fields you allow. {{count}} endpoint · {{toLocaleString}} deliveries in the last 24 hours.',
                other:
                  'Send People events to other tools, with only the fields you allow. {{count}} endpoints · {{toLocaleString}} deliveries in the last 24 hours.',
              },
              {
                count: state.endpoints.length,
                toLocaleString: state.deliveries24h.toLocaleString(),
              },
            )}
            actions={
              <Button
                variant="primary"
                onClick={() => {
                  setOpen('endpoint');
                }}
              >
                {t('settings.integrations.integrations.add_endpoint', 'Add endpoint')}
              </Button>
            }
          >
            <Stack gap={4}>
              {secret === null ? null : (
                <Alert
                  tone="warning"
                  title={t(
                    'settings.integrations.integrations.copy_the_signing_secret_now',
                    'Copy the signing secret now',
                  )}
                >
                  <Stack gap={2}>
                    <p>
                      {t(
                        'settings.integrations.integrations.this_is_the_only_time_it',
                        'This is the only time it is shown for {{url}}. It cannot be retrieved later; if it is lost, rotate it.',
                        { url: secret.url },
                      )}
                    </p>
                    <CopyField
                      value={secret.value}
                      label={t(
                        'settings.integrations.integrations.copy_the_signing_secret',
                        'Copy the signing secret',
                      )}
                    />
                  </Stack>
                </Alert>
              )}
              {state.endpoints.length === 0 ? (
                <EmptyState
                  title={t(
                    'settings.integrations.integrations.no_third_party_tools_connected',
                    'No third-party tools connected',
                  )}
                  description={t(
                    'settings.integrations.integrations.add_a_webhook_address_from_another',
                    'Add a webhook address from another tool, such as your payroll provider.',
                  )}
                />
              ) : (
                state.endpoints.map((endpoint) => (
                  <EndpointCard
                    key={endpoint.id}
                    endpoint={endpoint}
                    state={state}
                    refusedKeys={refusedLabels}
                    onUpdate={onUpdate}
                    {...(onOpenLog === undefined
                      ? {}
                      : {
                          onOpenLog: () => {
                            onOpenLog(endpoint.id);
                          },
                        })}
                    onRotate={async () => {
                      const rotated = await onRotate(endpoint.id);
                      if (rotated.ok) setSecret({ url: endpoint.url, value: rotated.secret });
                      return rotated.ok ? { ok: true } : rotated;
                    }}
                  />
                ))
              )}
            </Stack>
          </PageSection>
        </TabsContent>
        {state.scim === undefined || scim === undefined ? null : (
          <TabsContent value="provisioning" className="pt-6">
            <Provisioning
              scim={state.scim}
              {...scim}
              connecting={open === 'connect'}
              onConnectingChange={(next) => {
                setOpen(next ? 'connect' : null);
              }}
            />
          </TabsContent>
        )}
      </Tabs>
      <AddEndpoint
        {...dialog('endpoint')}
        state={state}
        onCreate={async (input) => {
          const created = await onCreate(input);
          if (created.ok) setSecret({ url: input.url, value: created.secret });
          return created.ok ? { ok: true } : created;
        }}
      />
    </Stack>
  );
}

/**
 * Every integration side by side, the way integration directories are laid
 * out: what it is, whether it is on, and one way into its settings below.
 */
function Directory({
  state,
  chatShown,
  scimShown,
  onOpen,
  tabsAt,
}: {
  readonly state: IntegrationsState;
  readonly chatShown: boolean;
  readonly scimShown: boolean;
  readonly onOpen: (tab: string) => void;
  readonly tabsAt?: string;
}): JSX.Element {
  const slack = state.chat?.apps.find((a) => a.key === 'slack');
  const live = state.endpoints.filter((e) => e.enabled);
  const retrying = live.filter((e) => e.retrying > 0).length;
  const scimLive = (state.scim?.connections ?? []).filter((c) => c.revokedAt === null);
  const cards: {
    readonly id: string;
    readonly name: string;
    readonly mark: JSX.Element;
    readonly says: string;
    readonly status: { readonly tone: 'success' | 'neutral' | 'warning'; readonly text: string };
    readonly action: string;
  }[] = [
    ...(chatShown && slack !== undefined
      ? [
          {
            id: 'slack',
            name: 'Slack',
            mark: <AppMark app="slack" className="size-7" />,
            says: t(
              'settings.integrations.integrations.answer_questions_and_approve_changes_in',
              'Answer questions and approve changes in Slack.',
            ),
            status:
              slack.connection === null
                ? {
                    tone: 'neutral' as const,
                    text: t('settings.integrations.integrations.not_connected', 'Not connected'),
                  }
                : {
                    tone: 'success' as const,
                    text: t(
                      'settings.integrations.integrations.connected_to',
                      'Connected to {{workspace}}',
                      { workspace: slack.connection.workspace },
                    ),
                  },
            action:
              slack.connection === null
                ? t('settings.integrations.integrations.connect', 'Connect')
                : t('settings.integrations.integrations.manage', 'Manage'),
          },
        ]
      : []),
    {
      id: 'webhooks',
      name: 'Webhooks',
      mark: <icons.send aria-hidden className="size-6 text-fg-muted" />,
      says: t(
        'settings.integrations.integrations.notify_other_tools_when_people_join',
        'Notify other tools when people join, move or leave.',
      ),
      status:
        live.length === 0
          ? { tone: 'neutral', text: t('settings.integrations.integrations.none_yet', 'None yet') }
          : retrying > 0
            ? {
                tone: 'warning',
                text: t('settings.integrations.integrations.retrying_count', '{{String}} retrying', {
                  String: String(retrying),
                }),
              }
            : {
                tone: 'success',
                text: t('settings.integrations.integrations.active', '{{String}} active', {
                  String: String(live.length),
                }),
              },
      action:
        live.length === 0
          ? t('settings.integrations.integrations.add_one', 'Add one')
          : t('settings.integrations.integrations.manage', 'Manage'),
    },
    ...(scimShown && state.scim !== undefined
      ? [
          {
            id: 'provisioning',
            name: 'Provisioning',
            mark: <icons.people aria-hidden className="size-6 text-fg-muted" />,
            says: t(
              'settings.integrations.integrations.sync_people_with_your_identity_provider',
              'Sync people with your identity provider (SCIM).',
            ),
            status:
              scimLive.length === 0
                ? {
                    tone: 'neutral' as const,
                    text: t('settings.integrations.integrations.not_connected', 'Not connected'),
                  }
                : {
                    tone: 'success' as const,
                    text: t('settings.integrations.integrations.from', 'From {{value}}', {
                      value: scimLive[0]?.system ?? 'one system',
                    }),
                  },
            action:
              scimLive.length === 0
                ? t('settings.integrations.integrations.connect', 'Connect')
                : t('settings.integrations.integrations.manage', 'Manage'),
          },
        ]
      : []),
  ];
  return (
    <section aria-labelledby="all-integrations">
      <h2 id="all-integrations" className="sr-only">
        {t('settings.integrations.integrations.all_integrations', 'All integrations')}
      </h2>
      <AutoGrid minItemWidth="15rem" gap={4}>
        {cards.map((c) => (
          <Card key={c.id} className="flex flex-col">
            <CardHeader className="flex-row items-center gap-3">
              {c.mark}
              <CardTitle className="flex-1">{c.name}</CardTitle>
              <Badge tone={c.status.tone} size="sm">
                {c.status.text}
              </Badge>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="text-sm text-fg-muted">{c.says}</p>
            </CardContent>
            <CardFooter>
              {tabsAt === undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t('settings.integrations.integrations.text', '{{action}}: {{name}}', {
                    action: c.action,
                    name: c.name,
                  })}
                  onClick={() => {
                    onOpen(c.id);
                  }}
                >
                  {c.action}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" asChild>
                  <a
                    href={`${tabsAt}/${c.id}`}
                    aria-label={t(
                      'settings.integrations.integrations.text',
                      '{{action}}: {{name}}',
                      { action: c.action, name: c.name },
                    )}
                  >
                    {c.action}
                  </a>
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </AutoGrid>
    </section>
  );
}

/**
 * What can leave Kithena, at a glance: the fields some tool receives, and
 * the ones no tool ever may. Read from the same allowlists and policy the
 * webhook service enforces, so it cannot promise what People would refuse.
 */
function Outgoing({ state }: { readonly state: IntegrationsState }): JSX.Element {
  const label = new Map(state.fields.map((f) => [f.key, f.label]));
  const receivers = new Map<string, number>();
  for (const e of state.endpoints.filter((x) => x.enabled)) {
    for (const key of e.allowlist) receivers.set(key, (receivers.get(key) ?? 0) + 1);
  }
  const sent = [...receivers.entries()].toSorted(([a], [b]) =>
    (label.get(a) ?? a).localeCompare(label.get(b) ?? b),
  );
  const never = state.fields.filter((f) => f.refused !== null);
  return (
    <PageSection
      surface
      title={t(
        'settings.integrations.integrations.data_shared_outside_kithena',
        'Data shared outside Kithena',
      )}
      description={t(
        'settings.integrations.integrations.webhooks_send_only_the_fields_you',
        'Webhooks send only the fields you allow. Chat apps show only fields shared with the assistant, to people who can already see them. The AI model never sees values.',
      )}
    >
      <Stack gap={4}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">
            {t(
              'settings.integrations.integrations.sent_to_third_party_tools',
              'Sent to third-party tools (',
            )}
            {String(sent.length)})
          </p>
          {sent.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t(
                'settings.integrations.integrations.nothing_yet_a_field_is_sent',
                'Nothing yet. A field is sent only once you allow it on an enabled endpoint.',
              )}
            </p>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {sent.map(([key, n]) => (
                <Badge key={key} tone="info">
                  {label.get(key) ?? key}
                  {state.endpoints.length > 1
                    ? ` · ${String(n)} ${n === 1 ? 'tool' : 'tools'}`
                    : ''}
                </Badge>
              ))}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">
            {t(
              'settings.integrations.integrations.never_sent_whatever_is_chosen',
              'Never sent, whatever is chosen (',
            )}
            {String(never.length)})
          </p>
          <p className="text-sm text-fg-muted">
            {t(
              'settings.integrations.integrations.special_category_and_encrypted_fields_are',
              'Special-category and encrypted fields are never sent.',
            )}
          </p>
          {never.length === 0 ? null : (
            <span className="flex flex-wrap gap-1.5">
              {never.map((f) => (
                <Badge key={f.key} tone="neutral">
                  {f.label}
                </Badge>
              ))}
            </span>
          )}
        </div>
      </Stack>
    </PageSection>
  );
}

function EndpointCard({
  endpoint,
  state,
  refusedKeys,
  onUpdate,
  onRotate,
  onOpenLog,
}: {
  readonly endpoint: Endpoint;
  readonly state: IntegrationsState;
  readonly refusedKeys: readonly string[];
  readonly onUpdate: IntegrationsProps['onUpdate'];
  readonly onRotate: () => Promise<Outcome>;
  readonly onOpenLog?: () => void;
}): JSX.Element {
  const [events, setEvents] = useState(endpoint.events);
  const [allowlist, setAllowlist] = useState(endpoint.allowlist);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const changed =
    events.join() !== endpoint.events.join() || allowlist.join() !== endpoint.allowlist.join();
  const knownEvents = new Set(state.events);

  const attempt = async (run: () => Promise<Outcome>): Promise<void> => {
    setBusy(true);
    setRefused(null);
    const outcome = await run();
    setBusy(false);
    if (!outcome.ok) setRefused(outcome.message);
  };

  const health: { tone: 'neutral' | 'warning' | 'success'; text: string } = !endpoint.enabled
    ? { tone: 'neutral', text: t('settings.integrations.integrations.disabled', 'Disabled') }
    : endpoint.retrying > 0
      ? {
          tone: 'warning',
          text: t('settings.integrations.integrations.retrying', '{{retrying}} retrying', {
            retrying: String(endpoint.retrying),
          }),
        }
      : { tone: 'success', text: t('settings.integrations.integrations.healthy', 'Healthy') };

  return (
    <PageSection
      surface
      aria-label={endpoint.url}
      title={<span className="font-mono text-sm break-all">{endpoint.url}</span>}
      description={
        [
          endpoint.secretRotated === null
            ? null
            : t(
                'settings.integrations.integrations.signing_secret_rotated',
                'Signing secret rotated {{secretRotated}}',
                { secretRotated: endpoint.secretRotated },
              ),
          endpoint.lastDelivery === null
            ? null
            : t(
                'settings.integrations.integrations.last_delivery',
                'last delivery {{lastDelivery}}',
                { lastDelivery: endpoint.lastDelivery },
              ),
        ]
          .filter((x) => x !== null)
          .join(' · ') || undefined
      }
      actions={
        <span className="flex items-center gap-3">
          <Badge tone={health.tone}>{health.text}</Badge>
          <Field orientation="horizontal">
            <FieldLabel>{t('settings.integrations.integrations.enabled', 'Enabled')}</FieldLabel>
            <FieldControl>
              <Switch
                checked={endpoint.enabled}
                disabled={busy}
                onCheckedChange={(enabled) => {
                  void attempt(() => onUpdate(endpoint.id, { enabled }));
                }}
              />
            </FieldControl>
          </Field>
        </span>
      }
    >
      <Stack gap={4}>
        {endpoint.problem === null ? null : <Alert tone="warning">{endpoint.problem}</Alert>}
        <PickMany
          label={t('settings.integrations.integrations.events', 'Events')}
          options={eventOptions(state.events)}
          value={events.filter((e) => knownEvents.has(e))}
          onChange={setEvents}
        />
        <PickMany
          label={t(
            'settings.integrations.integrations.fields_this_endpoint_receives',
            'Fields this endpoint receives',
          )}
          options={fieldOptions(state.fields)}
          value={allowlist}
          hint={
            refusedKeys.length === 0
              ? undefined
              : t(
                  'settings.integrations.integrations.can_never_be_sent_to_an',
                  '{{join}} can never be sent to an endpoint.',
                  { join: formatList(refusedKeys) },
                )
          }
          onChange={setAllowlist}
        />
        {refused === null ? null : (
          <Alert
            tone="danger"
            title={t('settings.integrations.integrations.not_saved', 'Not saved')}
          >
            {refused}
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={!changed || events.length === 0}
            loading={busy}
            loadingLabel={t('settings.integrations.integrations.saving', 'Saving')}
            onClick={() => {
              void attempt(() => onUpdate(endpoint.id, { events, allowlist }));
            }}
          >
            {t('settings.integrations.integrations.save_changes', 'Save changes')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void attempt(onRotate);
            }}
          >
            {t('settings.integrations.integrations.rotate_signing_secret', 'Rotate signing secret')}
          </Button>
          {onOpenLog === undefined ? null : (
            <Button
              aria-label={t(
                'settings.integrations.integrations.delivery_log_for',
                'Delivery log for {{url}}',
                { url: endpoint.url },
              )}
              onClick={onOpenLog}
            >
              {t('settings.integrations.integrations.delivery_log', 'Delivery log')}
            </Button>
          )}
        </div>
      </Stack>
    </PageSection>
  );
}

function AddEndpoint({
  open,
  onOpenChange,
  state,
  onCreate,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly state: IntegrationsState;
  readonly onCreate: (input: EndpointInput) => Promise<Outcome>;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<readonly string[]>([]);
  const [allowlist, setAllowlist] = useState<readonly string[]>([]);
  const [alertEmail, setAlertEmail] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const badUrl = !/^https:\/\/\S+$/.test(url);
  const badEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail);

  const create = async (): Promise<void> => {
    setShown(true);
    if (badUrl || badEmail || events.length === 0) return;
    setBusy(true);
    const outcome = await onCreate({ url, events, allowlist, alertEmail });
    setBusy(false);
    if (outcome.ok) {
      setUrl('');
      setEvents([]);
      setAllowlist([]);
      setAlertEmail('');
      setShown(false);
      setRefused(null);
      onOpenChange(false);
    } else {
      setRefused(outcome.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('settings.integrations.integrations.add_an_endpoint', 'Add an endpoint')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.integrations.integrations.people_sends_a_signed_message_to',
              'People sends a signed message to this address for each selected event. The signing secret is shown once.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required invalid={shown && badUrl}>
              <FieldLabel>{t('settings.integrations.integrations.url', 'URL')}</FieldLabel>
              <FieldControl>
                <Input
                  type="url"
                  placeholder="https://hooks.your-payroll.com/kithena/incoming"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t(
                  'settings.integrations.integrations.the_tools_address_for_incoming_webhooks',
                  'The tool’s address for incoming webhooks, from its own settings.',
                )}
              </FieldDescription>
              <FieldError>
                {t(
                  'settings.integrations.integrations.an_https_address_reachable_from_the',
                  'An https address, reachable from the internet.',
                )}
              </FieldError>
            </Field>
            <Field required invalid={shown && badEmail}>
              <FieldLabel>
                {t('settings.integrations.integrations.alert_email', 'Alert email')}
              </FieldLabel>
              <FieldControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder={t(
                    'settings.integrations.integrations.it_team_yourcompany_com',
                    'it-team@yourcompany.com',
                  )}
                  value={alertEmail}
                  onChange={(e) => {
                    setAlertEmail(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t(
                  'settings.integrations.integrations.who_hears_if_deliveries_keep_failing',
                  'Who hears if deliveries keep failing and the endpoint is turned off.',
                )}
              </FieldDescription>
              <FieldError>
                {t(
                  'settings.integrations.integrations.an_email_address_to_tell',
                  'An email address to tell.',
                )}
              </FieldError>
            </Field>
            <PickMany
              label={t('settings.integrations.integrations.events', 'Events')}
              options={eventOptions(state.events)}
              value={events}
              invalid={shown && events.length === 0}
              hint={
                shown && events.length === 0
                  ? t(
                      'settings.integrations.integrations.choose_at_least_one_event',
                      'Choose at least one event.',
                    )
                  : t(
                      'settings.integrations.integrations.what_the_tool_is_told_about',
                      'What the tool is told about. A payroll tool usually wants hires, job changes and leavers.',
                    )
              }
              onChange={setEvents}
            />
            <PickMany
              label={t(
                'settings.integrations.integrations.fields_this_endpoint_receives',
                'Fields this endpoint receives',
              )}
              options={fieldOptions(state.fields)}
              value={allowlist}
              hint={t(
                'settings.integrations.integrations.only_these_details_are_sent_with',
                'Only these details are sent with each event. Choose the fewest the tool needs.',
              )}
              onChange={setAllowlist}
            />
            {refused === null ? null : (
              <Alert
                tone="danger"
                title={t('settings.integrations.integrations.not_added', 'Not added')}
              >
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('settings.integrations.integrations.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel={t('settings.integrations.integrations.adding', 'Adding')}
            onClick={() => {
              void create();
            }}
          >
            {t('settings.integrations.integrations.add_endpoint', 'Add endpoint')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
