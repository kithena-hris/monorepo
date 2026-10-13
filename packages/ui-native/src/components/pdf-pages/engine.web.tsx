import { useEffect, useRef } from 'react';

import { ENGINE_HTML, parseMessage, type EngineMessage } from './engine-html.ts';

/** The little of the DOM this needs: Reach Native compiles without the DOM's types. */
interface Frame {
  readonly contentWindow: { postMessage: (message: unknown, origin: string) => void } | null;
}
interface Heard {
  readonly source: unknown;
  readonly data: unknown;
}
const page = globalThis as unknown as {
  addEventListener: (type: 'message', listener: (event: Heard) => void) => void;
  removeEventListener: (type: 'message', listener: (event: Heard) => void) => void;
};

/** Under react-native-web: the same page in a hidden frame (`engine-html.ts`). */
export function PdfEngine({
  src,
  width,
  onMessage,
}: {
  readonly src: string;
  readonly width: number;
  readonly onMessage: (message: EngineMessage) => void;
}): React.JSX.Element {
  const frame = useRef<Frame>(null);
  const told = useRef(onMessage);
  told.current = onMessage;
  useEffect(() => {
    const heard = (event: Heard) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parseMessage(event.data);
      if (message === null) return;
      if (message.type === 'ready')
        frame.current?.contentWindow?.postMessage({ type: 'render', src, width }, '*');
      else told.current(message);
    };
    page.addEventListener('message', heard);
    return () => {
      page.removeEventListener('message', heard);
    };
  }, [src, width]);
  return (
    <iframe
      ref={frame as never}
      srcDoc={ENGINE_HTML}
      title="PDF renderer"
      aria-hidden
      tabIndex={-1}
      style={{ position: 'absolute', width: 0, height: 0, border: 0, visibility: 'hidden' }}
    />
  );
}
