import type { ViewerScope, WriterRole } from './model';

/**
 * The visibility step's plain sentence: who can see this field and who can
 * change it, read back from what was ticked (§9.2).
 *
 * "The employee can see and edit this. Their manager cannot. HR can see it."
 *
 * Display, not a decision: the application layer is what enforces both rules.
 * This only says in words what the two lists of checkboxes already say.
 */
export function readBack(
  ownership: readonly WriterRole[],
  visibility: readonly ViewerScope[],
): string {
  const sees = (...scopes: ViewerScope[]): boolean => scopes.some((s) => visibility.includes(s));
  const audiences: { who: string; see: boolean; edit: boolean }[] = [
    { who: 'The employee', see: sees('self', 'directory'), edit: ownership.includes('employee') },
    {
      who: 'Their manager',
      see: sees('manager', 'manager_chain', 'directory'),
      edit: ownership.includes('manager'),
    },
    { who: 'HR', see: sees('hr', 'admin'), edit: ownership.includes('hr') },
    { who: 'Finance', see: sees('finance', 'directory'), edit: ownership.includes('finance') },
  ];

  const sentences = audiences
    // Finance is only worth a sentence when it is involved at all.
    .filter((a) => a.who !== 'Finance' || a.see || a.edit)
    .map(({ who, see, edit }) => {
      if (see && edit) return `${who} can see and edit this.`;
      if (see) return `${who} can see it.`;
      // Owning a field you cannot read is possible for a system-fed value, but
      // for a person it is a form they fill in and never see again.
      if (edit) return `${who} can fill it in but not see it afterwards.`;
      return `${who} cannot.`;
    });
  if (visibility.includes('directory')) sentences.push('Everyone can find it in the directory.');
  return sentences.join(' ');
}
