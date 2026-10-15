import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { onboardingEvents } from './onboarding.js';

/** Onboarding's events name a plan, a task and a person by id, never by what they hold (§O2). */
function keysOf(schema: z.ZodType, out = new Set<string>()): Set<string> {
  if (schema instanceof z.ZodObject)
    for (const [key, child] of Object.entries(schema.shape)) {
      out.add(key);
      if (child instanceof z.ZodType) keysOf(child, out);
    }
  return out;
}

describe('no Onboarding payload carries a name, an address or an answer', () => {
  it.each(onboardingEvents.map((e) => [e.name, e] as const))('%s', (_name, event) => {
    const keys = [...keysOf(event.payload)];
    expect(keys.filter((k) => /name|email|phone|address|answer|text|comment/iu.test(k))).toEqual(
      [],
    );
  });
});
