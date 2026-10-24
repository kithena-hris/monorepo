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
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useHeld } from '../../held';
import type { Outcome } from '../../load';
import { t } from '../../i18n';

/** One SCIM path and the attribute it keeps upstream (PEO-073). */
export interface MappingEntry {
  readonly path: string;
  readonly key: string;
}

export interface ScimConnection {
  readonly id: string;
  /** What the tenant calls it: "Okta", "Workday". */
  readonly system: string;
  readonly createdAt: string;
  readonly tokenRotatedAt: string | null;
  readonly revokedAt: string | null;
  /** How many people it provisions. */
  readonly linked: number;
  readonly mapping: readonly MappingEntry[];
}

export interface ScimState {
  /** The SCIM base URL to give the provider. */
  readonly url: string;
  /** Core SCIM paths a mapping may name. */
  readonly paths: readonly string[];
  /** A tenant attribute is mapped as `<extension>:<key>`. */
  readonly extension: string;
  /** Attributes an upstream system may be the source of record for. */
  readonly mappable: readonly { readonly key: string; readonly label: string }[];
  readonly connections: readonly ScimConnection[];
}

/** A token is shown once, here, and is never retrievable again. */
export type WithToken =
  { readonly ok: true; readonly token: string } | { readonly ok: false; readonly message: string };

export interface ProvisioningProps {
  readonly scim: ScimState;
  readonly onConnect: (system: string) => Promise<WithToken>;
  readonly onRotateToken: (id: string) => Promise<WithToken>;
  readonly onDisconnect: (id: string) => Promise<Outcome>;
  readonly onSetMapping: (id: string, mapping: readonly MappingEntry[]) => Promise<Outcome>;
  /** Connect a system is open, held by the host (in its address). */
  readonly connecting?: boolean;
  readonly onConnectingChange?: (open: boolean) => void;
}

/** A path as a person reads it: the extension's name dropped. */
const pathLabel = (path: string, extension: string) =>
  path.startsWith(`${extension}:`)
    ? t('settings.integrations.provisioning.people_path', 'People: {{path}}', {
        path: path.slice(extension.length + 1),
      })
    : path;

/**
 * Provisioning from an upstream system over SCIM (PRD §13.5, §13.6).
 *
 * Each connection is a system, its token and its approved mapping. The
 * mapping is also the declaration of mirror mode: every field it names is
 * kept in that system, read-only here for everybody on the people it
 * provisions — the table says so in those words before anybody saves it.
 */
export function Provisioning(props: ProvisioningProps): JSX.Element {
  const { scim } = props;
  const [connecting, setConnecting] = useHeld(props.connecting, props.onConnectingChange, false);
  const [token, setToken] = useState<{ system: string; value: string } | null>(null);

  return (
    <PageSection
      title={t(
        'settings.integrations.provisioning.provisioning_from_your_identity_provider_scim',
        'Provisioning from your identity provider (SCIM)',
      )}
      description={t(
        'settings.integrations.provisioning.add_and_remove_people_automatically_from',
        'Add and remove people automatically from Okta, Microsoft Entra or another system. Mapped fields become read-only here.',
      )}
      actions={
        <Button
          onClick={() => {
            setConnecting(true);
          }}
        >
          {t('settings.integrations.provisioning.connect_a_system', 'Connect a system')}
        </Button>
      }
    >
      <Stack gap={4}>
        {scim.url === '' ? null : (
          <CopyField
            value={scim.url}
            label={t(
              'settings.integrations.provisioning.copy_the_scim_base_url',
              'Copy the SCIM base URL',
            )}
          />
        )}
        {token === null ? null : (
          <Alert
            tone="warning"
            title={t('settings.integrations.provisioning.copy_the_token_now', 'Copy the token now')}
          >
            <Stack gap={2}>
              <p>
                {t(
                  'settings.integrations.provisioning.this_is_the_only_time_the',
                  'This is the only time the token for {{system}} is shown. Paste it into {{system2}} as the bearer token. If it is lost, rotate it.',
                  { system: token.system, system2: token.system },
                )}
              </p>
              <CopyField
                value={token.value}
                label={t(
                  'settings.integrations.provisioning.copy_the_scim_token',
                  'Copy the SCIM token',
                )}
              />
            </Stack>
          </Alert>
        )}
        {scim.connections.length === 0 ? (
          <EmptyState
            title={t(
              'settings.integrations.provisioning.no_systems_connected',
              'No systems connected',
            )}
            description={t(
              'settings.integrations.provisioning.connect_okta_entra_or_your_hris',
              'Connect Okta, Entra or your HRIS to provision people into People.',
            )}
          />
        ) : (
          scim.connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              scim={scim}
              onSetMapping={props.onSetMapping}
              onDisconnect={props.onDisconnect}
              onRotate={async () => {
                const rotated = await props.onRotateToken(connection.id);
                if (rotated.ok) setToken({ system: connection.system, value: rotated.token });
                return rotated.ok ? { ok: true } : rotated;
              }}
            />
          ))
        )}
      </Stack>
      <Connect
        open={connecting}
        onOpenChange={setConnecting}
        onConnect={async (system) => {
          const made = await props.onConnect(system);
          if (made.ok) setToken({ system, value: made.token });
          return made.ok ? { ok: true } : made;
        }}
      />
    </PageSection>
  );
}

