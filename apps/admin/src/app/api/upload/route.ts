import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { currentOperator } from '../../../lib/session';

/**
 * Where a company's logo and cover image are uploaded.
 *
 * Behind the operator session, not open. An unauthenticated upload endpoint on
 * a public host is somebody else's free image hosting within the day, and the
 * bill arrives as ours.
 *
 * The client uploads here rather than straight to Blob with a client token.
 * The direct route is faster and is the wrong trade for six uploads a month:
 * a client token is handed to the browser and is what enforces the size and
 * type limits, so the checks below would be advisory. Here they are the only
 * path.
 */

/** Raster formats a browser renders and an inspector can open. */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

/**
 * 2 MB. A logo that needs more than this is a logo nobody optimised, and the
 * cover image is displayed at half a login page rather than printed.
 */
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await currentOperator())) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');
  const kind = form.get('kind');

  if (!(file instanceof File)) {
    return NextResponse.json({ message: 'No file was sent.' }, { status: 400 });
  }
  if (kind !== 'logo' && kind !== 'cover') {
    return NextResponse.json({ message: 'Unknown image kind.' }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { message: 'Use a PNG, JPEG, WebP or SVG image.' },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ message: 'That image is larger than 2 MB.' }, { status: 413 });
  }

  if (!process.env['BLOB_READ_WRITE_TOKEN']) {
    // Said plainly rather than surfacing as a stack trace from the SDK. This is
    // the first thing that breaks in an environment nobody configured, and the
    // operator reading it cannot fix it from the screen they are on.
    return NextResponse.json(
      { message: 'Image uploads are not configured in this environment.' },
      { status: 503 },
    );
  }

  const blob = await put(`companies/${kind}/${crypto.randomUUID()}`, file, {
    access: 'public',
    // The uploader chose the name; a company logo called `../../etc/passwd.png`
    // is not a threat to Blob, but a random name means two customers uploading
    // `logo.png` cannot collide either.
    addRandomSuffix: false,
    contentType: file.type,
  });

  return NextResponse.json({ url: blob.url });
}
