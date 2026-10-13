'use client';

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import type * as PdfJsModule from 'pdfjs-dist';

import { cn } from '../../lib/cn';
import { Alert, Skeleton } from '../feedback/feedback';

/**
 * A PDF's pages drawn on the page itself, with something laid over each one:
 * where to sign, where somebody signed.
 *
 * ### Why not the browser's own viewer
 *
 * An `<iframe>` shows a PDF and nothing can be drawn on it: its scroll, its
 * zoom and its page positions are the browser's. pdf.js (Mozilla's, the
 * viewer Firefox itself uses) draws each page into a canvas this component
 * owns, so a box placed at 40% across page 3 is at 40% across page 3 at any
 * width, on any screen.
 *
 * ### Fast
 *
 * pdf.js loads only when a document is shown, in a worker off the main
 * thread. Every page's size is read first, so the column is its full height
 * at once and nothing jumps; a page is drawn only as it nears the screen, at
 * the screen's own pixel density, and drawn again only when its width
 * changes by more than a step.
 *
 * Overlays are positioned in percent of their page (`left: 40%`), so they
 * need no pixel arithmetic and stay put while a page is drawn or resized.
 */

/** One page, its size in PDF points. */
export interface PdfPage {
  readonly number: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPagesProps {
  /** The file: a URL the browser may fetch, or its bytes. */
  readonly src: string | Uint8Array;
  /** What the document is called: "Offer letter". Each page is "Offer letter, page 2 of 3". */
  readonly label: string;
  /** Drawn over each page, filling it; position children in percent of the page. */
  readonly overlay?: (page: PdfPage) => ReactNode;
  readonly onLoad?: (pages: readonly PdfPage[]) => void;
  readonly className?: string;
}

type PdfJs = typeof PdfJsModule;
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let pdfjs: Promise<PdfJs> | undefined;
/** pdf.js and its worker, once per page load: the worker's own origin is pdf.js's to handle. */
const loadPdfJs = (): Promise<PdfJs> =>
  (pdfjs ??= import('pdfjs-dist').then((lib) => {
    // A relative path, which every bundler here (Turbopack, webpack, Vite)
    // turns into an asset URL; a bare package name is not resolved by all.
    lib.GlobalWorkerOptions.workerSrc = new URL(
      '../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    return lib;
  }));

export function PdfPages({ src, label, overlay, onLoad, className }: PdfPagesProps): JSX.Element {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [pages, setPages] = useState<readonly PdfPage[]>([]);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(onLoad);
  loaded.current = onLoad;

  useEffect(() => {
    let live = true;
    let loading: { destroy: () => Promise<void> } | null = null;
    setFailed(false);
    void loadPdfJs()
      .then(async (lib) => {
        const task = lib.getDocument({
          ...(typeof src === 'string' ? { url: src } : { data: src.slice() }),
          // One request for the whole file: a signed link answers a range
          // request only where its bucket allows it, and documents are small.
          disableRange: true,
          disableStream: true,
        });
        loading = task;
        const opened = await task.promise;
        const sizes: PdfPage[] = [];
        for (let n = 1; n <= opened.numPages; n++) {
          const page = await opened.getPage(n);
          const { width, height } = page.getViewport({ scale: 1 });
          sizes.push({ number: n, width, height });
        }
        if (!live) return;
        setDoc(opened);
        setPages(sizes);
        loaded.current?.(sizes);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      void loading?.destroy();
    };
  }, [src]);

  if (failed) {
    return (
      <Alert tone="danger" title="The document could not be shown">
        Try again in a moment, or download it to read it.
      </Alert>
    );
  }
  if (doc === null) return <Skeleton shape="page" label={`Opening ${label}`} />;
  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {pages.map((p) => (
        <div
          key={p.number}
          className="relative w-full overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-border"
          style={{ aspectRatio: `${String(p.width)} / ${String(p.height)}` }}
        >
          <PageCanvas
            doc={doc}
            page={p}
            label={`${label}, page ${String(p.number)} of ${String(pages.length)}`}
          />
          {overlay === undefined ? null : <div className="absolute inset-0">{overlay(p)}</div>}
        </div>
      ))}
    </div>
  );
}

/** Drawn again only when the width changes by more than this many CSS pixels. */
const STEP = 120;

function PageCanvas({
  doc,
  page,
  label,
}: {
  readonly doc: PdfDocument;
  readonly page: PdfPage;
  readonly label: string;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (el === null || el === undefined) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) setNear(true);
      },
      { rootMargin: '800px 0px' },
    );
    const sized = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      setWidth((was) => (Math.abs(w - was) > STEP || was === 0 ? Math.ceil(w / STEP) * STEP : was));
    });
    seen.observe(el);
    sized.observe(el);
    return () => {
      seen.disconnect();
      sized.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near || width === 0 || canvas.current === null) return;
    const target = canvas.current;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let live = true;
    void doc.getPage(page.number).then((p) => {
      if (!live) return;
      const scale = (width * Math.min(window.devicePixelRatio || 1, 3)) / page.width;
      const viewport = p.getViewport({ scale });
      target.width = Math.round(viewport.width);
      target.height = Math.round(viewport.height);
      const context = target.getContext('2d');
      if (context === null) return;
      task = p.render({ canvas: target, canvasContext: context, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, near, page, width]);

  return (
    <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 size-full" />
  );
}
