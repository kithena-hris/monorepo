import { ADMINISTERED_MODULES, OFFERED_MODULES, type ModuleEntitlement } from '@kithena/contracts';

/**
 * What an operator reads beside each module they can switch on (PEO-114).
 * The list itself is the contract's; only the words are the back office's.
 */
const WORDS: Record<string, { label: string; description: string }> = {
  'module.people': {
    label: 'People',
    description: 'Employee records, the directory, onboarding and imports.',
  },
  'module.timeoff': {
    label: 'Time off',
    description: 'Leave requests, approvals and balances.',
  },
};

export const MODULE_CHOICES: readonly {
  readonly key: ModuleEntitlement;
  readonly label: string;
  readonly description: string;
  /** Switching it on names who administers it (PEO-112). */
  readonly administered: boolean;
}[] = OFFERED_MODULES.map((key) => ({
  key,
  label: WORDS[key]?.label ?? key,
  description: WORDS[key]?.description ?? '',
  administered: ADMINISTERED_MODULES.includes(key),
}));

/** The name an operator knows a module by. */
export function moduleLabel(key: string): string {
  return WORDS[key]?.label ?? key;
}
