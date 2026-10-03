import { peopleCapabilities } from './people.js';
import { timeoffCapabilities } from './timeoff.js';

export * from './capability.js';
export * from './people.js';
export * from './timeoff.js';
export * from './plan.js';
export * from './catalogue.js';

/**
 * Every capability a module serves. A new module registers by adding its file
 * here (assistant PRD §8.6); `just codegen` then classifies its fields.
 */
export const allCapabilities = [...peopleCapabilities, ...timeoffCapabilities] as const;
