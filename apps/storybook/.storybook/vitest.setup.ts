import * as a11yAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';

import preview from './preview.js';

// Stories run under Vitest with the same decorators and parameters they get in
// the canvas: otherwise the test is checking a component nobody ships.
//
// The a11y addon's annotations are listed here because a setup file that calls
// `setProjectAnnotations` turns off `@storybook/addon-vitest`'s own
// provisioning (Storybook 10.3). Without them axe never runs in this suite and
// `parameters.a11y.test: 'error'` in the preview asks for a check nothing
// performs. `a11y-gate.stories.tsx` proves it runs: its one story breaks axe on
// purpose and its `play` asserts the violations are reported.
const project = setProjectAnnotations([a11yAnnotations, preview]);

beforeAll(project.beforeAll);

/*
 * axe builds its rule caches on its first run, and each story file runs in a
 * fresh frame, so the first story of every file paid for that: 4 to 6 s here,
 * nearer 15 on a CI runner, which is the test timeout. Paid once per file in
 * setup instead, as the People app's own setup does, where it counts against
 * the hook timeout rather than a story. The a11y addon imports the same module.
 */
beforeAll(async () => {
  const { default: axe } = await import('axe-core');
  await axe.run(document.body);
});
