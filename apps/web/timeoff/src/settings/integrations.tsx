import {
  Alert,
  Badge,
  Button,
  CopyField,
  dateFormat,
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
  type IconName,
  icons,
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
} from '@reach/ui';
import { createElement, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { SettingsSkeleton, placeName } from './shared';
import { t } from '../i18n';

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

const TITLE = (): string => t('settings.integrations.integrations', 'Integrations');
const DESCRIPTION = (): string =>
  t(
    'settings.integrations.where_time_off_and_attendance_show_up',
    'Where time off and attendance show up outside this module.',
  );
const page = '@container/integrations flex flex-col gap-6';
// One column: settings read top to bottom, one setting per row.
const columns = 'flex max-w-4xl flex-col gap-6';

const icon = (name: IconName): ReactNode => createElement(icons[name], { 'aria-hidden': true });

/** A vendor's name, on its own row only. */
const PRODUCT: Record<Provider, string> = {
  get google(): string {
    return t('settings.integrations.google_calendar', 'Google Calendar');
  },
  get microsoft(): string {
    return t('settings.integrations.microsoft_outlook', 'Microsoft Outlook');
  },
  get slack(): string {
    return t('settings.integrations.slack', 'Slack');
  },
  get teams(): string {
    return t('settings.integrations.microsoft_teams', 'Microsoft Teams');
  },
};

/** A provider named in the address, which anyone can type. */
const productOf = (provider: string): string =>
  provider in PRODUCT ? PRODUCT[provider as Provider] : provider;

const MODULE = (): Record<string, { name: string; icon: IconName; does: string }> => ({
  payroll: {
    name: t('settings.integrations.payroll', 'Payroll'),
    icon: 'payroll',
    get does(): string {
      return t(
        'settings.integrations.overtime_unpaid_leave_negative_balances_and',
        'Overtime, unpaid leave, negative balances and parental pay changes each month.',
      );
    },
  },
  benefits: {
    name: t('settings.integrations.benefits', 'Benefits'),
    icon: 'health',
    get does(): string {
      return t(
        'settings.integrations.adds_dependents_after_a_birth_and',
        'Adds dependents after a birth and pauses benefits during unpaid leave.',
      );
    },
  },
  projects: {
    name: t('settings.integrations.projects', 'Projects'),
    icon: 'cards',
    get does(): string {
      return t(
        'settings.integrations.deadlines_and_owners_for_clash_checks',
        'Deadlines and owners for clash checks and handover suggestions.',
      );
    },
  },
});

const region = new Intl.DisplayNames(['en'], { type: 'region' });

const shortDay = (iso: string): string =>
  dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));

