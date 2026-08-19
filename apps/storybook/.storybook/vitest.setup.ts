import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';

import preview from './preview.js';

// Stories run under Vitest with the same decorators and parameters they get in
// the canvas: otherwise the test is checking a component nobody ships.
const project = setProjectAnnotations([preview]);

beforeAll(project.beforeAll);
