import { describe, expect, it } from 'vitest';

import type { SchemaDocument } from '../domain/schema/publish.js';
import { withCurrentAiChoice } from './policy-registry.js';

type Attributes = SchemaDocument['attributes'];
const attribute = (key: string, aiEligible: boolean, classification = 'internal') =>
  ({
    key,
    classification: { classification, piiKind: 'none', exportable: true, aiEligible },
  }) as unknown as Attributes[number];

describe('sharing with the assistant follows the version in force', () => {
  it('takes the current choice for every version of a field, and leaves the rest as they were', () => {
    const every = [
      attribute('location_id', false),
      attribute('location_id', true),
      attribute('old_field', false, 'confidential'),
    ];
    const out = withCurrentAiChoice(every, [attribute('location_id', true)]);
    expect(out.map((a) => [a.key, a.classification.aiEligible])).toEqual([
      ['location_id', true],
      ['location_id', true],
      // Withdrawn since: its last word stands.
      ['old_field', false],
    ]);
    // Only the assistant's choice moves; how strictly a value is redacted does not.
    expect(out[2]?.classification.classification).toBe('confidential');
  });
});
