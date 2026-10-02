import * as a11yAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';

import preview from './preview.js';

// Stories run under Vitest with the same decorators and parameters they get in
// the canvas: otherwise the test is checking a component nobody ships.
//
// The a11y addon's annotations are listed here because a setup file that calls
// `setProjectAnnotations` turns off `@storybook/addon-vitest`'s own
// provisioning (Storybook 10.3). Without them axe never ran in this suite, and
// `parameters.a11y.test: 'error'` in the preview asked for a check nothing
// performed. Turned on for every story, 37 story files fail it today, so for
// now it runs where a story asks for it (`parameters: { a11y: { test: 'error' } }`)
// and is off elsewhere, as it in effect always was. Drop the last entry once
// those stories pass.
const project = setProjectAnnotations([
  a11yAnnotations,
  preview,
  { parameters: { a11y: { test: 'off' } } },
]);

beforeAll(project.beforeAll);
