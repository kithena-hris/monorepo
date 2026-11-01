'use server';

import type { InboxField } from '@kithena/contracts';

import { taskScreen, type TaskScreen } from '../../../lib/inbox/task-screen';
import { people } from '../../../lib/people';

/*
 * The reads only the Inbox's pane asks for: their own file, so the actions
 * every page's chrome imports from `actions.ts` (the assistant's, the bell's)
 * do not carry them.
 */

/** A task's own screen, for the pane to draw it where the task sits (`task-screen.tsx`). */
export async function openTaskScreen(link: string): Promise<TaskScreen | null> {
  return taskScreen(link);
}

/** A record field as People's profile read answers it: what a gap is made of. */
interface RecordFieldRead {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { value: string; label: string }[];
  readonly required: boolean;
  readonly missing: boolean;
  readonly readOnly: boolean;
  readonly sensitive: boolean;
  readonly currency: string | null;
}

/**
 * What a person's record still needs, by section: its required fields left
 * empty that the viewer may fill, and nothing else. Read when a task about
 * the record opens (a hire to set up), not with every Inbox read.
 */
export async function recordGaps(personId: string): Promise<
  | {
      readonly ok: true;
      readonly sections: readonly {
        readonly key: string;
        readonly label: string;
        readonly fields: readonly InboxField[];
      }[];
    }
  | { readonly ok: false; readonly message: string }
> {
  const found = await people<{
    sections: readonly { key: string; label: string; fields: readonly RecordFieldRead[] }[];
  }>('Profile', { personId });
  if (!found.ok) return { ok: false, message: found.message };
  return {
    ok: true,
    sections: found.data.sections.flatMap((s) => {
      const fields = s.fields
        .filter((f) => f.required && f.missing && !f.readOnly)
        .map((f): InboxField => ({
          key: f.key,
          label: f.label,
          description: f.description,
          dataType: f.dataType,
          options: f.options.map((o) => ({ value: o.value, label: o.label })),
          required: true,
          value: null,
          sensitive: f.sensitive,
          currency: f.currency,
        }));
      return fields.length === 0 ? [] : [{ key: s.key, label: s.label, fields }];
    }),
  };
}
