import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RichTextContent } from './rich-text';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<RichTextContent>', () => {
  it('renders stored markup as markup rather than as text', () => {
    const { container } = render(
      <RichTextContent sanitisedHtml="<p>Notice period is <strong>3 months</strong>.</p>" />,
    );
    expect(container.querySelector('strong')).toHaveTextContent('3 months');
  });

  // The prop is inserted verbatim, so the only defence at this layer is that a
  // mistake is loud. These cases are the ones that mean a server sanitiser was
  // skipped entirely, not the ones a clever payload would use: a filter here
  // would be a filter the attacker gets to choose the input to.
  it.each([
    ['a script tag', '<p>ok</p><script>fetch("/x")</script>'],
    ['an inline handler', '<p onmouseover="steal()">salary</p>'],
    ['a javascript: URL', '<a href="javascript:alert(1)">offer</a>'],
    ['an embedded frame', '<iframe src="https://example.test"></iframe>'],
  ])('complains when the markup contains %s', (_label, html) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RichTextContent sanitisedHtml={html} />);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('inserted verbatim'));
  });

  it('stays quiet for markup the editor itself produces', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <RichTextContent sanitisedHtml='<p>See the <a href="https://example.test">policy</a>.</p><ul><li>Accrual</li></ul>' />,
    );
    expect(error).not.toHaveBeenCalled();
  });
});
