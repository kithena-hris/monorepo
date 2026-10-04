import { asIdentity, asSpecialCategory } from '@kithena/contracts';
import type { TenantField } from '@kithena/telemetry';

/**
 * The keys and words that would mean health data or somebody's identity had
 * reached a prompt: Time Off's own refusals, the same for every tenant (Time
 * Off defines no fields per tenant). The AI gateway refuses them in Time
 * Off's own model calls (`infrastructure/assist/gateway.ts`), and the
 * assistant loads them from Time Off's capability catalogue for its planner
 * (assistant PRD §12.2, §12.3).
 */
export const DENIED: readonly TenantField[] = [
  {
    key: 'sick_note',
    policy: asSpecialCategory('health'),
    labels: ['sick note', 'medical note', 'sick leave', 'diagnosis'],
  },
  { key: 'medical_note', policy: asSpecialCategory('health'), labels: ['medical certificate'] },
  { key: 'due_date', policy: asSpecialCategory('health'), labels: ['due date'] },
  {
    key: 'birth_date',
    policy: asSpecialCategory('health'),
    labels: ['birth date', 'date of birth'],
  },
  { key: 'display_name', policy: asIdentity(), labels: ['display name', 'full name'] },
  { key: 'person_id', policy: asIdentity(), labels: ['person id'] },
];
