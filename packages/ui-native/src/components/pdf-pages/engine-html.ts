/**
 * The page that turns a PDF into pictures, for `PdfPages`: pdf.js (Mozilla's,
 * the viewer Firefox itself uses) in a web view on a device and in a hidden
 * frame under react-native-web. It draws each page to a canvas and posts it
 * back as a JPEG, so everything the person sees and presses is native.
 *
 * It answers `ready` once pdf.js is in, then `sizes` (every page's size in PDF
 * points, before anything is drawn, so the column is its full height at once)
 * and one `page` per page, in order, as each is drawn.
 */

/** pdf.js, the version Reach's web `PdfPages` draws with. */
export const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/';

export interface EnginePage {
  readonly number: number;
  readonly width: number;
  readonly height: number;
}

export type EngineMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'sizes'; readonly pages: readonly EnginePage[] }
  | { readonly type: 'page'; readonly number: number; readonly uri: string }
  | { readonly type: 'failed' };

export const parseMessage = (data: unknown): EngineMessage | null => {
  try {
    const m: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    return typeof m === 'object' && m !== null && 'type' in m ? (m as EngineMessage) : null;
  } catch {
    return null;
  }
};

/** `render(src, width)`: a URL the page may fetch or a `data:` URL, drawn `width` pixels wide. */
export const ENGINE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as pdfjs from '${PDFJS}pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '${PDFJS}pdf.worker.min.mjs';
const post = (m) => {
  const s = JSON.stringify(m);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else window.parent.postMessage(s, '*');
};
window.render = async (src, width) => {
  try {
    // pdf.js fetches only http(s): a data URL's bytes are handed over as they are.
    const source = src.startsWith('data:')
      ? { data: Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (c) => c.charCodeAt(0)) }
      : { url: src };
    // Glyphs drawn from the file's own fonts, never handed to the browser as web
    // fonts: a subset it refuses (a signature's handwriting face) is otherwise
    // not drawn at all. As Reach's web PdfPages.
    const task = pdfjs.getDocument({
      ...source,
      disableRange: true,
      disableStream: true,
      disableFontFace: true,
    });
    const doc = await task.promise;
    const sizes = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 });
      sizes.push({ number: n, width: v.width, height: v.height });
    }
    post({ type: 'sizes', pages: sizes });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    for (const s of sizes) {
      const page = await doc.getPage(s.number);
      const viewport = page.getViewport({ scale: width / s.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      post({ type: 'page', number: s.number, uri: canvas.toDataURL('image/jpeg', 0.9) });
    }
    void task.destroy();
  } catch {
    post({ type: 'failed' });
  }
};
window.addEventListener('message', (e) => {
  const m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  if (m && m.type === 'render') window.render(m.src, m.width);
});
post({ type: 'ready' });
</script></body></html>`;
