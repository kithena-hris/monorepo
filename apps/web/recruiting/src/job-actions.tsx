import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import type { MoreItem, useAct } from './shared';
import { t as tr } from './i18n';

/**
 * A job's lifecycle as commands: edit it, archive it (it closes and leaves
 * the list; its candidates and records stay), bring it back, or delete it,
 * which only a job nobody applied to allows. The same list on the jobs list's
 * row and in the board's More menu.
 */

export interface JobRef {
  readonly id: string;
  readonly title: string;
  /** Candidates still in the pipeline, said in the archive question. */
  readonly active: number;
  readonly archived: boolean;
  readonly may: { readonly edit: boolean; readonly archive: boolean; readonly delete: boolean };
}

export type Confirming = { readonly kind: 'archive' | 'delete'; readonly job: JobRef } | null;

export function jobCommands(
  job: JobRef,
  {
    onNavigate,
    onConfirm,
    act,
  }: {
    readonly onNavigate: ((to: string) => void) | undefined;
    readonly onConfirm: (confirming: Confirming) => void;
    readonly act: ReturnType<typeof useAct>;
  },
): MoreItem[] {
  return [
    {
      id: 'edit',
      label: tr('job-actions.edit_job', 'Edit job'),
      icon: <icons.edit aria-hidden />,
      hidden: !job.may.edit,
      group: 'job',
      onSelect: () => onNavigate?.(`/recruiting/jobs/${job.id}/setup`),
    },
    {
      id: 'dashboard',
      label: tr('job-actions.job_dashboard', 'Job dashboard'),
      icon: <icons.analytics aria-hidden />,
      group: 'job',
      onSelect: () => onNavigate?.(`/recruiting/analytics?job=${job.id}`),
    },
    {
      id: 'unarchive',
      label: tr('job-actions.bring_back', 'Bring back to the list'),
      icon: <icons.undo aria-hidden />,
      hidden: !job.archived || !job.may.archive,
      group: 'life',
      onSelect: () => {
        act.run('UnarchiveJob', { jobId: job.id });
      },
    },
    {
      id: 'archive',
      label: tr('job-actions.archive', 'Archive…'),
      icon: <icons.archive aria-hidden />,
      hidden: job.archived || !job.may.archive,
      group: 'life',
      onSelect: () => {
        onConfirm({ kind: 'archive', job });
      },
    },
    {
      id: 'delete',
      label: tr('job-actions.delete', 'Delete…'),
      icon: <icons.delete aria-hidden />,
      destructive: true,
      hidden: !job.may.delete,
      group: 'life',
      onSelect: () => {
        onConfirm({ kind: 'delete', job });
      },
    },
  ];
}

/** The question before an archive or a delete, with what it does in words. */
export function JobConfirm({
  confirming,
  onClose,
  act,
  onDeleted,
}: {
  readonly confirming: Confirming;
  readonly onClose: () => void;
  readonly act: ReturnType<typeof useAct>;
  /** Where to go once the job is gone, when the page was the job's own. */
  readonly onDeleted?: () => void;
}): JSX.Element {
  const job = confirming?.job;
  const archive = confirming?.kind === 'archive';
  return (
    <AlertDialog
      open={confirming !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>
          {archive
            ? tr('job-actions.archive_title', 'Archive {{title}}?', { title: job?.title ?? '' })
            : tr('job-actions.delete_title', 'Delete {{title}}?', { title: job?.title ?? '' })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {archive
            ? (job?.active ?? 0) > 0
              ? tr(
                  'job-actions.archive_with_candidates',
                  'The job closes and its ads come down. {{count}} candidates stay where they are, and every record is kept; bring it back from Archived at any time.',
                  { count: String(job?.active ?? 0) },
                )
              : tr(
                  'job-actions.archive_empty',
                  'The job closes and its ads come down. Every record is kept; bring it back from Archived at any time.',
                )
            : tr(
                'job-actions.delete_body',
                'Nobody has applied, so nothing else goes with it. This cannot be undone.',
              )}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">{tr('job-actions.cancel', 'Cancel')}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={archive ? 'primary' : 'danger'}
              loading={act.pending}
              onClick={() => {
                if (job === undefined) return;
                act.run(archive ? 'ArchiveJob' : 'DeleteJob', { jobId: job.id }, () => {
                  onClose();
                  if (!archive) onDeleted?.();
                });
              }}
            >
              {archive
                ? tr('job-actions.archive_job', 'Archive job')
                : tr('job-actions.delete_job', 'Delete job')}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
