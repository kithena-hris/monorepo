import { describe, expect, it } from 'vitest';
import { LeaveTypeDefinition, RuntimeCatalogue } from '@kithena/contracts';

import { LeaveType } from '../../domain/policy/leave-type.js';
import { caller, hr, people, TENANT, vacationType, world } from '../testing/world.js';
import { capabilityCatalogue } from './capabilities.js';

/** Assistant PRD §8.5: what Time Off offers the assistant, as the asker. */

describe('Time Off’s capability catalogue (AST-022)', () => {
  it('serves away and managers, leave types with private ones marked, teams and the denied words', async () => {
    const app = world();
    const answer = await capabilityCatalogue(app.deps)(caller(people.adam));
    if (!answer.ok) throw new Error(answer.error.message);
    const catalogue = RuntimeCatalogue.parse(answer.value);
    expect(catalogue.module).toBe('timeoff');
    expect(catalogue.serves).toEqual([
      { name: 'timeoff.away', version: 1 },
      { name: 'timeoff.managers', version: 1 },
    ]);
    expect(catalogue.leaveTypes).toEqual([
      { key: 'sick', name: 'Sick', private: true },
      { key: 'vacation', name: 'Vacation', private: false },
    ]);
    const fields = catalogue.fields['timeoff.away'] ?? [];
    expect(fields.map((f) => f.key)).toEqual(['leave_type', 'team']);
    // A private type is never an option by name: the assistant offers it only masked (§12.2).
    expect(fields[0]?.options).toEqual([{ value: 'vacation', label: 'Vacation' }]);
    expect(fields[1]?.options).toEqual([{ value: 'platform', label: 'Platform' }]);
    expect(catalogue.denied.find((d) => d.key === 'sick_note')?.labels).toContain('sick leave');
  });

  it('is configuration only, so HR and an employee are offered the same', async () => {
    const app = world();
    const adam = await capabilityCatalogue(app.deps)(caller(people.adam));
    const ada = await capabilityCatalogue(app.deps)(hr);
    expect(ada).toEqual(adam);
  });

  it('marks a type private by its visibility as well as its category', async () => {
    const app = world();
    const comp = LeaveType.define(
      LeaveTypeDefinition.parse({
        ...vacationType(),
        key: 'comp',
        name: { default: 'Comp' },
        visibility: 'off_only',
      }),
    );
    if (!comp.ok) throw new Error(comp.error.message);
    app.state(TENANT).leaveTypes.set('comp', comp.value);
    const answer = await capabilityCatalogue(app.deps)(hr);
    expect(answer.ok && answer.value.leaveTypes.find((t) => t.key === 'comp')).toEqual({
      key: 'comp',
      name: 'Comp',
      private: true,
    });
  });
});
