/*
 * Files on a phone, as the uploaders see them. Reach never opens a picker
 * itself: an app passes `pick`, which opens its own (expo-image-picker,
 * expo-document-picker, the share sheet) and resolves to what was chosen.
 * Reach stays presentational and free of native modules, and the checks here
 * run on whatever came back.
 *
 * Every check is a usability filter, never a security control: a type comes
 * from a name, and a name can lie. The server re-derives the type from the
 * bytes and enforces the size at the connection.
 */

export type PickedFile = {
  /** Where the app can read it: a `file://`, `content://` or `blob:` URI. */
  uri: string;
  name: string;
  /** Bytes. */
  size: number;
  /** The MIME type, such as `image/jpeg`. Empty when the picker did not say. */
  type: string;
  /** Pixels, for an image. */
  width?: number;
  height?: number;
};

/** Opens the app's picker. Resolves to nothing when it is cancelled. */
export type Pick = () => Promise<readonly PickedFile[]>;

export type Refusal = 'type' | 'size' | 'dimensions' | 'count' | 'program' | 'duplicate';

export type Rejection = { file: PickedFile; reason: Refusal; message: string };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1)} MB`;
}

/** What a person calls a type: `image/jpeg` is JPG, `application/pdf` is PDF. */
export function typeName(mime: string, name = ''): string {
  const known: Record<string, string> = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'image/heic': 'HEIC',
    'image/gif': 'GIF',
    'application/pdf': 'PDF',
  };
  if (known[mime]) return known[mime];
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase() : 'an unknown type';
}

const PROGRAMS = /\.(exe|bat|cmd|com|scr|msi|js|vbs|ps1|sh|app|apk|jar)$/i;

/** The name without any path a picker handed back: `../../x.pdf` is `x.pdf`. */
export function displayName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

/** `a-very-long-…-truncates.pdf`: the middle goes, so the type stays readable. */
export function middleTruncate(name: string, max = 36): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.4);
  return `${name.slice(0, keep - tail)}…${name.slice(-tail)}`;
}

/** `PNG, JPG or WebP`. */
export function listTypes(accept: readonly string[]): string {
  const names = [...new Set(accept.map((t) => typeName(t)))];
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`;
}

const matches = (accept: readonly string[], file: PickedFile): boolean =>
  accept.some((pattern) =>
    pattern.endsWith('/*')
      ? file.type.startsWith(pattern.slice(0, -1))
      : pattern.startsWith('.')
        ? file.name.toLowerCase().endsWith(pattern.toLowerCase())
        : file.type === pattern,
  );

/** Why a file is refused, in words that say what to do instead; `null` when it is fine. */
export function checkFile(
  file: PickedFile,
  {
    accept,
    maxSize,
    minDimensions,
  }: {
    accept?: readonly string[] | undefined;
    maxSize?: number | undefined;
    minDimensions?: { width: number; height: number } | undefined;
  },
): Rejection | null {
  const name = displayName(file.name);
  if (PROGRAMS.test(name)) {
    // A second extension before the real one is a disguise: say what it pretends to be.
    const inner = name.replace(PROGRAMS, '');
    const disguise = /\.[a-z0-9]{1,5}$/i.test(inner) ? typeName('', inner) : null;
    return {
      file,
      reason: 'program',
      message: disguise
        ? `Blocked: this is a program, not a ${disguise}.`
        : 'Blocked: this is a program.',
    };
  }
  if (accept?.length && !matches(accept, file)) {
    const kind = file.type.startsWith('video/')
      ? 'Videos aren’t accepted'
      : `${name} is ${/^[aeiou]/i.test(typeName(file.type, name)) ? 'an' : 'a'} ${typeName(file.type, name)}`;
    return { file, reason: 'type', message: `${kind}. Use ${listTypes(accept)}.` };
  }
  if (maxSize !== undefined && file.size > maxSize)
    return {
      file,
      reason: 'size',
      message: `${formatBytes(file.size)} is over the ${formatBytes(maxSize)} limit.`,
    };
  if (
    minDimensions &&
    file.width !== undefined &&
    file.height !== undefined &&
    (file.width < minDimensions.width || file.height < minDimensions.height)
  )
    return {
      file,
      reason: 'dimensions',
      message: `${name} is ${String(file.width)} × ${String(file.height)}. Use at least ${String(minDimensions.width)} × ${String(minDimensions.height)}.`,
    };
  return null;
}
