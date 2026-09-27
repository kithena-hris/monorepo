// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AvatarUploader } from './image-uploader';

/**
 * A stored image drawn on the server, where there is no document to resolve a
 * path against.
 */
describe('AvatarUploader, rendered on the server', () => {
  const html = (src: string) =>
    renderToString(<AvatarUploader label="Photo" value={[]} onChange={() => undefined} src={src} />);

  it('keeps a same-origin path a path, rather than naming localhost', () => {
    expect(html('/people/photos/a1?v=0f3a')).toContain('src="/people/photos/a1?v=0f3a"');
  });

  it('still refuses what is not a picture, and keeps a full URL whole', () => {
    expect(html('javascript:alert(1)')).not.toContain('<img');
    expect(html('//evil.example/x.png')).not.toContain('<img');
    expect(html('https://cdn.example/a.png')).toContain('src="https://cdn.example/a.png"');
  });
});
