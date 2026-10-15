import { describe, expect, it } from 'vitest';

import { gatewayModel } from './model.js';

describe("Recruiting's model, behind the AI gateway", () => {
  const sent: string[] = [];
  const model = gatewayModel('test-model', (prompt) => {
    sent.push(JSON.stringify(prompt.context));
    return Promise.resolve('{"ok":true}');
  });
  const tenant = '01890000-0000-7000-8000-000000000001';

  it('passes a masked application on', async () => {
    const answer = await model.complete(tenant, {
      instruction: 'Read the evidence.',
      context: { application: 'Led design for a healthcare start-up, 2018 - 2022.' },
    });
    expect(answer).toBe('{"ok":true}');
    expect(sent).toHaveLength(1);
  });

  it('refuses, whole, a prompt that still names special-category data', async () => {
    const answer = await model.complete(tenant, {
      instruction: 'Read the evidence.',
      context: { application: 'I disclose my criminal record and a chronic illness.' },
    });
    expect(answer).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
