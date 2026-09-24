'use client';

import { Alert, Badge, Button, Inline, PageSection, Stack } from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { moduleLabel } from '../lib/modules';
import { AdministratorSelect } from './administrator-select';
import { ModulesPicker } from './modules-picker';

export type SaveModulesResult = { ok: true } | { ok: false; message: string };

/** An account at the company that can still sign in: who may be named. */
export interface NameableAccount {
  readonly id: string;
  readonly email: string;
}

/**
 * The modules a company bought (PEO-114), and who administers People
 * (PEO-112), changed on its page.
 *
 * `recorded` null means the back office never recorded a list, so the company
 * has the deployment's; saving records one, and from then on it is the answer.
 * Switching People on asks who administers it, from the company's accounts;
 * a company that already has People can be given another administrator —
 * the way back for one that has lost them all.
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
  const [selected, setSelected] = useState<string[]>([...effective]);
  const [administrators, setAdministrators] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<SaveModulesResult | null>(null);
  const [pending, start] = useTransition();
  const changed = [...selected].sort().join() !== [...effective].sort().join();
  const switchingOnPeople =
    selected.includes('module.people') && !effective.includes('module.people');
  const choices = accounts.map((a) => ({ value: a.id, label: a.email }));

  return (
    <Stack gap={6}>
      <PageSection
        title="Modules"
        description="What the company bought. Only these appear in its app, and each module is told."
        surface
      >
        <Stack gap={5}>
          {recorded === null ? (
            <Alert tone="info" title="Nothing recorded yet">
              This company has the deployment&apos;s default modules
              {effective.length === 0 ? ', which are none' : ''}. Saving records its own list.
            </Alert>
          ) : null}
          <Inline gap={2}>
            {effective.length === 0 ? (
              <Badge tone="neutral">No modules</Badge>
            ) : (
              effective.map((key) => (
                <Badge key={key} tone="success" dot>
                  {moduleLabel(key)}
                </Badge>
              ))
            )}
          </Inline>
          <ModulesPicker
            selected={selected}
            disabled={pending}
            onChange={(next) => {
              setSelected(next);
              setOutcome(null);
            }}
            extra={(key) =>
              key === 'module.people' && switchingOnPeople ? (
                accounts.length === 0 ? (
                  <Alert tone="warning">
                    Invite somebody first: People needs an administrator with an account here.
                  </Alert>
                ) : (
                  <AdministratorSelect
                    label="People administrator"
                    choices={choices}
                    value={administrators[key]}
                    onChange={(id) => {
                      setAdministrators({ ...administrators, [key]: id });
                    }}
                  />
                )
              ) : null
            }
          />
          {outcome?.ok === false ? (
            <Alert tone="danger" title="Not saved">
              {outcome.message}
            </Alert>
          ) : null}
          {outcome?.ok === true ? <Alert tone="success">Saved.</Alert> : null}
          <div>
            <Button
              variant="primary"
              disabled={
                pending ||
                (!changed && recorded !== null) ||
                (switchingOnPeople && administrators['module.people'] === undefined)
              }
              onClick={() => {
                start(async () => {
                  setOutcome(await save(selected, switchingOnPeople ? administrators : {}));
                });
              }}
            >
              {pending ? 'Saving…' : 'Save modules'}
            </Button>
          </div>
        </Stack>
      </PageSection>
      {effective.includes('module.people') ? (
        <NameAdministrator choices={choices} name={nameAdministrator} />
      ) : null}
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
