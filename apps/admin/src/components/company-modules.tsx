'use client';

import {
  Alert,
  Badge,
  Button,
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
  PageSection,
  Spinner,
  Stack,
  Switch,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { MODULE_CHOICES, moduleLabel } from '../lib/modules';
import { AdministratorSelect } from './administrator-select';

export type SaveModulesResult = { ok: true } | { ok: false; message: string };

/** An account at the company that can still sign in: who may be named. */
export interface NameableAccount {
  readonly id: string;
  readonly email: string;
}

const PEOPLE = 'module.people';

/**
 * The modules a company bought (PEO-114), one switch each, and who
 * administers People (PEO-112), changed on its page.
 *
 * A switch commits the moment it moves: flipping one records the company's
 * whole list, and its app shows the change on the next page load. Switching
 * People on first asks who administers it; switching anything off first asks
 * for confirmation. `recorded` null means the back office never recorded a
 * list, so the company has the deployment's until a switch moves.
 */
export function CompanyModules({
  recorded,
  effective,
  accounts,
  save,
  nameAdministrator,
}: {
  readonly recorded: readonly string[] | null;
  readonly effective: readonly string[];
  readonly accounts: readonly NameableAccount[];
  readonly save: (
    entitlements: string[],
    administrators: Record<string, string>,
  ) => Promise<SaveModulesResult>;
  readonly nameAdministrator: (accountId: string) => Promise<SaveModulesResult>;
}): JSX.Element {
  const [on, setOn] = useState<readonly string[]>(effective);
  const [onDefault, setOnDefault] = useState(recorded === null);
  // The switch being saved and where it is going. It shows there until the
  // answer and then falls back to `on`, so a refusal puts it back.
  const [moving, setMoving] = useState<{ key: string; on: boolean } | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SaveModulesResult>>({});
  const [asking, setAsking] = useState<{ key: string; on: boolean } | null>(null);
  const [administrator, setAdministrator] = useState<string | undefined>(undefined);
  const [, start] = useTransition();
  const choices = accounts.map((a) => ({ value: a.id, label: a.email }));

  function commit(key: string, turnOn: boolean, administrators: Record<string, string>): void {
    const rest = on.filter((k) => k !== key);
    const next = turnOn ? [...rest, key] : rest;
    setMoving({ key, on: turnOn });
    setOutcomes((all) => {
      const { [key]: _, ...others } = all;
      return others;
    });
    start(async () => {
      const outcome = await save(next, administrators);
      if (outcome.ok) {
        setOn(next);
        setOnDefault(false);
      }
      setOutcomes((all) => ({ ...all, [key]: outcome }));
      setMoving(null);
    });
  }

  function close(): void {
    setAsking(null);
    setAdministrator(undefined);
  }

  const askingLabel = asking === null ? '' : moduleLabel(asking.key);
  const needsInvite = asking?.on === true && accounts.length === 0;

  return (
    <Stack gap={6}>
      <PageSection
        title="Modules"
        description="What the company bought. A module switched on appears in its app for everyone, and each module is told."
        surface
      >
        <Stack gap={5}>
          {onDefault ? (
            <Alert tone="info" title="On the deployment default">
              This company has the deployment&apos;s default modules
              {on.length === 0 ? ', which are none' : ''}. Flipping any switch records its own list.
            </Alert>
          ) : null}
          {MODULE_CHOICES.map((choice) => {
            const isOn = on.includes(choice.key);
            const saving = moving !== null && moving.key === choice.key;
            const outcome = outcomes[choice.key];
            return (
              <Stack key={choice.key} gap={2}>
                <Field orientation="horizontal">
                  <div className="flex flex-col">
                    <FieldLabel>{choice.label}</FieldLabel>
                    <FieldDescription>{choice.description}</FieldDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {saving ? <Spinner size="sm" label={`Saving ${choice.label}`} /> : null}
                    <Badge tone={isOn ? 'success' : 'neutral'} dot={isOn}>
                      {isOn ? 'On' : 'Off'}
                    </Badge>
                    <FieldControl>
                      <Switch
                        aria-label={`${choice.label} module`}
                        checked={saving ? moving.on : isOn}
                        // One save at a time: each sends the whole list.
                        disabled={moving !== null}
                        onCheckedChange={(checked) => {
                          if (checked && choice.key !== PEOPLE) commit(choice.key, true, {});
                          else setAsking({ key: choice.key, on: checked });
                        }}
                      />
                    </FieldControl>
                  </div>
                </Field>
                {outcome?.ok === false ? (
                  <Alert tone="danger" title={`${choice.label} not changed`}>
                    {outcome.message}
                  </Alert>
                ) : null}
                {outcome?.ok === true ? (
                  <Alert tone="success">
                    {choice.label} is {isOn ? 'on' : 'off'}. The company&apos;s app shows it on the
                    next page load.
                  </Alert>
                ) : null}
              </Stack>
            );
          })}
        </Stack>
      </PageSection>
      {on.includes(PEOPLE) ? (
        <NameAdministrator choices={choices} name={nameAdministrator} />
      ) : null}
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {asking?.on === true ? `Switch on ${askingLabel}` : `Switch off ${askingLabel}`}
            </DialogTitle>
            <DialogDescription>
              {asking?.on === true
                ? `${askingLabel} needs a first administrator from the company's accounts.`
                : `${askingLabel} disappears from the company's app for everyone at once. Its data is kept, and switching it back on brings it back.`}
            </DialogDescription>
          </DialogHeader>
          {asking?.on === true ? (
            <DialogBody>
              {needsInvite ? (
                <Alert tone="warning">
                  Invite somebody first: People needs an administrator with an account here.
                </Alert>
              ) : (
                <AdministratorSelect
                  label="People administrator"
                  choices={choices}
                  value={administrator}
                  onChange={setAdministrator}
                />
              )}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            {needsInvite ? null : (
              <Button
                variant={asking?.on === true ? 'primary' : 'destructive'}
                disabled={asking?.on === true && administrator === undefined}
                onClick={() => {
                  if (asking === null) return;
                  commit(
                    asking.key,
                    asking.on,
                    asking.on && administrator !== undefined ? { [asking.key]: administrator } : {},
                  );
                  close();
                }}
              >
                {asking?.on === true ? 'Switch on' : 'Switch off'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

/** Another People administrator, for a company that has People already. */
function NameAdministrator({
  choices,
  name,
}: {
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly name: (accountId: string) => Promise<SaveModulesResult>;
}): JSX.Element {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<SaveModulesResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <PageSection
      title="People administrator"
      description="Name somebody to run People when nobody at the company can grant the role any more. Every other grant is the company's own."
      surface
    >
      <Stack gap={4}>
        <AdministratorSelect
          label="Account"
          choices={choices}
          value={chosen}
          onChange={(id) => {
            setChosen(id);
            setOutcome(null);
          }}
        />
        {outcome?.ok === false ? (
          <Alert tone="danger" title="Not named">
            {outcome.message}
          </Alert>
        ) : null}
        {outcome?.ok === true ? (
          <Alert tone="success">Named. People grants the role within a minute.</Alert>
        ) : null}
        <div>
          <Button
            disabled={pending || chosen === undefined}
            onClick={() => {
              if (chosen === undefined) return;
              start(async () => {
                setOutcome(await name(chosen));
              });
            }}
          >
            {pending ? 'Naming…' : 'Name administrator'}
          </Button>
        </div>
      </Stack>
    </PageSection>
  );
}
