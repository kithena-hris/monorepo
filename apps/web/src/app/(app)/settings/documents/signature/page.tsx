import type { JSX } from 'react';

import { SignatureSettings } from '../../../../../components/signature-settings';
import { mySignature } from '../../../../../lib/my-signature';

/**
 * Settings › Documents › Your signature: the one Documents signs with,
 * kept on the person's record as a field of type `signature`. Changed here
 * only, never while signing; held for HR where the field asks for approval.
 */
export default async function SignatureSettingsPage(): Promise<JSX.Element> {
  return <SignatureSettings mine={await mySignature()} />;
}
