import {
  Alert,
  Badge,
  Button,
  CopyField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  List,
  ListItem,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  icons,
  type IconName,
} from '@reach/ui';
import { createElement, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { SettingsSkeleton, placeName } from './shared';

/**
 * Integrations (T35, TOF-109): where time off and attendance show up
 * outside this module.
 *
 * Named by what each thing is — Calendar, Chat apps — and a vendor's name
 * only on its own row. A provider Time Off has no credentials for is listed
 * and says what it needs rather than offering a button that cannot work.
 * The Kithena modules that would read Time Off's events do not exist yet and
 * are marked "Kithena module", so it is clear what is a contract between
 * modules and not a switch here.
 */

type Provider = 'google' | 'microsoft' | 'slack' | 'teams';

export interface IntegrationsData {
  readonly integrations: readonly {
    readonly provider: Provider;
    readonly kind: 'calendar' | 'chat';
    readonly available: boolean;
    readonly configured: boolean;
    readonly connected: boolean;
    readonly connectedAt: string | null;
    readonly account: string | null;
  }[];
  readonly kiosks: readonly {
    readonly id: string;
    readonly name: string;
    readonly locationKey: string;
    readonly lastSeenAt: string | null;
    readonly revokedAt: string | null;
  }[];
  readonly locations: readonly { readonly locationKey: string; readonly name: string | null }[];
  readonly packs: readonly {
    readonly country: string;
    readonly reviewed: boolean;
    readonly inUse: boolean;
  }[];
  readonly modules: readonly { readonly key: string; readonly events: readonly string[] }[];
  /** Whether a chat answer may name people on private leave (assistant PRD §11.4). */
  readonly chatAnswers: { readonly namesPrivateLeave: boolean };
}

export interface IntegrationsProps {
  readonly load: Loadable<IntegrationsData>;
  /** The address's query: `connected` or `refused` after a provider's consent page. */
  readonly query?: Readonly<Record<string, string>>;
  /** A consent page to go to, or `null` when it is connected already. */
  readonly onConnect?: (
    provider: Provider,
  ) => Promise<
    | { readonly ok: true; readonly url: string | null }
    | { readonly ok: false; readonly message: string }
  >;
  readonly onDisconnect?: (provider: Provider) => Promise<Outcome>;
  readonly onRegisterKiosk?: (input: {
    readonly name: string;
    readonly locationKey: string;
  }) => Promise<
    | { readonly ok: true; readonly deviceId: string; readonly token: string }
    | { readonly ok: false; readonly message: string }
  >;
  readonly onRevokeKiosk?: (deviceId: string) => Promise<Outcome>;
  /** HR's switch for naming people on private leave in chat answers. */
  readonly onChatAnswers?: (input: { readonly namesPrivateLeave: boolean }) => Promise<Outcome>;
  /** Where the browser goes for a consent page. */
  readonly onLeave?: (url: string) => void;
}

const TITLE = 'Integrations';
const DESCRIPTION = 'Where time off and attendance show up outside this module.';
const page = '@container/integrations flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[60rem]/integrations:grid @min-[60rem]/integrations:grid-cols-2 @min-[60rem]/integrations:items-start';

const icon = (name: IconName): ReactNode => createElement(icons[name], { 'aria-hidden': true });

/** A vendor's name, on its own row only. */
const PRODUCT: Record<Provider, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft Outlook',
  slack: 'Slack',
  teams: 'Microsoft Teams',
};

/** A provider named in the address, which anyone can type. */
const productOf = (provider: string): string =>
  provider in PRODUCT ? PRODUCT[provider as Provider] : provider;

const MODULE: Record<string, { name: string; icon: IconName; does: string }> = {
  payroll: {
    name: 'Payroll',
    icon: 'payroll',
    does: 'Overtime, unpaid leave, negative balances and parental pay changes each month.',
  },
  benefits: {
    name: 'Benefits',
    icon: 'health',
    does: 'Adds dependents after a birth and pauses benefits during unpaid leave.',
  },
  projects: {
    name: 'Projects',
    icon: 'cards',
    does: 'Deadlines and owners for clash checks and handover suggestions.',
  },
};

const region = new Intl.DisplayNames(['en'], { type: 'region' });

const shortDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(iso),
  );

