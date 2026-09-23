'use client';

import { Alert, Badge, Button, Inline, PageSection, Stack } from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { moduleLabel } from '../lib/modules';
import { ModulesPicker } from './modules-picker';

export type SaveModulesResult = { ok: true } | { ok: false; message: string };

/**
 * The modules a company bought, changed on its page (PEO-114).
 *
 * `recorded` null means the back office never recorded a list, so the company
 * has the deployment's; saving records one, and from then on it is the answer.
 */
export function CompanyModules({
  recorded,
  effective,
  save,
}: {
  readonly recorded: readonly string[] | null;
  readonly effective: readonly string[];
  readonly save: (entitlements: string[]) => Promise<SaveModulesResult>;
}): JSX.Element {
  const [selected, setSelected] = useState<string[]>([...effective]);
  const [outcome, setOutcome] = useState<SaveModulesResult | null>(null);
  const [pending, start] = useTransition();
  const changed = [...selected].sort().join() !== [...effective].sort().join();

  return (
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
            disabled={pending || (!changed && recorded !== null)}
            onClick={() => {
              start(async () => {
                setOutcome(await save(selected));
              });
            }}
          >
            {pending ? 'Saving…' : 'Save modules'}
          </Button>
        </div>
      </Stack>
    </PageSection>
  );
}
