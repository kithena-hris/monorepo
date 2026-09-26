'use client';

import { Alert, Badge, Button } from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { roleLabel, type ModuleRoles } from '../lib/modules';

export type GrantAgainResult = { ok: true } | { ok: false; message: string };

/** Where what the back office set and what the module has part. */
export interface RolesDrift {
  /** Set here, but not holding every role naming gives; `holds` is what they still have. */
  readonly missing: readonly { readonly accountId: string; readonly holds: readonly string[] }[];
  /** Holding an administrator role in the module, but not set here. */
  readonly unlisted: readonly { readonly accountId: string; readonly roles: readonly string[] }[];
}

export function rolesDrift(set: readonly string[], report: ModuleRoles): RolesDrift {
  const held = new Map(report.holders.map((h) => [h.accountId, h.roles]));
  return {
    missing: set.flatMap((accountId) => {
      const holds = held.get(accountId) ?? [];
      return report.administratorRoles.every((role) => holds.includes(role))
        ? []
        : [{ accountId, holds }];
    }),
    unlisted: report.holders.filter((h) => !set.includes(h.accountId)),
  };
}

/**
 * The roles nobody would hold once `removed` lose theirs: removing an
 * administrator takes every role naming gave. A role nobody holds now is
 * not one this removal takes away.
 */
export function rolesLeftWithNobody(report: ModuleRoles, removed: readonly string[]): string[] {
  return report.administratorRoles.filter((role) => {
    const holders = report.holders.filter((h) => h.roles.includes(role));
    return holders.length > 0 && holders.every((h) => removed.includes(h.accountId));
  });
}

/**
 * What the back office set beside what a module reports it has, for one
 * module, with the differences called out. Never synced: the company grants
 * and revokes its own roles, and the operator decides whether a difference
 * matters. "Grant again" names somebody again, so the module gives back what
 * naming gives; anybody the module has that was not set here is only shown.
 */
export function ModuleRolesDrift({
  entitlement,
  label,
  set,
  report,
  email,
  grantAgain,
}: {
  readonly entitlement: string;
  readonly label: string;
  /** Who the back office has named. */
  readonly set: readonly string[];
  readonly report: ModuleRoles;
  readonly email: (accountId: string) => string;
  readonly grantAgain: (entitlement: string, accountId: string) => Promise<GrantAgainResult>;
}): JSX.Element {
  const { missing, unlisted } = rolesDrift(set, report);
  const [asked, setAsked] = useState<Record<string, GrantAgainResult>>({});
  const [pending, start] = useTransition();
  const roles = (list: readonly string[]): string => list.map(roleLabel).join(' and ');

  if (missing.length === 0 && unlisted.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        {label} matches: everybody set here holds {roles(report.administratorRoles)} there, and
        nobody else does.
      </p>
    );
  }

  return (
    <Alert tone="warning" title={`${label} differs from what was set here`}>
      <p>
        The company can grant and revoke these roles itself, so this can be deliberate. Nothing is
        changed unless you ask.
      </p>
      <ul className="mt-2 flex flex-col gap-2" aria-label={`Differences in ${label}`}>
        {missing.map(({ accountId, holds }) => {
          const outcome = asked[accountId];
          return (
            <li key={accountId} className="flex flex-wrap items-center gap-2">
              <span className="break-all">{email(accountId)}</span>
              <Badge tone="warning">
                {holds.length === 0
                  ? `Set here, not in ${label}`
                  : `Set here, only ${roles(holds)}`}
              </Badge>
              {outcome?.ok === true ? (
                <span className="text-fg-muted text-sm" role="status">
                  Asked {label} to grant {roles(report.administratorRoles)} again.
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  aria-label={`Grant again to ${email(accountId)}`}
                  onClick={() => {
                    start(async () => {
                      const result = await grantAgain(entitlement, accountId);
                      setAsked((was) => ({ ...was, [accountId]: result }));
                    });
                  }}
                >
                  Grant again
                </Button>
              )}
              {outcome?.ok === false ? (
                <span className="text-danger-fg text-sm" role="alert">
                  {outcome.message}
                </span>
              ) : null}
            </li>
          );
        })}
        {unlisted.map(({ accountId, roles: held }) => (
          <li key={accountId} className="flex flex-wrap items-center gap-2">
            <span className="break-all">{email(accountId)}</span>
            <Badge tone="info">{`${roles(held)} in ${label}`}</Badge>
            <span className="text-fg-muted text-sm">not set here</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
