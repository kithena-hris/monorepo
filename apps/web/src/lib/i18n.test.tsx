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

const days = { one: '{{count}} day', other: '{{count}} days' };

function Counts({ counts }: { readonly counts: readonly number[] }): React.JSX.Element {
  return <p>{counts.map((count) => t('days', days, { count })).join(' · ')}</p>;
}

describe('plural words', () => {
  it('take the form the language gives the number', () => {
    render(
      <I18nProvider
        language="pl"
        messages={{
          people: {
            days_one: '{{count}} dzień',
            days_few: '{{count}} dni',
            days_many: '{{count}} dni',
            days_other: '{{count}} dnia',
          },
        }}
      >
        <Counts counts={[1, 3, 5, 1.5]} />
      </I18nProvider>,
    );
    expect(screen.getByText('1 dzień · 3 dni · 5 dni · 1,5 dnia')).toBeTruthy();
  });

  it('fall back to the English forms when a language has none', () => {
    render(
      <I18nProvider language="de" messages={{ people: {} }}>
        <Counts counts={[1, 2]} />
      </I18nProvider>,
    );
    expect(screen.getByText('1 day · 2 days')).toBeTruthy();
  });
});