export function Integrations(props: IntegrationsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <IntegrationsSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Loaded load={load} what="the integrations">
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  query = {},
  onConnect,
  onDisconnect,
  onRegisterKiosk,
  onRevokeKiosk,
  onChatAnswers,
  onLeave = (url) => {
    window.location.assign(url);
  },
}: IntegrationsProps & { readonly data: IntegrationsData }): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Shown at once, put back if Time Off refuses it.
  const [naming, setNaming] = useState(data.chatAnswers.namesPrivateLeave);
  const connected = query['connected'];
  const refused = query['refused'];

  const act = async (key: string, run: () => Promise<Outcome>): Promise<void> => {
    setBusy(key);
    setProblem(null);
    const done = await run();
    setBusy(null);
    if (!done.ok) setProblem(done.message);
  };

  const providerRow = (row: IntegrationsData['integrations'][number]): JSX.Element => {
    const status = row.connected
      ? { tone: 'success' as const, label: 'Connected' }
      : !row.available
        ? { tone: 'neutral' as const, label: 'Not available yet' }
        : !row.configured
          ? { tone: 'warning' as const, label: 'Needs credentials' }
          : { tone: 'neutral' as const, label: 'Not connected' };
    const action = row.connected ? (
      <Button
        size="sm"
        loading={busy === row.provider}
        onClick={() => {
          void act(
            row.provider,
            () => onDisconnect?.(row.provider) ?? Promise.resolve({ ok: true }),
          );
        }}
      >
        Disconnect
      </Button>
    ) : row.available && row.configured ? (
      <Button
        size="sm"
        variant="primary"
        loading={busy === row.provider}
        onClick={() => {
          void act(row.provider, async () => {
            const done = await (onConnect?.(row.provider) ??
              Promise.resolve({ ok: true as const, url: null }));
            if (done.ok && done.url !== null) onLeave(done.url);
            return done.ok ? { ok: true } : done;
          });
        }}
      >
        Connect
      </Button>
    ) : null;
    return (
      <ListItem
        key={row.provider}
        description={
          row.connected
            ? [row.account, row.connectedAt === null ? null : `Since ${shortDay(row.connectedAt)}`]
                .filter(Boolean)
                .join(' · ')
            : !row.available
              ? row.provider === 'teams'
                ? 'Follows Slack'
                : undefined
              : !row.configured
                ? 'Kithena’s app for it has not been set up yet'
                : undefined
        }
        trailing={
          <span className="flex items-center gap-3">
            <Badge size="sm" tone={status.tone} dot={row.connected}>
              {status.label}
            </Badge>
            {action}
          </span>
        }
      >
        {PRODUCT[row.provider]}
      </ListItem>
    );
  };

  const calendars = data.integrations.filter((i) => i.kind === 'calendar');
  const chats = data.integrations.filter((i) => i.kind === 'chat');

  return (
    <>
      {connected === undefined ? null : (
        <Alert tone="success" title={`${productOf(connected)} is connected`} />
      )}
      {refused === undefined ? null : (
        <Alert tone="warning" title={`${productOf(refused)} was not connected`}>
          Access was not granted on its page. Try again, or ask whoever administers it.
        </Alert>
      )}
      {problem === null ? null : (
        <Alert tone="danger" title="That did not work">
          {problem}
        </Alert>
      )}
      <div className={columns}>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection
            title="Calendar"
            description="Approved time off appears as out of office. Holidays appear for each location."
          >
            <List aria-label="Calendars">{calendars.map(providerRow)}</List>
          </PageSection>
          <PageSection
            title="Chat apps"
            description="A status while someone is away, and approving a request from the message that asks."
          >
            <List aria-label="Chat apps">{chats.map(providerRow)}</List>
            <Field orientation="horizontal" className="items-start justify-between gap-4">
              <div>
                <FieldLabel>Name people on private leave in chat answers</FieldLabel>
                <FieldDescription>
                  Off, a chat answer about sick or parental leave gives a count and a link to the
                  calendar. On, it names the people, and so health data is stored by your chat
                  provider under your company’s own retention, not Kithena’s. Nobody sees more than
                  the calendar already shows them.
                </FieldDescription>
              </div>
              <FieldControl>
                <Switch
                  checked={naming}
                  disabled={busy === 'chat-answers'}
                  onCheckedChange={(on) => {
                    setNaming(on);
                    void act('chat-answers', async () => {
                      const done = await (onChatAnswers?.({ namesPrivateLeave: on }) ??
                        Promise.resolve({ ok: true as const }));
                      if (!done.ok) setNaming(!on);
                      return done;
                    });
                  }}
                />
              </FieldControl>
            </Field>
          </PageSection>
          <Kiosks
            data={data}
            busy={busy}
            onRegister={onRegisterKiosk}
            onRevoke={(id) => {
              void act(`kiosk-${id}`, () => onRevokeKiosk?.(id) ?? Promise.resolve({ ok: true }));
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection
            title="Official holiday calendars"
            description="National and regional holidays, from each country’s official sources. A country is used only once a lawyer has reviewed it."
          >
            <List aria-label="Countries">
              {data.packs.map((p) => (
                <ListItem
                  key={p.country}
                  icon={icon('calendar')}
                  description={p.inUse ? 'In use' : undefined}
                  trailing={
                    <Badge size="sm" tone={p.reviewed ? 'success' : 'warning'}>
                      {p.reviewed ? 'Reviewed' : 'Not reviewed yet'}
                    </Badge>
                  }
                >
                  {region.of(p.country) ?? p.country}
                </ListItem>
              ))}
            </List>
          </PageSection>
          <PageSection
            title="Other Kithena modules"
            description="What they would read from Time Off once they exist."
          >
            <List aria-label="Kithena modules">
              {data.modules.map((m) => {
                const known = MODULE[m.key];
                return (
                  <ListItem
                    key={m.key}
                    icon={icon(known?.icon ?? 'system')}
                    description={known?.does}
                    trailing={
                      <Badge size="sm" tone="accent">
                        Kithena module
                      </Badge>
                    }
                  >
                    {known?.name ?? m.key}
                  </ListItem>
                );
              })}
            </List>
          </PageSection>
        </div>
      </div>
    </>
  );
}

function Kiosks({
  data,
  busy,
  onRegister,
  onRevoke,
}: {
  readonly data: IntegrationsData;
  readonly busy: string | null;
  readonly onRegister: IntegrationsProps['onRegisterKiosk'];
  readonly onRevoke: (deviceId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [locationKey, setLocationKey] = useState(data.locations[0]?.locationKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<{ deviceId: string; token: string } | null>(null);
  const live = data.kiosks.filter((k) => k.revokedAt === null);
  const link =
    registered === null
      ? ''
      : `${typeof window === 'undefined' ? '' : window.location.origin}/kiosk/${registered.deviceId}#token=${registered.token}`;

  return (
    <PageSection
      title="Kiosks"
      description="Tablets at the door. People clock in with a badge, a PIN or the code on their phone; a kiosk shows a first name and nothing else."
      actions={
        <Button
          size="sm"
          startIcon={icon('add')}
          disabled={data.locations.length === 0}
          onClick={() => {
            setRegistered(null);
            setError(null);
            setName('');
            setOpen(true);
          }}
        >
          Add a kiosk
        </Button>
      }
    >
      {live.length === 0 ? (
        <p className="text-sm text-fg-muted">No kiosks yet.</p>
      ) : (
        <List aria-label="Kiosks">
          {live.map((k) => (
            <ListItem
              key={k.id}
              icon={icon('tap')}
              description={[
                placeName(k.locationKey),
                k.lastSeenAt === null ? 'Not used yet' : `Last seen ${shortDay(k.lastSeenAt)}`,
              ].join(' · ')}
              trailing={
                <Button
                  size="sm"
                  loading={busy === `kiosk-${k.id}`}
                  onClick={() => {
                    onRevoke(k.id);
                  }}
                >
                  Revoke
                </Button>
              }
            >
              {k.name}
            </ListItem>
          ))}
        </List>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {registered === null ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim() === '' || locationKey === '' || onRegister === undefined) return;
                setSaving(true);
                void onRegister({ name: name.trim(), locationKey }).then((done) => {
                  setSaving(false);
                  if (done.ok) setRegistered({ deviceId: done.deviceId, token: done.token });
                  else setError(done.message);
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>Add a kiosk</DialogTitle>
                <DialogDescription>
                  Its link is shown once. Open it on the tablet and it remembers itself.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <FieldControl>
                    <Input
                      value={name}
                      placeholder="Main entrance"
                      onChange={(event) => {
                        setName(event.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>Location</FieldLabel>
                  <Select value={locationKey} onValueChange={setLocationKey}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {data.locations.map((l) => (
                        <SelectItem key={l.locationKey} value={l.locationKey}>
                          {l.name ?? placeName(l.locationKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {error === null ? null : (
                  <Alert tone="danger" title="The kiosk was not added">
                    {error}
                  </Alert>
                )}
              </DialogBody>
              <DialogFooter>
                <Button type="submit" variant="primary" loading={saving}>
                  Add kiosk
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Open this on the tablet</DialogTitle>
                <DialogDescription>
                  This link holds the kiosk’s key and is not shown again. Revoke the kiosk if it
                  leaks.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <CopyField label="Kiosk link" value={link} mono />
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="primary"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}

export function IntegrationsSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title={TITLE}
      description={DESCRIPTION}
      container="@container/integrations"
      columns={columns}
      main={['h-40', 'h-40', 'h-32']}
      side={['h-48', 'h-56']}
    />
  );
}
