import {
  Alert,
  Avatar,
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useWrite } from './shared';
import type { GrantInput, Outcome, PersonRef } from './types';

/**
 * Sharing (E1, MA1): people and their permission, Private or Shared as one
 * control, and when access ends. Switching to Private ends everyone's access
 * at once. Confidential is the document's own switch, beside this.
 */

export interface ShareGrant {
  readonly kind: 'member' | 'team' | 'everyone';
  readonly id: string;
  readonly label: string;
  readonly permission: 'view' | 'edit';
  readonly endsOn: string | null;
}

const toInput = (g: ShareGrant): GrantInput => ({
  grantee:
    g.kind === 'member'
      ? { kind: 'member', personId: g.id }
      : g.kind === 'team'
        ? { kind: 'team', teamKey: g.id }
        : { kind: 'everyone' },
  permission: g.permission,
  endsOn: g.endsOn,
});

export function ShareDialog({
  open,
  onOpenChange,
  title,
  documentId,
  grants,
  people,
  me,
  hr,
  onShare,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly documentId: string;
  readonly grants: readonly ShareGrant[];
  readonly people: readonly PersonRef[];
  /** Who is sharing, left out of the people offered. */
  readonly me: string | null;
  /** HR may share with everyone at the company. */
  readonly hr: boolean;
  readonly onShare:
    ((documentId: string, grants: readonly GrantInput[]) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const [list, setList] = useState<readonly ShareGrant[]>(grants);
  const [level, setLevel] = useState<'private' | 'shared'>(
    grants.length === 0 ? 'private' : 'shared',
  );
  const [endsOn, setEndsOn] = useState<string | null>(grants[0]?.endsOn ?? null);
  const write = useWrite();
  const named = new Set(list.map((g) => g.id));
  const options = people
    .filter((p) => p.personId !== me && !named.has(p.personId))
    .map((p) => ({
      value: p.personId,
      label: p.name,
      ...(p.teamName === null ? {} : { description: p.teamName }),
    }));
  const add = (value: string | readonly string[] | null): void => {
    const id = typeof value === 'string' ? value : null;
    const person = people.find((p) => p.personId === id);
    if (person === undefined) return;
    setList([
      ...list,
      { kind: 'member', id: person.personId, label: person.name, permission: 'view', endsOn },
    ]);
    setLevel('shared');
  };
  const save = (): void => {
    const next = level === 'private' ? [] : list.map((g) => ({ ...g, endsOn }));
    write.run(
      () => onShare?.(documentId, next.map(toInput)) ?? Promise.resolve({ ok: true }),
      () => {
        onOpenChange(false);
      },
    );
  };
  const everyone = list.some((g) => g.kind === 'everyone');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {title}</DialogTitle>
          <DialogDescription>
            Private ends everyone’s access at once. Sections never change who can open it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <SegmentedControl
            aria-label="Who can open it"
            fullWidth
            value={level}
            onValueChange={(v) => {
              setLevel(v === 'shared' ? 'shared' : 'private');
            }}
          >
            <SegmentedControlItem value="private">
              <icons.locked aria-hidden /> Private
            </SegmentedControlItem>
            <SegmentedControlItem value="shared">
              <icons.people aria-hidden /> Shared
            </SegmentedControlItem>
          </SegmentedControl>
          {level === 'shared' ? (
            <>
              <Field>
                <FieldLabel>Add people</FieldLabel>
                <FieldControl>
                  <Combobox
                    label="Add people"
                    options={options}
                    value={null}
                    onChange={add}
                    placeholder="Add people"
                    searchPlaceholder="Find someone"
                    emptyMessage="Nobody by that name"
                  />
                </FieldControl>
              </Field>
              {hr && !everyone ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  startIcon={<icons.company aria-hidden />}
                  onClick={() => {
                    setList([
                      ...list,
                      { kind: 'everyone', id: '*', label: 'Everyone', permission: 'view', endsOn },
                    ]);
                  }}
                >
                  Share with everyone
                </Button>
              ) : null}
              {list.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  Nobody yet. Add the people who should open it.
                </p>
              ) : (
                <List>
                  {list.map((g) => (
                    <ListItem
                      key={`${g.kind}:${g.id}`}
                      leading={<Avatar name={g.label} size="md" />}
                      trailing={
                        <div className="flex items-center gap-2">
                          <Select
                            value={g.permission}
                            onValueChange={(p) => {
                              setList(
                                list.map((x) =>
                                  x === g
                                    ? { ...x, permission: p === 'edit' ? 'edit' : 'view' }
                                    : x,
                                ),
                              );
                            }}
                          >
                            <SelectTrigger size="sm" aria-label={`What ${g.label} can do`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="view">View</SelectItem>
                              <SelectItem value="edit">Edit</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${g.label}`}
                            startIcon={<icons.close aria-hidden />}
                            onClick={() => {
                              setList(list.filter((x) => x !== g));
                            }}
                          />
                        </div>
                      }
                    >
                      {g.label}
                    </ListItem>
                  ))}
                </List>
              )}
              <Field>
                <FieldLabel>Access ends</FieldLabel>
                <FieldControl>
                  <DatePicker
                    label="Access ends"
                    placeholder="Never"
                    value={endsOn}
                    onChange={setEndsOn}
                  />
                </FieldControl>
              </Field>
            </>
          ) : null}
          {write.error === null ? null : (
            <Alert tone="danger" title="Not shared">
              {write.error}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" disabled={write.pending} onClick={save}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
