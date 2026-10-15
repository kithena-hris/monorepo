/**
 * Keeps each caption a page's 6pt under the ink of its box: now, when the
 * page is drawn at another size, and when a handwriting face arrives.
 * Answers how to stop.
 */
export function hug(
  host: HTMLElement,
  captions: ReadonlyMap<string, HTMLElement>,
  boxes: ReadonlyMap<string, HTMLElement>,
): () => void {
  const place = () => {
    const r = host.getBoundingClientRect();
    for (const [id, caption] of captions) {
      const bottom = inkBottom(boxes.get(id));
      if (bottom > -Infinity) caption.style.top = `${String(bottom - r.top + r.width / 99)}px`;
    }
  };
  place();
  const resized = new ResizeObserver(place);
  resized.observe(host);
  void document.fonts.ready.then(place);
  return () => {
    resized.disconnect();
  };
}

/**
 * Where what a box draws really ends, in the viewport's pixels: a drawing's
 * strokes, and each text's glyphs, which a handwriting face draws well above
 * the foot of its line. -Infinity when it draws nothing.
 */
function inkBottom(box: HTMLElement | undefined): number {
  let bottom = -Infinity;
  const ctx = document.createElement('canvas').getContext('2d');
  if (box === undefined || ctx === null) return bottom;
  for (const shape of box.querySelectorAll('path')) {
    bottom = Math.max(bottom, shape.getBoundingClientRect().bottom);
  }
  const range = document.createRange();
  const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node?.parentElement; node = walk.nextNode()) {
    const face = getComputedStyle(node.parentElement);
    ctx.font = `${face.fontStyle} ${face.fontWeight} ${face.fontSize} ${face.fontFamily}`;
    const m = ctx.measureText(node.textContent ?? '');
    range.selectNodeContents(node);
    // The line's foot less the face's descender is the baseline; the glyphs end below it by their own.
    bottom = Math.max(
      bottom,
      range.getBoundingClientRect().bottom - m.fontBoundingBoxDescent + m.actualBoundingBoxDescent,
    );
  }
  return bottom;
}
