import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RichTextContent } from './rich-text';
import { RichTextEditorBody } from './rich-text-editor';
import { RichTextFrame } from './rich-text-frame';

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

describe('<RichTextFrame> counter', () => {
  it('counts words where asked, and characters otherwise', () => {
    const { getByText, rerender } = render(
      <RichTextFrame label="Strengths" showCount countUnit="words" used={21} words={4} />,
    );
    expect(getByText('4 words')).toBeInTheDocument();
    rerender(<RichTextFrame label="Strengths" showCount countUnit="words" used={5} words={1} />);
    expect(getByText('1 word')).toBeInTheDocument();
    rerender(<RichTextFrame label="Strengths" showCount used={21} words={4} />);
    expect(getByText('21 characters')).toBeInTheDocument();
  });
});

describe('<RichTextEditor> value', () => {
  // A draft written elsewhere (an AI prefill, a newer revision) arrives as a
  // new value after mount; the editor has to show it, not its first one.
  it('follows a value changed from outside', async () => {
    const { container, rerender } = render(<RichTextEditorBody label="Strengths" value="" />);
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).not.toBeNull();
    });
    rerender(<RichTextEditorBody label="Strengths" value="<p>Ships on time.</p>" />);
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toHaveTextContent('Ships on time.');
    });
  });
});
