import type { SignatureValue } from '@reach/ui-native';

/** A signature from the JSON text People keeps it as; null for none, or for text that is not one. */
export function markOf(text: string | undefined): SignatureValue | null {
  if (text === undefined || text === '') return null;
  try {
    const m = JSON.parse(text) as Partial<{
      kind: string;
      text: string;
      style: string;
      path: string;
    }>;
    if (m.kind === 'drawn' && typeof m.path === 'string') return { kind: 'drawn', path: m.path };
    if (m.kind === 'typed' && typeof m.text === 'string')
      return {
        kind: 'typed',
        text: m.text,
        style: m.style === 'light' || m.style === 'bold' ? m.style : 'flowing',
      };
    return null;
  } catch {
    return null;
  }
}
