import { asSpecialCategory, asIdentity } from '@kithena/contracts';
import {
  aiGateway,
  createPolicyRegistry,
  type AiGateway,
  type ModelTransport,
  type TenantField,
} from '@kithena/telemetry';

/**
 * Time Off's door to a model: the AI gateway (`@kithena/telemetry`), as
 * People's assistant uses it, with Time Off's own refusals loaded for every
 * tenant.
 *
 * Time Off defines no fields per tenant, so the registry would know nothing a
 * tenant set and refuse it as unloaded. Instead every tenant gets the same
 * list: the keys and words that would mean health data or somebody's identity
 * had reached a prompt. A prompt carrying one of these keys at any depth, or
 * naming one of these words in its text, is refused whole and the caller's
 * template is shown. The features never build such a prompt (each has a test
 * saying so); this is the second lock.
 */
const DENIED: readonly TenantField[] = [
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

/** A gateway over `send` that refuses Time Off's denied keys and words for any tenant. */
export function timeOffGateway(send: ModelTransport): AiGateway {
  const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
  const gateway = aiGateway({ registry, send });
  return {
    complete(tenantId, prompt, subjects) {
      if (!registry.isLoaded(tenantId)) registry.replace(tenantId, DENIED);
      return gateway.complete(tenantId, prompt, subjects);
    },
  };
}
