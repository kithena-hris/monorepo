import { SignatureMark } from '@kithena/contracts/signature';
import type { SignatureValue } from '@reach/ui-native';

/**
 * A signature from the JSON text People keeps it as, read by the contract's
 * own schema, as the web reads it (`my-signature.ts`): the same refusals,
 * so the phone never draws a mark the server would not sign with. Null for
 * none, or for text that is not one.
 */
export function markOf(text: string | undefined): SignatureValue | null {
  if (text === undefined || text === '') return null;
  try {
    const parsed = SignatureMark.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
