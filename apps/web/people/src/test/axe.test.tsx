import { render } from '@testing-library/react';
import { expect, it } from 'vitest';

import { axeViolations } from './axe';

// Every screen test asserts `axeViolations(...)` is empty; that is only a check
// if a page that breaks axe comes back with something.
it('reports an unnamed button', async () => {
  const { container } = render(
    <button type="button">
      <svg aria-hidden="true" />
    </button>,
  );
  expect((await axeViolations(container)).map((v) => v.split(':')[0])).toContain('button-name');
});
