import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  List,
  ListItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TooltipProvider,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import {
  DeleteSchedule,
  EACH_SEES_THEIR_OWN,
  ScheduleForm,
  cadenceText,
  type ReportSchedulesProps,
  type ReportSchedulesState,
  type ScheduleRow,
} from '../reports/report-schedules';

/** What a schedule can be asked to do from Insights: the schedules page's own actions. */
export type ScheduleActions = Omit<ReportSchedulesProps, 'load'>;

/** Who gets it, short enough for one line: two names, then how many more. */
export function recipientsText(row: Pick<ScheduleRow, 'recipients'>): string {
  const names = row.recipients.map((r) => r.name ?? 'Somebody who has left');
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} and ${String(names.length - 2)} more`;
}

/**
 * Report schedules, behind a button on the report they send (V7). The button
 * counts the ones running; the popover lists each with its cadence and who
 * receives it, and every action the schedules page has: new, edit, pause or
 * resume, its history, delete.
 */
export function Schedules({
  state,
  actions,
}: {
  readonly state: ReportSchedulesState;
  readonly actions: ScheduleActions;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ readonly row: ScheduleRow | null } | null>(null);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const active = state.schedules.filter((s) => !s.paused).length;

  const act = (outcome: Promise<Outcome>): void => {
    setRefused(null);
    void outcome.then((o) => {
      if (o.ok) return;
      // Said where the schedules are, even when a confirmation had closed them.
      setRefused(o.message);
      setOpen(true);
    });
  };
  // A dialog takes the popover's place rather than opening over it.
  const edit = (row: ScheduleRow | null): void => {
    setOpen(false);
    setEditing({ row });
  };

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            startIcon={<icons.scheduled aria-hidden />}
            endIcon={
              <Badge size="sm" tone={active > 0 ? 'accent' : 'neutral'}>
                {active}
              </Badge>
            }
            aria-label={`Schedules, ${String(active)} active`}
          >
            Schedules
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-90 flex-col gap-2.5 p-3.5">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-md font-bold">Scheduled reports</h2>
            <Button
              size="xs"
              variant="primary"
              startIcon={<icons.add aria-hidden />}
              onClick={() => {
                edit(null);
              }}
            >
              New
            </Button>
          </div>
          {refused === null ? null : (
            <Alert tone="danger" title="Not changed">
              {refused}
            </Alert>
          )}
          {state.schedules.length === 0 ? (
            <p className="text-sm text-fg-muted">No reports are scheduled yet.</p>
          ) : (
            <List aria-label="Scheduled reports" className="bg-transparent shadow-none">
              {state.schedules.map((row) => (
                <ListItem
                  key={row.id}
                  description={
                    row.paused ? 'Paused' : `${cadenceText(row)} · ${recipientsText(row)}`
                  }
                  trailing={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`More for ${row.name}`}
                          startIcon={<icons.more aria-hidden />}
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            edit(row);
                          }}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            act(row.paused ? actions.onResume(row.id) : actions.onPause(row.id));
                          }}
                        >
                          {row.paused ? 'Resume' : 'Pause'}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a href={`/people/reports/${row.id}`}>History</a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={() => {
                            setOpen(false);
                            setDeleting(row);
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                >
                  {row.name}
                </ListItem>
              ))}
            </List>
          )}
          <p className="text-xs text-fg-muted">{EACH_SEES_THEIR_OWN}</p>
        </PopoverContent>
      </Popover>
      {editing === null ? null : (
        <ScheduleForm
          state={state}
          row={editing.row}
          onClose={() => {
            setEditing(null);
          }}
          onSave={(draft) =>
            editing.row === null ? actions.onCreate(draft) : actions.onUpdate(editing.row.id, draft)
          }
        />
      )}
      <DeleteSchedule
        row={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDelete={(id) => {
          act(actions.onDelete(id));
        }}
      />
    </TooltipProvider>
  );
}
