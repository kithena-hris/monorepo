import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import {
  PixelRatio,
  type LayoutChangeEvent,
  type ScrollView as NativeScrollView,
} from 'react-native';
import { Image, ScrollView, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Alert, Skeleton } from '../feedback/feedback.tsx';
// Extensionless on purpose: Metro takes `engine.tsx` (a web view) on a device,
// and react-native-web's bundlers take `engine.web.tsx` (a frame).
import { PdfEngine } from './engine';
import type { EngineMessage } from './engine-html.ts';
import { t } from '../../lib/i18n';

/**
 * A PDF's pages, the web's `PdfPages` on a phone: each page drawn as a
 * picture, with something laid over it — where to sign, what was signed.
 *
 * ### How it draws
 *
 * A phone has no PDF view that can be drawn on, so pdf.js turns each page
 * into a picture in a web view nobody sees (`engine-html.ts`), and the pages,
 * and whatever is laid over them, are native. Every page's size comes first,
 * so the column is its full height at once and nothing jumps; then the pages
 * arrive in order, the first in a moment.
 *
 * The column scrolls itself: give it the rest of the screen (`flex-1`).
 * Overlays are positioned in percent of their page, and `usePdfPage().reveal`
 * scrolls a point of a page into the middle of the screen (`PlacementLayer`'s
 * `focus` uses it).
 */

export interface PdfPage {
  readonly number: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPagesProps {
  /** The file: a URL the web view may fetch, or a `data:application/pdf;base64,…` URL of its bytes. */
  readonly src: string;
  /** What the document is called: "Offer letter". Each page is "Offer letter, page 2 of 3". */
  readonly label: string;
  /** Drawn over each page, filling it; position children in percent of the page. */
  readonly overlay?: (page: PdfPage) => ReactNode;
  readonly onLoad?: (pages: readonly PdfPage[]) => void;
  readonly className?: string | undefined;
}

/** Sharper than this costs memory a phone notices on a long document, and shows nothing more. */
const MAX_DENSITY = 2;
const GAP = 12;

const PageContext = createContext<{ readonly reveal: (y: number) => void }>({
  reveal: () => undefined,
});

/** The page an overlay is on: `reveal(0.4)` scrolls 40% down it into the middle of the screen. */
export const usePdfPage = (): { readonly reveal: (y: number) => void } => useContext(PageContext);

export function PdfPages({
  src,
  label,
  overlay,
  onLoad,
  className,
}: PdfPagesProps): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [pages, setPages] = useState<readonly PdfPage[]>([]);
  const [pictures, setPictures] = useState<Readonly<Record<number, string>>>({});
  const [failed, setFailed] = useState(false);
  const scroll = useRef<NativeScrollView>(null);
  const tops = useRef(new Map<number, number>());

  const heard = (message: EngineMessage) => {
    if (message.type === 'failed') setFailed(true);
    else if (message.type === 'sizes') {
      setPages(message.pages);
      onLoad?.(message.pages);
    } else if (message.type === 'page')
      setPictures((was) => ({ ...was, [message.number]: message.uri }));
  };

  if (failed) {
    return (
      <Alert
        tone="danger"
        title={t(
          'components.pdf-pages.pdf-pages.the_document_could_not_be_shown',
          'The document could not be shown',
        )}
      >
        {t(
          'components.pdf-pages.pdf-pages.check_the_connection_and_open_it',
          'Check the connection and open it again.',
        )}
      </Alert>
    );
  }
  return (
    <View
      className={cn('flex-1', className)}
      onLayout={(e: LayoutChangeEvent) => {
        if (width === 0) setWidth(Math.round(e.nativeEvent.layout.width));
        setHeight(e.nativeEvent.layout.height);
      }}
    >
      {width === 0 ? null : (
        <PdfEngine
          key={src}
          src={src}
          width={Math.round(width * Math.min(PixelRatio.get(), MAX_DENSITY))}
          onMessage={heard}
        />
      )}
      {pages.length === 0 ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('components.pdf-pages.pdf-pages.opening', 'Opening {{label}}', {
            label,
          })}
          className="gap-3"
        >
          <Skeleton className="aspect-[0.77] w-full rounded-sm" />
        </View>
      ) : (
        <ScrollView ref={scroll} contentContainerStyle={{ gap: GAP, paddingBottom: GAP }}>
          {pages.map((p) => {
            const picture = pictures[p.number];
            const reveal = (y: number) => {
              const top = tops.current.get(p.number) ?? 0;
              const at = top + y * width * (p.height / p.width) - height / 2;
              scroll.current?.scrollTo({ y: Math.max(0, at), animated: true });
            };
            return (
              <View
                key={p.number}
                onLayout={(e: LayoutChangeEvent) => {
                  tops.current.set(p.number, e.nativeEvent.layout.y);
                }}
                className="w-full overflow-hidden rounded-sm border border-border bg-white"
                style={{ aspectRatio: p.width / p.height }}
              >
                {picture === undefined ? (
                  <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
                ) : (
                  <Image
                    accessible
                    source={{ uri: picture }}
                    accessibilityLabel={t(
                      'components.pdf-pages.pdf-pages.page_of',
                      '{{label}}, page {{String}} of {{String2}}',
                      { label, String: String(p.number), String2: String(pages.length) },
                    )}
                    className="absolute inset-0 h-full w-full"
                    resizeMode="contain"
                  />
                )}
                {overlay === undefined ? null : (
                  <PageContext value={{ reveal }}>
                    <View className="absolute inset-0">{overlay(p)}</View>
                  </PageContext>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
