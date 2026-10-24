import './phone.css';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setLocale } from '@reach/ui';

// The fixtures are the code's own British English: dates and numbers read as an en-GB reader sees them.
setLocale(() => 'en-GB');

afterEach(() => {
  cleanup();
});