export function Integrations(props: IntegrationsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <IntegrationsSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE()} description={DESCRIPTION()} />
      <Loaded load={load} what={t('settings.integrations.the_integrations', 'the integrations')}>
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
      ? { tone: 'success' as const, label: t('settings.integrations.connected', 'Connected') }
      : !row.available
        ? {
            tone: 'neutral' as const,
            label: t('settings.integrations.not_available_yet', 'Not available yet'),
          }
        : !row.configured
          ? {
              tone: 'warning' as const,
              label: t('settings.integrations.needs_credentials', 'Needs credentials'),
            }
          : {
              tone: 'neutral' as const,
              label: t('settings.integrations.not_connected', 'Not connected'),
            };
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
        {t('settings.integrations.disconnect', 'Disconnect')}
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
        {t('settings.integrations.connect', 'Connect')}
      </Button>
    ) : null;
    return (
      <ListItem
        key={row.provider}
        description={
          row.connected
            ? [
                row.account,
                row.connectedAt === null
                  ? null
                  : t('settings.integrations.since', 'Since {{shortDay}}', {
                      shortDay: shortDay(row.connectedAt),
                    }),
              ]
                .filter(Boolean)
                .join(' · ')
            : !row.available
              ? row.provider === 'teams'
                ? t('settings.integrations.follows_slack', 'Follows Slack')
                : undefined
              : !row.configured
                ? t(
                    'settings.integrations.kithenas_app_for_it_has_not',
                    'Kithena’s app for it has not been set up yet',
                  )
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
        <Alert
          tone="success"
          title={t('settings.integrations.is_connected', '{{productOf}} is connected', {
            productOf: productOf(connected),
          })}
        />
      )}
      {refused === undefined ? null : (
        <Alert
          tone="warning"
          title={t('settings.integrations.was_not_connected', '{{productOf}} was not connected', {
            productOf: productOf(refused),
          })}
        >
          {t(
            'settings.integrations.access_was_not_granted_on_its',
            'Access was not granted on its page. Try again, or ask whoever administers it.',
          )}
        </Alert>
      )}
      {problem === null ? null : (
        <Alert
          tone="danger"
          title={t('settings.integrations.that_did_not_work', 'That did not work')}
        >
          {problem}
        </Alert>
      )}
      <div className={columns}>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection
            title={t('settings.integrations.calendar', 'Calendar')}
            description={t(
              'settings.integrations.approved_time_off_appears_as_out',
              'Approved time off appears as out of office. Holidays appear for each location.',
            )}
          >
            <List aria-label={t('settings.integrations.calendars', 'Calendars')}>
              {calendars.map(providerRow)}
            </List>
          </PageSection>
          <PageSection
            title={t('settings.integrations.chat_apps', 'Chat apps')}
            description={t(
              'settings.integrations.a_status_while_someone_is_away',
              'A status while someone is away, and approving a request from the message that asks.',
            )}
          >
            <List aria-label={t('settings.integrations.chat_apps', 'Chat apps')}>
              {chats.map(providerRow)}
            </List>
            <Field orientation="horizontal" className="items-start justify-between gap-4">
              <div>
                <FieldLabel>
                  {t(
                    'settings.integrations.name_people_on_private_leave_in',
                    'Name people on private leave in chat answers',
                  )}
                </FieldLabel>
                <FieldDescription>
                  {t(
                    'settings.integrations.off_a_chat_answer_about_sick',
                    'Off, a chat answer about sick or parental leave gives a count and a link to the calendar. On, it names the people, and so health data is stored by your chat provider under your company’s own retention, not Kithena’s. Nobody sees more than the calendar already shows them.',
                  )}
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
            title={t(
              'settings.integrations.official_holiday_calendars',
              'Official holiday calendars',
            )}
            description={t(
              'settings.integrations.national_and_regional_holidays_from_each',
              'National and regional holidays, from each country’s official sources. A country is used only once a lawyer has reviewed it.',
            )}
          >
            <List aria-label={t('settings.integrations.countries', 'Countries')}>
              {data.packs.map((p) => (
                <ListItem
                  key={p.country}
                  icon={icon('calendar')}
                  description={p.inUse ? t('settings.integrations.in_use', 'In use') : undefined}
                  trailing={
                    <Badge size="sm" tone={p.reviewed ? 'success' : 'warning'}>
                      {p.reviewed
                        ? t('settings.integrations.reviewed', 'Reviewed')
                        : t('settings.integrations.not_reviewed_yet', 'Not reviewed yet')}
                    </Badge>
                  }
                >
                  {region.of(p.country) ?? p.country}
                </ListItem>
              ))}
            </List>
          </PageSection>
          <PageSection
            title={t('settings.integrations.other_kithena_modules', 'Other Kithena modules')}
            description={t(
              'settings.integrations.what_they_would_read_from_time',
              'What they would read from Time Off once they exist.',
            )}
          >
            <List aria-label={t('settings.integrations.kithena_modules', 'Kithena modules')}>
              {data.modules.map((m) => {
                const known = MODULE()[m.key];
                return (
                  <ListItem
                    key={m.key}
                    icon={icon(known?.icon ?? 'system')}
                    description={known?.does}
                    trailing={
                      <Badge size="sm" tone="accent">
                        {t('settings.integrations.kithena_module', 'Kithena module')}
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
      title={t('settings.integrations.kiosks', 'Kiosks')}
      description={t(
        'settings.integrations.tablets_at_the_door_people_clock',
        'Tablets at the door. People clock in with a badge, a PIN or the code on their phone; a kiosk shows a first name and nothing else.',
      )}
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
          {t('settings.integrations.add_a_kiosk', 'Add a kiosk')}
        </Button>
      }
    >
      {live.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {t('settings.integrations.no_kiosks_yet', 'No kiosks yet.')}
        </p>
      ) : (
        <List aria-label={t('settings.integrations.kiosks', 'Kiosks')}>
          {live.map((k) => (
            <ListItem
              key={k.id}
              icon={icon('tap')}
              description={[
                placeName(k.locationKey),
                k.lastSeenAt === null
                  ? t('settings.integrations.not_used_yet', 'Not used yet')
                  : t('settings.integrations.last_seen', 'Last seen {{shortDay}}', {
                      shortDay: shortDay(k.lastSeenAt),
                    }),
              ].join(' · ')}
              trailing={
                <Button
                  size="sm"
                  loading={busy === `kiosk-${k.id}`}
                  onClick={() => {
                    onRevoke(k.id);
                  }}
                >
                  {t('settings.integrations.revoke', 'Revoke')}
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
                <DialogTitle>{t('settings.integrations.add_a_kiosk', 'Add a kiosk')}</DialogTitle>
                <DialogDescription>
                  {t(
                    'settings.integrations.its_link_is_shown_once_open',
                    'Its link is shown once. Open it on the tablet and it remembers itself.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <Field>
                  <FieldLabel>{t('settings.integrations.name', 'Name')}</FieldLabel>
                  <FieldControl>
                    <Input
                      value={name}
                      placeholder={t('settings.integrations.main_entrance', 'Main entrance')}
                      onChange={(event) => {
                        setName(event.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
                <Field>
                  <FieldLabel>{t('settings.integrations.location', 'Location')}</FieldLabel>
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
                  <Alert
                    tone="danger"
                    title={t(
                      'settings.integrations.the_kiosk_was_not_added',
                      'The kiosk was not added',
                    )}
                  >
                    {error}
                  </Alert>
                )}
              </DialogBody>
              <DialogFooter>
                <Button type="submit" variant="primary" loading={saving}>
                  {t('settings.integrations.add_kiosk', 'Add kiosk')}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('settings.integrations.open_this_on_the_tablet', 'Open this on the tablet')}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    'settings.integrations.this_link_holds_the_kiosks_key',
                    'This link holds the kiosk’s key and is not shown again. Revoke the kiosk if it leaks.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <CopyField
                  label={t('settings.integrations.kiosk_link', 'Kiosk link')}
                  value={link}
                  mono
                />
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="primary"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  {t('settings.integrations.done', 'Done')}
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
      title={TITLE()}
      description={DESCRIPTION()}
      container="@container/integrations"
      columns={columns}
      main={['h-40', 'h-40', 'h-32']}
      side={['h-48', 'h-56']}
    />
  );
}