function ConnectionCard({
  connection,
  scim,
  onSetMapping,
  onDisconnect,
  onRotate,
}: {
  readonly connection: ScimConnection;
  readonly scim: ScimState;
  readonly onSetMapping: ProvisioningProps['onSetMapping'];
  readonly onDisconnect: ProvisioningProps['onDisconnect'];
  readonly onRotate: () => Promise<Outcome>;
}): JSX.Element {
  const [mapping, setMapping] = useState<readonly MappingEntry[]>(connection.mapping);
  const [path, setPath] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const live = connection.revokedAt === null;
  const labelOf = new Map(scim.mappable.map((a) => [a.key, a.label]));
  const changed = JSON.stringify(mapping) !== JSON.stringify(connection.mapping);
  const usedPaths = new Set(mapping.map((m) => m.path));
  const usedKeys = new Set(mapping.map((m) => m.key));
  const paths = [...scim.paths, ...scim.mappable.map((a) => `${scim.extension}:${a.key}`)].filter(
    (p) => !usedPaths.has(p),
  );
  const extensionKey = path.startsWith(`${scim.extension}:`)
    ? path.slice(scim.extension.length + 1)
    : null;

  const attempt = async (run: () => Promise<Outcome>): Promise<void> => {
    setBusy(true);
    setRefused(null);
    const outcome = await run();
    setBusy(false);
    if (!outcome.ok) setRefused(outcome.message);
  };

  return (
    <PageSection
      surface
      aria-label={connection.system}
      title={connection.system}
      description={[
        t(
          'settings.integrations.provisioning.people_provisioned',
          '{{linked}} people provisioned',
          { linked: String(connection.linked) },
        ),
        t('settings.integrations.provisioning.connected', 'connected {{slice}}', {
          slice: connection.createdAt.slice(0, 10),
        }),
        connection.tokenRotatedAt === null
          ? null
          : t('settings.integrations.provisioning.token_rotated', 'token rotated {{slice}}', {
              slice: connection.tokenRotatedAt.slice(0, 10),
            }),
      ]
        .filter((x) => x !== null)
        .join(' · ')}
      actions={
        <Badge tone={live ? 'success' : 'neutral'}>
          {live
            ? t('settings.integrations.provisioning.connected_2', 'Connected')
            : t('settings.integrations.provisioning.disconnected', 'Disconnected')}
        </Badge>
      }
    >
      <Stack gap={4}>
        {mapping.length === 0 ? (
          <p className="text-fg-muted text-sm">
            {t(
              'settings.integrations.provisioning.nothing_is_mapped_yet_can_create',
              'Nothing is mapped yet: {{system}} can create people, and keeps none of their fields.',
              { system: connection.system },
            )}
          </p>
        ) : (
          <Table
            aria-label={t(
              'settings.integrations.provisioning.fields_kept_in',
              'Fields kept in {{system}}',
              { system: connection.system },
            )}
          >
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('settings.integrations.provisioning.scim_attribute', 'SCIM attribute')}
                </TableHead>
                <TableHead>
                  {t('settings.integrations.provisioning.field_kept_in', 'Field, kept in')}{' '}
                  {connection.system}
                </TableHead>
                {live ? (
                  <TableHead>{t('settings.integrations.provisioning.change', 'Change')}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {mapping.map((m) => (
                <TableRow key={m.path}>
                  <TableCell>
                    <span className="font-mono text-sm break-all">
                      {pathLabel(m.path, scim.extension)}
                    </span>
                  </TableCell>
                  <TableCell>{labelOf.get(m.key) ?? m.key}</TableCell>
                  {live ? (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t(
                          'settings.integrations.provisioning.stop_keeping_in',
                          'Stop keeping {{value}} in {{system}}',
                          { value: labelOf.get(m.key) ?? m.key, system: connection.system },
                        )}
                        onClick={() => {
                          setMapping(mapping.filter((x) => x.path !== m.path));
                        }}
                      >
                        {t('settings.integrations.provisioning.remove', 'Remove')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {live ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field>
              <FieldLabel>
                {t('settings.integrations.provisioning.scim_attribute', 'SCIM attribute')}
              </FieldLabel>
              <Select
                value={path}
                onValueChange={(value) => {
                  setPath(value);
                  const own = value.startsWith(`${scim.extension}:`)
                    ? value.slice(scim.extension.length + 1)
                    : null;
                  if (own !== null) setKey(own);
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        'settings.integrations.provisioning.choose_an_attribute',
                        'Choose an attribute',
                      )}
                    />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {paths.map((p) => (
                    <SelectItem key={p} value={p}>
                      {pathLabel(p, scim.extension)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field disabled={extensionKey !== null}>
              <FieldLabel>{t('settings.integrations.provisioning.field', 'Field')}</FieldLabel>
              <Select value={key} disabled={extensionKey !== null} onValueChange={setKey}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        'settings.integrations.provisioning.choose_a_field',
                        'Choose a field',
                      )}
                    />
                  </SelectTrigger>
                </FieldControl>
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
              onClick={() => {
                setMapping([...mapping, { path, key }]);
                setPath('');
                setKey('');
              }}
            >
              {t('settings.integrations.provisioning.add_to_mapping', 'Add to mapping')}
            </Button>
          </div>
        ) : null}
        {changed ? (
          <Alert tone="info">
            {t(
              'settings.integrations.provisioning.saving_makes_every_mapped_field_read',
              'Saving makes every mapped field read-only in People for the people {{system}} provisions. HR, managers and employees change them in',
              { system: connection.system },
            )}{' '}
            {connection.system}.
          </Alert>
        ) : null}
        {refused === null ? null : (
          <Alert
            tone="danger"
            title={t('settings.integrations.provisioning.not_saved', 'Not saved')}
          >
            {refused}
          </Alert>
        )}
        {live ? (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              disabled={!changed}
              loading={busy}
              loadingLabel={t('settings.integrations.provisioning.saving', 'Saving')}
              onClick={() => {
                void attempt(() => onSetMapping(connection.id, mapping));
              }}
            >
              {t('settings.integrations.provisioning.save_mapping', 'Save mapping')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void attempt(onRotate);
              }}
            >
              {t('settings.integrations.provisioning.rotate_token', 'Rotate token')}
            </Button>
            {/* Asked first: a disconnected system cannot be connected again with its old token. */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="danger-soft" disabled={busy} className="ms-auto">
                  {t('settings.integrations.provisioning.disconnect', 'Disconnect')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  {t('settings.integrations.provisioning.disconnect_2', 'Disconnect {{system}}?', {
                    system: connection.system,
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    'settings.integrations.provisioning.its_token_stops_working_and_it',
                    'Its token stops working, and it no longer adds or removes people here. To provision from it again, connect it as a new system.',
                  )}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button>
                      {t(
                        'settings.integrations.provisioning.keep_it_connected',
                        'Keep it connected',
                      )}
                    </Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        void attempt(() => onDisconnect(connection.id));
                      }}
                    >
                      {t('settings.integrations.provisioning.disconnect', 'Disconnect')}
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </Stack>
    </PageSection>
  );
}

function Connect({
  open,
  onOpenChange,
  onConnect,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConnect: (system: string) => Promise<Outcome>;
}): JSX.Element {
  const [system, setSystem] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('settings.integrations.provisioning.connect_a_system', 'Connect a system')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.integrations.provisioning.paste_the_address_and_token_into',
              'Paste the address and token into the tool’s SCIM settings. The token is shown once.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required>
              <FieldLabel>{t('settings.integrations.provisioning.system', 'System')}</FieldLabel>
              <FieldControl>
                <Input
                  value={system}
                  maxLength={80}
                  placeholder={t('settings.integrations.provisioning.okta', 'Okta')}
                  onChange={(e) => {
                    setSystem(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t(
                  'settings.integrations.provisioning.for_example_okta_microsoft_entra_or',
                  'For example Okta, Microsoft Entra or Workday.',
                )}
              </FieldDescription>
            </Field>
            {refused === null ? null : (
              <Alert
                tone="danger"
                title={t('settings.integrations.provisioning.not_connected', 'Not connected')}
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
            {t('settings.integrations.provisioning.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={system.trim() === ''}
            loading={busy}
            loadingLabel={t('settings.integrations.provisioning.connecting', 'Connecting')}
            onClick={() => {
              void (async () => {
                setBusy(true);
                const outcome = await onConnect(system.trim());
                setBusy(false);
                if (outcome.ok) {
                  setSystem('');
                  setRefused(null);
                  onOpenChange(false);
                } else setRefused(outcome.message);
              })();
            }}
          >
            {t('settings.integrations.provisioning.connect', 'Connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
