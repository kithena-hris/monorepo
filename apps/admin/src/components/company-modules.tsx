'use client';

import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PageSection,
  Stack,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { MODULE_CHOICES } from '../lib/modules';
import { ModulesEditor, type ModulesDraft } from './modules-editor';

export type SaveModulesResult = { ok: true } | { ok: false; message: string };

/** An account at the company that can still sign in: who may be named. */
export interface NameableAccount {
  readonly id: string;
  readonly email: string;
}

/** What one module's change does, in words an operator checks before saving. */
interface Change {
  readonly key: string;
  readonly label: string;
  readonly switched: 'on' | 'off' | null;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

function changesBetween(
  saved: ModulesDraft,
  draft: ModulesDraft,
  email: (id: string) => string,
): Change[] {
  return MODULE_CHOICES.flatMap((choice) => {
    const was = saved.on.includes(choice.key);
    const is = draft.on.includes(choice.key);
    const before = saved.administrators[choice.key] ?? [];
    const after = is && choice.administered ? (draft.administrators[choice.key] ?? []) : before;
    const change: Change = {
      key: choice.key,
      label: choice.label,
      switched: was === is ? null : is ? 'on' : 'off',
      added: after.filter((id) => !before.includes(id)).map(email),
      removed: after === before ? [] : before.filter((id) => !after.includes(id)).map(email),
    };
    return change.switched !== null || change.added.length > 0 || change.removed.length > 0
      ? [change]
      : [];
  });
}

function describe(change: Change): string {
  const parts = [
    change.switched === null ? null : `switched ${change.switched}`,
    change.added.length > 0 ? `adds ${change.added.join(', ')}` : null,
    change.removed.length > 0 ? `removes ${change.removed.join(', ')}` : null,
  ].filter(Boolean);
  return `${change.label}: ${parts.join('; ')}`;
}

/**
 * The modules a company bought (PEO-114) and who administers each (PEO-112),
 * changed on its page as one draft and saved in one request.
 *
 * Nothing is recorded while switches move and people are chosen: a bar lists
 * what the save will do — modules on and off, administrators added and
 * removed — and applies it all at once, so switching on two modules for the
 * same three people is one decision, not six. Switching a module off asks
 * first, because it disappears for everyone. `recorded` null means the back
 * office never recorded a list, so the company has the deployment's until the
 * first save.
 */
export function CompanyModules({
  recorded,
  effective,
  administrators,
  accounts,
  save,
}: {
  readonly recorded: readonly string[] | null;
  readonly effective: readonly string[];
  /** Module → the accounts named to administer it. */
  readonly administrators: Readonly<Record<string, readonly string[]>>;
  readonly accounts: readonly NameableAccount[];
  readonly save: (
    entitlements: string[],
    administrators: Record<string, string[]>,
  ) => Promise<SaveModulesResult>;
}): JSX.Element {
  const [saved, setSaved] = useState<ModulesDraft>({ on: effective, administrators });
  const [draft, setDraft] = useState<ModulesDraft>(saved);
  const [onDefault, setOnDefault] = useState(recorded === null);
  // Bumped to start the editor afresh from `saved` when a draft is discarded.
  const [edition, setEdition] = useState(0);
  const [outcome, setOutcome] = useState<SaveModulesResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const emails = new Map(accounts.map((a) => [a.id, a.email]));
  const email = (id: string): string => emails.get(id) ?? 'an account that has left';
  const changes = changesBetween(saved, draft, email);
  const switchedOff = changes.filter((c) => c.switched === 'off');

  /*
   * A module switched on needs somebody, and one that had administrators keeps
   * at least one. One that had nobody named — switched on before naming was
   * asked — may stay that way until somebody is.
   */
  const problems: Record<string, string> = {};
  for (const choice of MODULE_CHOICES) {
    if (!choice.administered || !draft.on.includes(choice.key)) continue;
    if ((draft.administrators[choice.key] ?? []).length > 0) continue;
    if (!saved.on.includes(choice.key)) {
      problems[choice.key] = `Choose who will administer ${choice.label}.`;
    } else if ((saved.administrators[choice.key] ?? []).length > 0) {
      problems[choice.key] = `${choice.label} keeps at least one administrator.`;
    }
  }
  const blocked = Object.keys(problems).length > 0;

  function apply(): void {
    setConfirming(false);
    setOutcome(null);
    // Each administered module switched on, with its whole list: the ones
    // left out keep what they have.
    const lists: Record<string, string[]> = {};
    for (const choice of MODULE_CHOICES) {
      const list = draft.administrators[choice.key] ?? [];
      const had = saved.administrators[choice.key] ?? [];
      if (choice.administered && draft.on.includes(choice.key) && (list.length > 0 || had.length > 0)) {
        lists[choice.key] = [...list];
      }
    }
    const next = draft;
    start(async () => {
      const result = await save([...next.on], lists);
      if (result.ok) {
        setSaved(next);
        setOnDefault(false);
      }
      setOutcome(result);
    });
  }

  return (
    <PageSection
      title="Modules"
      description="What the company bought and who runs each. A module switched on appears in its app for everyone, and each module is told who administers it."
      surface
    >
      <Stack gap={5}>
        {onDefault ? (
          <Alert tone="info" title="On the deployment default">
            This company has the deployment&apos;s default modules
            {saved.on.length === 0 ? ', which are none' : ''}. Saving records its own list.
          </Alert>
        ) : null}
        {accounts.length === 0 ? (
          <Alert tone="warning">
            Invite somebody first: a module needs an administrator with an account here.
          </Alert>
        ) : null}

        <ModulesEditor
          key={edition}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setOutcome(null);
          }}
          people={accounts.map((a) => ({ value: a.id, label: a.email }))}
          problems={problems}
          disabled={pending}
          emptyMessage="Nobody at the company matches."
        />

        {outcome?.ok === false ? (
          <Alert tone="danger" title="Nothing was changed">
            {outcome.message}
          </Alert>
        ) : null}
        {outcome?.ok === true && changes.length === 0 ? (
          <Alert tone="success">
            Saved. The company&apos;s app shows it on the next page load, and each module grants
            its administrators within a minute.
          </Alert>
        ) : null}

        {changes.length > 0 ? (
          // In the flow of the page but stuck to the bottom of the viewport,
          // so the save is in reach from any row of a long list.
          <Card variant="elevated" padded className="sticky bottom-4 z-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-fg text-sm font-medium">
                  {changes.length === 1 ? 'One unsaved change' : `${String(changes.length)} unsaved changes`}
                </p>
                <ul className="text-fg-muted mt-1 flex flex-col gap-0.5 text-sm">
                  {changes.map((change) => (
                    <li key={change.key} className="break-words">
                      {describe(change)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setDraft(saved);
                    setEdition((n) => n + 1);
                    setOutcome(null);
                  }}
                >
                  Discard
                </Button>
                <Button
                  variant="primary"
                  disabled={pending || blocked}
                  onClick={() => {
                    if (switchedOff.length > 0) setConfirming(true);
                    else apply();
                  }}
                >
                  {pending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </Stack>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Switch off {switchedOff.map((c) => c.label).join(' and ')}
            </DialogTitle>
            <DialogDescription>
              {switchedOff.length === 1 ? 'It disappears' : 'They disappear'} from the
              company&apos;s app for everyone at once. Its data is kept, and switching it back on
              brings it back.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ul className="text-fg-muted flex flex-col gap-1 text-sm">
              {changes.map((change) => (
                <li key={change.key}>{describe(change)}</li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={apply}>
              Switch off and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
