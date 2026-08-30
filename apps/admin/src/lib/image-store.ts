import 'server-only';

/**
 * Where an uploaded company image is put.
 *
 * A port, because it is the only external dependency in this codebase that did
 * not have one — and the only one whose hostname is named by a *domain rule*
 * in the identity service. `docs/self-hosting.md` has the reasoning: leaving
 * Vercel is otherwise a week's work everywhere except here, where it is a data
 * migration and an edit to a security invariant.
 *
 * Deliberately narrow. Uploading is the whole of what the back-office does with
 * object storage — there is no listing, no deletion and no signed reads, so the
 * port does not pretend there might be. A wider interface would be four
 * implementations of methods nobody calls.
 */
export interface StoredImage {
  /** The public URL. Must be on a host the identity service will accept. */
  readonly url: string;
}

export interface ImageStore {
  /**
   * Store `file` at `key` and return where it can be read.
   *
   * `key` is chosen by the caller and is already random — the uploader's
   * filename is never used, so two customers uploading `logo.png` cannot
   * collide and nobody can choose a path.
   */
  put(key: string, file: File, contentType: string): Promise<StoredImage>;
}

/**
 * Vercel Blob, which is what every deployment uses today.
 *
 * Imported lazily so a deployment that configures a different store does not
 * need the SDK present at all — and so a missing `BLOB_READ_WRITE_TOKEN` is
 * reported by `imageStore()` as a configuration problem rather than surfacing
 * as a stack trace from inside the SDK.
 */
function vercelBlobStore(): ImageStore {
  return {
    async put(key, file, contentType) {
      const { put } = await import('@vercel/blob');
      const blob = await put(key, file, {
        access: 'public',
        // The key is already unique; a suffix on top of it only makes the URL
        // longer and the stored value harder to recognise.
        addRandomSuffix: false,
        contentType,
      });
      return { url: blob.url };
    },
  };
}

/**
 * The store this deployment is configured for, or null if none is.
 *
 * Null rather than a throw: an environment nobody configured uploads is a
 * supported state — the wizard says so and carries on without an image — and
 * the operator reading that message cannot fix it from the screen they are on.
 */
export function imageStore(): ImageStore | null {
  // One provider today. The shape is here so adding S3, R2 or MinIO is a new
  // branch and a new file rather than an edit to the route that uses it.
  if (process.env['BLOB_READ_WRITE_TOKEN']) return vercelBlobStore();
  return null;
}
