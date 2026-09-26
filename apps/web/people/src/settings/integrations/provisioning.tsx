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

import type { Outcome } from '../../load';

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
}

/** A path as a person reads it: the extension's name dropped. */
const pathLabel = (path: string, extension: string) =>
  path.startsWith(`${extension}:`) ? `People: ${path.slice(extension.length + 1)}` : path;

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
  const [connecting, setConnecting] = useState(false);
  const [token, setToken] = useState<{ system: string; value: string } | null>(null);

  return (
    <PageSection
      title="Provisioning (SCIM)"
      description="Let your identity provider or HRIS create and update people. The fields you map are kept there."
      actions={
        <Button
          onClick={() => {
            setConnecting(true);
          }}
        >
          Connect a system
        </Button>
      }
    >
      <Stack gap={4}>
        {scim.url === '' ? null : <CopyField value={scim.url} label="Copy the SCIM base URL" />}
        {token === null ? null : (
          <Alert tone="warning" title="Copy the token now">
            <Stack gap={2}>
              <p>
                This is the only time the token for {token.system} is shown. Paste it into{' '}
                {token.system} as the bearer token. If it is lost, rotate it.
              </p>
              <CopyField value={token.value} label="Copy the SCIM token" />
            </Stack>
          </Alert>
        )}
        {scim.connections.length === 0 ? (
          <EmptyState
            title="No systems connected"
            description="Connect Okta, Entra or your HRIS to provision people into People."
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
        `${String(connection.linked)} people provisioned`,
        `connected ${connection.createdAt.slice(0, 10)}`,
        connection.tokenRotatedAt === null
          ? null
          : `token rotated ${connection.tokenRotatedAt.slice(0, 10)}`,
      ]
        .filter((x) => x !== null)
        .join(' · ')}
      actions={
        <Badge tone={live ? 'success' : 'neutral'}>{live ? 'Connected' : 'Disconnected'}</Badge>
      }
    >
      <Stack gap={4}>
        {mapping.length === 0 ? (
          <p className="text-fg-muted text-sm">
            Nothing is mapped yet: {connection.system} can create people, and keeps none of their
            fields.
          </p>
        ) : (
          <Table aria-label={`Fields kept in ${connection.system}`}>
            <TableHeader>
              <TableRow>
                <TableHead>SCIM attribute</TableHead>
                <TableHead>Field, kept in {connection.system}</TableHead>
                {live ? <TableHead>Change</TableHead> : null}
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
                        aria-label={`Stop keeping ${labelOf.get(m.key) ?? m.key} in ${connection.system}`}
                        onClick={() => {
                          setMapping(mapping.filter((x) => x.path !== m.path));
                        }}
                      >
                        Remove
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
              <FieldLabel>SCIM attribute</FieldLabel>
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
                    <SelectValue placeholder="Choose an attribute" />
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
              <FieldLabel>Field</FieldLabel>
              <Select value={key} disabled={extensionKey !== null} onValueChange={setKey}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a field" />
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
              Add to mapping
            </Button>
          </div>
        ) : null}
        {changed ? (
          <Alert tone="info">
            Saving makes every mapped field read-only in People for the people {connection.system}{' '}
            provisions. HR, managers and employees change them in {connection.system}.
          </Alert>
        ) : null}
        {refused === null ? null : (
          <Alert tone="danger" title="Not saved">
            {refused}
          </Alert>
        )}
        {live ? (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              disabled={!changed}
              loading={busy}
              loadingLabel="Saving"
              onClick={() => {
                void attempt(() => onSetMapping(connection.id, mapping));
              }}
            >
              Save mapping
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void attempt(onRotate);
              }}
            >
              Rotate token
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void attempt(() => onDisconnect(connection.id));
              }}
            >
              Disconnect
            </Button>
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
          <DialogTitle>Connect a system</DialogTitle>
          <DialogDescription>
            The token is shown once, after this. Nothing is kept there until you map it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required>
              <FieldLabel>System</FieldLabel>
              <FieldControl>
                <Input
                  value={system}
                  maxLength={80}
                  onChange={(e) => {
                    setSystem(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                What your people know it as — Okta, Entra, Workday. A field kept there says so.
              </FieldDescription>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not connected">
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
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={system.trim() === ''}
            loading={busy}
            loadingLabel="Connecting"
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
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
