import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setLocale } from './src/lib/intl';

// The stories and fixtures are the code's own British English: dates read as an en-GB reader sees them.
setLocale(() => 'en-GB');

afterEach(() => {
  cleanup();
});
