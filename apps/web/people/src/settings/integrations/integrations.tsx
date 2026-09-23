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
  TagsInput,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../../load';

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
}

const REASON = {
  'special-category': 'is special-category data and never leaves in a webhook',
  encrypted: 'is encrypted and never leaves in a webhook',
} as const;

/**
 * What leaves the building, and to whom (PRD §13.3, design screen 9).
 *
 * Each endpoint subscribes to events and to a field allowlist. The allowlist
 * is a `TagsInput` backed by the published schema, so it cannot name a field
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

function allowlistCheck(fields: readonly AllowableField[]) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return (key: string): string | null => {
    const field = byKey.get(key);
    if (field === undefined) return `${key} is not a field in the published schema.`;
    return field.refused === null ? null : `${field.label} ${REASON[field.refused]}.`;
  };
}

function Endpoints({
  state,
  onCreate,
  onUpdate,
  onRotate,
}: IntegrationsProps & { readonly state: IntegrationsState }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);
  const refusedLabels = state.fields.filter((f) => f.refused !== null).map((f) => f.key);

  return (
    <Stack gap={6}>
      <PageHeader
        title="Integrations"
        description={`${String(state.endpoints.length)} endpoints · schema version ${String(state.schemaVersion)} · ${state.deliveries24h.toLocaleString()} deliveries in 24h`}
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
      />
      {secret === null ? null : (
        <Alert tone="warning" title="Copy the signing secret now">
          <Stack gap={2}>
            <p>
              This is the only time it is shown for {secret.url}. It cannot be retrieved later; if
              it is lost, rotate it.
            </p>
            <CopyField value={secret.value} label="Copy the signing secret" />
          </Stack>
        </Alert>
      )}
      {state.endpoints.length === 0 ? (
        <EmptyState
          title="No endpoints yet"
          description="An endpoint receives the events you choose, carrying only the fields you allow."
        />
      ) : (
        state.endpoints.map((endpoint) => (
          <EndpointCard
            key={endpoint.id}
            endpoint={endpoint}
            state={state}
            refusedKeys={refusedLabels}
            onUpdate={onUpdate}
            onRotate={async () => {
              const rotated = await onRotate(endpoint.id);
              if (rotated.ok) setSecret({ url: endpoint.url, value: rotated.secret });
              return rotated.ok ? { ok: true } : rotated;
            }}
          />
        ))
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
}: {
  readonly endpoint: Endpoint;
  readonly state: IntegrationsState;
  readonly refusedKeys: readonly string[];
  readonly onUpdate: IntegrationsProps['onUpdate'];
  readonly onRotate: () => Promise<Outcome>;
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
        <TagsInput
          label="Events"
          value={events}
          validate={(e) => (knownEvents.has(e) ? null : `${e} is not an event People raises.`)}
          onChange={setEvents}
        />
        <TagsInput
          label="Fields this endpoint receives"
          value={allowlist}
          validate={allowlistCheck(state.fields)}
          hint={
            refusedKeys.length === 0
              ? 'Field keys from the published schema.'
              : `Field keys from the published schema. ${refusedKeys.join(' and ')} cannot be added to any allowlist.`
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
  const knownEvents = new Set(state.events);
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
            <TagsInput
              label="Events"
              value={events}
              invalid={shown && events.length === 0}
              hint={shown && events.length === 0 ? 'Subscribe to at least one event.' : undefined}
              validate={(e) => (knownEvents.has(e) ? null : `${e} is not an event People raises.`)}
              onChange={setEvents}
            />
            <TagsInput
              label="Fields this endpoint receives"
              value={allowlist}
              validate={allowlistCheck(state.fields)}
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
