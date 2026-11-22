import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Country, countryFlag } from './country';

describe('Country', () => {
  it('makes a flag from a two-letter code and nothing from anything else', () => {
    expect(countryFlag('de')).toBe('🇩🇪');
    expect(countryFlag('DEU')).toBe('');
    expect(countryFlag('')).toBe('');
  });

  it('names the country in words, the flag hidden from a screen reader', () => {
    render(<Country code="DE" />);
    expect(screen.getByText('Germany')).toBeInTheDocument();
  });

  it('names a lone flag, and reads a code as the country', () => {
    render(
      <>
        <Country code="JP" display="flag" />
        <Country code="us" display="code" />
        <Country code="Atlantis" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Japan' })).toHaveTextContent('🇯🇵');
    expect(screen.getByText('United States')).toHaveClass('sr-only');
    expect(screen.getByText('Atlantis')).toBeInTheDocument();
  });

  it('draws the flag in the shape asked for', () => {
    render(<Country code="TW" display="flag" shape="rounded" />);
    expect(screen.getByRole('img', { name: 'Taiwan' })).toHaveClass('rounded-full');
  });
});
