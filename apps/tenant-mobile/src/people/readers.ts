import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { Signed } from './api';

/**
 * Reading rather than typing (Kithena Mobile v3 P15, P19): a photo of an ID
 * card, or an offer letter, sent to the company's own host to be read
 * (`/api/mobile/read`). Only what was read comes back; the host keeps neither.
 * Null when the camera or the picker was closed.
 */

type Read<T> = { ok: true; data: T } | { ok: false; message: string } | null;

/** Base64 grows a file by a third; the host takes 3.2 MB of it. */
const MOST = 3_200_000;

async function send<T>(signed: Signed, kind: 'id-card' | 'offer', data: string): Promise<Read<T>> {
  if (data.length > MOST)
    return { ok: false, message: 'That is too big to read. Try a smaller file.' };
  const response = await fetch(`${signed.company.origin}/api/mobile/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signed.sessionId}` },
    body: JSON.stringify({ kind, data }),
  }).catch(() => null);
  if (response === null) return { ok: false, message: 'Kithena could not be reached. Try again.' };
  if (response.status === 401) {
    signed.signedOut();
    return { ok: false, message: 'Sign in again.' };
  }
  const answer = (await response.json().catch(() => null)) as
    { ok: true; data: T } | { ok: false; message?: string } | null;
  if (answer === null) return { ok: false, message: 'Kithena did not answer.' };
  return answer.ok ? answer : { ok: false, message: answer.message ?? 'That could not be read.' };
}

/** P15: the camera, the photo shrunk to what reading needs, and the identifier on it. */
export async function scanIdCard(signed: Signed): Promise<Read<{ value: string | null }>> {
  const allowed = await ImagePicker.requestCameraPermissionsAsync();
  if (!allowed.granted) return { ok: false, message: 'Kithena needs the camera to read the card.' };
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = shot.canceled ? undefined : shot.assets[0];
  if (asset === undefined) return null;
  const image = await ImageManipulator.manipulate(asset.uri)
    .resize({ width: Math.min(asset.width, 1600) })
    .renderAsync();
  const small = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG, base64: true });
  if (small.base64 === undefined) return { ok: false, message: 'The photo could not be prepared.' };
  return send(signed, 'id-card', small.base64);
}

export interface OfferFacts {
  readonly given: string | null;
  readonly family: string | null;
  readonly email: string | null;
  readonly start: string | null;
  readonly manager: string | null;
}

/** P19: a signed offer letter as a PDF, and what it says about the new starter. */
export async function readOffer(signed: Signed): Promise<Read<OfferFacts>> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (asset === undefined) return null;
  return send(signed, 'offer', await new File(asset.uri).base64());
}
