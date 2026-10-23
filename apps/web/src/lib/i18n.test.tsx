// @vitest-environment jsdom
import { translator } from '@reach/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from './i18n';

const t = translator('people');

function Words(): React.JSX.Element {
  return (
    <p>
      {t('greeting', 'Hello {{name}}', { name: 'Ada' })} · {t('missing', 'Not translated')}
    </p>
  );
}

describe('I18nProvider', () => {
  it('answers each t in the page’s language, and in English what it has no words for', () => {
    render(
      <I18nProvider language="de" messages={{ people: { greeting: 'Hallo {{name}}' } }}>
        <Words />
      </I18nProvider>,
    );
    expect(screen.getByText('Hallo Ada · Not translated')).toBeTruthy();
  });
});
