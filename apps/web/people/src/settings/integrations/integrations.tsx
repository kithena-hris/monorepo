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
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  PageSection,
  Stack,
  Switch,
  Combobox,
  type ComboboxOption,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../../load';
import { Provisioning, type ProvisioningProps, type ScimState } from './provisioning';

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
  /**
   * The company's other Kithena modules, by name: connected to People on its
   * event stream already, with nothing to set up. Absent: none named.
   */
  readonly builtIn?: readonly string[];
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
    <Loaded load={props.load} what="the integrations">
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
      group: e.split('.')[1] === 'person' ? 'A person' : 'The company',
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
        ? `${f.key} · special-category data, never sent`
        : f.refused === 'encrypted'
          ? `${f.key} · encrypted, never sent`
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
          placeholder={value.length === 0 ? 'Choose' : `${String(value.length)} chosen`}
          searchPlaceholder="Search"
          emptyMessage="Nothing by that name."
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
  builtIn = [],
}: IntegrationsProps & { readonly state: IntegrationsState }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);
  const refusedLabels = state.fields.filter((f) => f.refused !== null).map((f) => f.key);

  return (
    <Stack gap={6}>
      <PageHeader
        title="Integrations"
        description="Connect People to third-party tools. Kithena’s own modules are connected already."
      />
      <PageSection
        title="Built into Kithena"
        description="Your other Kithena modules receive People’s changes as they happen, with nothing to set up and nothing to maintain."
      >
        {builtIn.length === 0 ? (
          <p className="text-sm text-fg-muted">
            When your company adds another Kithena module, such as Time off, it is connected here
            automatically.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {builtIn.map((name) => (
              <li key={name} className="flex items-center gap-3 text-sm">
                <span className="font-medium text-fg">{name}</span>
                <Badge tone="success" size="sm">
                  Connected
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection
        title="Webhooks to third-party tools"
        description={`Payroll, benefits, IT or a data warehouse: each endpoint is told about the events you choose, carrying only the fields you allow. ${String(state.endpoints.length)} ${state.endpoints.length === 1 ? 'endpoint' : 'endpoints'} · ${state.deliveries24h.toLocaleString()} deliveries in the last day · schema version ${String(state.schemaVersion)}.`}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add endpoint
          </Button>
        }
      >
        <Stack gap={4}>
          {secret === null ? null : (
            <Alert tone="warning" title="Copy the signing secret now">
              <Stack gap={2}>
                <p>
                  This is the only time it is shown for {secret.url}. It cannot be retrieved later;
                  if it is lost, rotate it.
                </p>
                <CopyField value={secret.value} label="Copy the signing secret" />
              </Stack>
            </Alert>
          )}
          {state.endpoints.length === 0 ? (
            <EmptyState
              title="No third-party tools connected"
              description="Add the address a tool gives you for incoming webhooks. Kithena addresses are not needed here: its own modules are connected already."
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
      {state.scim === undefined || scim === undefined ? null : (
        <Provisioning scim={state.scim} {...scim} />
      )}
      <AddEndpoint
        open={adding}
        onOpenChange={setAdding}
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
    ? { tone: 'neutral', text: 'Disabled' }
    : endpoint.retrying > 0
      ? { tone: 'warning', text: `${String(endpoint.retrying)} retrying` }
      : { tone: 'success', text: 'Healthy' };

  return (
    <PageSection
      surface
      aria-label={endpoint.url}
      title={<span className="font-mono text-sm break-all">{endpoint.url}</span>}
      description={
        [
          endpoint.secretRotated === null
            ? null
            : `Signing secret rotated ${endpoint.secretRotated}`,
          endpoint.lastDelivery === null ? null : `last delivery ${endpoint.lastDelivery}`,
        ]
          .filter((x) => x !== null)
          .join(' · ') || undefined
      }
      actions={
        <span className="flex items-center gap-3">
          <Badge tone={health.tone}>{health.text}</Badge>
          <Field orientation="horizontal">
            <FieldLabel>Enabled</FieldLabel>
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
          label="Events"
          options={eventOptions(state.events)}
          value={events.filter((e) => knownEvents.has(e))}
          onChange={setEvents}
        />
        <PickMany
          label="Fields this endpoint receives"
          options={fieldOptions(state.fields)}
          value={allowlist}
          hint={
            refusedKeys.length === 0
              ? undefined
              : `${refusedKeys.join(' and ')} can never be sent to an endpoint.`
          }
          onChange={setAllowlist}
        />
        {refused === null ? null : (
          <Alert tone="danger" title="Not saved">
            {refused}
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={!changed || events.length === 0}
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              void attempt(() => onUpdate(endpoint.id, { events, allowlist }));
            }}
          >
            Save changes
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void attempt(onRotate);
            }}
          >
            Rotate signing secret
          </Button>
          {onOpenLog === undefined ? null : (
            <Button aria-label={`Delivery log for ${endpoint.url}`} onClick={onOpenLog}>
              Delivery log
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
          <DialogTitle>Add an endpoint</DialogTitle>
          <DialogDescription>
            Deliveries are signed. The secret is shown once, after this.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required invalid={shown && badUrl}>
              <FieldLabel>URL</FieldLabel>
              <FieldControl>
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldError>An https address, reachable from the internet.</FieldError>
            </Field>
            <Field required invalid={shown && badEmail}>
              <FieldLabel>Alert email</FieldLabel>
              <FieldControl>
                <Input
                  type="email"
                  autoComplete="email"
                  value={alertEmail}
                  onChange={(e) => {
                    setAlertEmail(e.target.value);
                  }}
                />
              </FieldControl>
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
              hint={shown && events.length === 0 ? 'Subscribe to at least one event.' : undefined}
              onChange={setEvents}
            />
            <PickMany
              label="Fields this endpoint receives"
              options={fieldOptions(state.fields)}
              value={allowlist}
              onChange={setAllowlist}
            />
            {refused === null ? null : (
              <Alert tone="danger" title="Not added">
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
            loading={busy}
            loadingLabel="Adding"
            onClick={() => {
              void create();
            }}
          >
            Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
