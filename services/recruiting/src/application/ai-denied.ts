import { asIdentity, asSpecialCategory } from '@kithena/contracts';
import type { TenantField } from '@kithena/telemetry';

/**
 * The fields no prompt of Recruiting's may carry, and the words that would
 * mean one had reached a prompt anyway (PRD §22.2 point 3): special-category
 * data and who the person is. The masking (`domain/ai/mask.ts`) removes them
 * first; the AI gateway refuses a prompt that still names one, whole. Two
 * locks, so a CV the masking misread costs a refusal, not a disclosure. The
 * keys and labels are phrases, not words like "health" or "race", which a
 * healthcare designer's or an engineer's CV uses about their work.
 */
export const DENIED: readonly TenantField[] = [
  {
    key: 'health_condition',
    policy: asSpecialCategory('health'),
    // Not "sick leave": an ad's benefits name it.
    labels: ['diagnosis', 'medical condition', 'chronic illness'],
  },
  {
    key: 'religious_belief',
    policy: asSpecialCategory('health'),
    labels: ['religious belief', 'religious affiliation'],
  },
  { key: 'ethnic_origin', policy: asSpecialCategory('health'), labels: ['racial origin'] },
  {
    key: 'sexual_orientation',
    policy: asSpecialCategory('health'),
    labels: ['sexual orientation'],
  },
  {
    key: 'union_membership',
    policy: asSpecialCategory('health'),
    labels: ['trade union membership', 'union membership'],
  },
  {
    key: 'criminal_record',
    policy: asSpecialCategory('health'),
    labels: ['criminal record', 'criminal conviction'],
  },
  { key: 'self_id', policy: asSpecialCategory('health'), labels: ['self-identification'] },
  { key: 'birth_date', policy: asIdentity(), labels: ['date of birth', 'birth date'] },
  { key: 'full_name', policy: asIdentity(), labels: ['full name'] },
];
