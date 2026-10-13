import { useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ENGINE_HTML, PDFJS, parseMessage, type EngineMessage } from './engine-html.ts';

/**
 * pdf.js in a web view nobody sees (`engine-html.ts`). Its address is pdf.js's
 * own, so the worker it starts is same-origin and runs off the page's thread.
 */
export function PdfEngine({
  src,
  width,
  onMessage,
}: {
  readonly src: string;
  readonly width: number;
  readonly onMessage: (message: EngineMessage) => void;
}): React.JSX.Element {
  const view = useRef<WebView>(null);
  return (
    <View style={{ width: 0, height: 0, overflow: 'hidden' }} pointerEvents="none">
      <WebView
        ref={view}
        source={{ html: ENGINE_HTML, baseUrl: PDFJS }}
        originWhitelist={['*']}
        style={{ width: 1, height: 1, opacity: 0 }}
        onMessage={(event) => {
          const message = parseMessage(event.nativeEvent.data);
          if (message === null) return;
          if (message.type === 'ready')
            view.current?.injectJavaScript(
              `window.render(${JSON.stringify(src)}, ${String(width)}); true;`,
            );
          else onMessage(message);
        }}
        onError={() => {
          onMessage({ type: 'failed' });
        }}
      />
    </View>
  );
}
