import { Avatar, type AvatarSize } from '@reach/ui-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';

import { ask, useSigned, type Signed } from './api';

/**
 * Photos and files, as the web's shell handles them (`people-screen.tsx`):
 * a photo shrunk to People's 512-pixel square JPEG on the device, every file
 * PUT straight to storage at the address People signed, never through the
 * company's server, and People told it is there.
 *
 * Reading one back is People's `Photo` and `File`, as the person signed in:
 * a photo arrives as base64 and is drawn from a data URI, so no image route
 * has to accept a bearer, and is kept in memory for the life of the app.
 */

/** Photos read so far, by person and the version their address names. */
const photos = new Map<string, string | null>();

/** A person's photo as a data URI, once read; undefined where they have none or it is on its way. */
export function usePhoto(
  personId: string | null,
  avatarUrl: string | null | undefined,
): string | undefined {
  const signed = useSigned();
  const key = personId === null || avatarUrl == null ? null : `${personId}\n${avatarUrl}`;
  const [uri, setUri] = useState<string | null | undefined>(key === null ? null : photos.get(key));
  useEffect(() => {
    if (key === null || personId === null) {
      setUri(null);
      return undefined;
    }
    const held = photos.get(key);
    if (held !== undefined) {
      setUri(held);
      return undefined;
    }
    let live = true;
    void ask<{ mediaType: string; data: string }>(signed, 'Photo', { personId }).then((answer) => {
      const read =
        answer.ok &&
        (answer.data.mediaType === 'image/png' || answer.data.mediaType === 'image/jpeg')
          ? `data:${answer.data.mediaType};base64,${answer.data.data}`
          : null;
      photos.set(key, read);
      if (live) setUri(read);
    });
    return () => {
      live = false;
    };
  }, [signed, key, personId]);
  return uri ?? undefined;
}

/** A person's face: their photo where they have one, their initials until then. */
export function PersonAvatar({
  personId,
  name,
  avatarUrl,
  size,
  status,
}: {
  personId: string | null;
  name: string;
  avatarUrl: string | null | undefined;
  size?: AvatarSize;
  status?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}): React.JSX.Element {
  const src = usePhoto(personId, avatarUrl);
  return (
    <Avatar
      name={name}
      {...(size === undefined ? {} : { size })}
      {...(src === undefined ? {} : { src })}
      {...(status === undefined ? {} : { status })}
      decorative
    />
  );
}

type Target = {
  uploadId: string;
  url: string;
  method: string;
  headers: { name: string; value: string }[];
};

/** PUT a picked file to the address People signed, with exactly the headers it signed. */
async function put(target: Target, body: Blob): Promise<boolean> {
  const response = await fetch(target.url, {
    method: target.method,
    headers: Object.fromEntries(
      target.headers.filter((h) => h.name !== 'content-length').map((h) => [h.name, h.value]),
    ),
    body,
  }).catch(() => null);
  return response?.ok === true;
}

const blobOf = async (uri: string): Promise<Blob> => (await fetch(uri)).blob();

export type Uploaded<T> = { ok: true; value: T } | { ok: false; message: string } | null;

/**
 * A new photo for `personId`, or the viewer's own: picked from the library,
 * cropped square on the phone, shrunk to 512 pixels as a JPEG, uploaded, and
 * kept by People. Null when the picker was closed.
 */
export async function changePhoto(
  signed: Signed,
  personId: string | null,
): Promise<Uploaded<string | null>> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (asset === undefined) return null;
  const side = Math.min(asset.width, asset.height, 512);
  const image = await ImageManipulator.manipulate(asset.uri)
    .resize({ width: side, height: side })
    .renderAsync();
  const small = await image.saveAsync({ compress: 0.86, format: SaveFormat.JPEG });
  const body = await blobOf(small.uri);

  const target = await ask<Target>(signed, 'StartPhotoUpload', { personId, size: body.size });
  if (!target.ok) return { ok: false, message: target.message };
  if (!(await put(target.data, body))) {
    return { ok: false, message: 'The upload did not go through; try again.' };
  }
  const done = await ask<{ avatarUrl: string | null }>(signed, 'CompletePhotoUpload', {
    personId,
    uploadId: target.data.uploadId,
  });
  if (!done.ok) return { ok: false, message: done.message };
  photos.clear();
  return { ok: true, value: done.data.avatarUrl };
}

/** Taking a photo off a record: the initials come back. */
export async function removePhoto(signed: Signed, personId: string | null): Promise<string | null> {
  const done = await ask(signed, 'RemovePhoto', { personId });
  photos.clear();
  return done.ok ? null : done.message;
}

export interface FileInfo {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
}

/**
 * A file for an image or document field: picked, an image People cannot read
 * as it is (a HEIC a phone made) redrawn as a JPEG, uploaded and kept. The
 * field's value is then the file's id, which the form saves like any other.
 */
export async function uploadFile(
  signed: Signed,
  personId: string | null,
  field: string,
  kind: 'image' | 'document',
): Promise<Uploaded<FileInfo>> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: kind === 'image' ? ['image/*'] : ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (asset === undefined) return null;
  const readable =
    asset.mimeType === undefined ||
    !asset.mimeType.startsWith('image/') ||
    asset.mimeType === 'image/png' ||
    asset.mimeType === 'image/jpeg';
  const uri = readable
    ? asset.uri
    : (
        await (
          await ImageManipulator.manipulate(asset.uri).renderAsync()
        ).saveAsync({
          compress: 0.9,
          format: SaveFormat.JPEG,
        })
      ).uri;
  const name = readable ? asset.name : `${asset.name.replace(/\.[^.]*$/, '')}.jpg`;
  const body = await blobOf(uri);

  const target = await ask<Target>(signed, 'StartFileUpload', {
    personId,
    field,
    name: name.slice(0, 255),
    size: body.size,
  });
  if (!target.ok) return { ok: false, message: target.message };
  if (!(await put(target.data, body))) {
    return { ok: false, message: 'The upload did not go through; try again.' };
  }
  const done = await ask<FileInfo>(signed, 'CompleteFileUpload', {
    personId,
    field,
    uploadId: target.data.uploadId,
  });
  return done.ok ? { ok: true, value: done.data } : { ok: false, message: done.message };
}

/** A field's file, opened in the phone's own viewer and share sheet. Null when it opened. */
export async function openFile(signed: Signed, id: string): Promise<string | null> {
  const read = await ask<{ name: string; mediaType: string; data: string }>(signed, 'File', { id });
  if (!read.ok) return read.message;
  const file = new File(Paths.cache, read.data.name.replace(/[/\\]/g, '_'));
  if (file.exists) file.delete();
  file.create();
  file.write(read.data.data, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, { mimeType: read.data.mediaType });
  return null;
}
