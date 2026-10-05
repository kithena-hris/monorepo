import * as a11yAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/react-native-web-vite';
import axe from 'axe-core';
import { beforeAll } from 'vitest';

import preview from './preview.js';

// As in the web Storybook: a setup file that calls `setProjectAnnotations`
// turns off the addon's own provisioning, so the a11y annotations are listed
// here or axe never runs.
const project = setProjectAnnotations([a11yAnnotations, preview]);

beforeAll(project.beforeAll);

// Warm axe's rule caches once per file rather than in the first story.
beforeAll(async () => {
  await axe.run(document.body);
});
