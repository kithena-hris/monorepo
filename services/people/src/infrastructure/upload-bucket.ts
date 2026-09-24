import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  type CORSRule,
  type LifecycleRule,
  type S3Client,
} from '@aws-sdk/client-s3';

/**
 * The upload bucket's own configuration, over the S3 API alone so it is the
 * same call for R2, S3 or whatever serves S3 on a laptop
 * (`pnpm --filter @kithena/people upload-bucket`; docs/environments.md).
 *
 * **CORS.** The browser PUTs straight to the bucket (PRD §14.2), so the
 * bucket has to answer the tenant app's preflight — and only the tenant
 * app's: `PUT` from the app origins, the three headers the presigned URL
 * signs, nothing exposed (People reads the object itself; the browser needs
 * no ETag). R2 takes one `*` per origin and lets it span labels, so
 * `https://*.app.kithena.com` covers every tenant.
 *
 * **Lifecycle.** Everything in the bucket is deleted a day after it was
 * written. People deletes an upload on commit and sweeps hourly; this is the
 * backstop for a sweep that never ran. A day is the shortest rule S3 offers.
 */

export const UPLOAD_CORS_HEADERS = ['content-type', 'if-none-match'] as const;

export function uploadCors(origins: readonly string[]): CORSRule[] {
  return [
    {
      AllowedOrigins: [...origins],
      AllowedMethods: ['PUT'],
      AllowedHeaders: [...UPLOAD_CORS_HEADERS],
      MaxAgeSeconds: 3600,
    },
  ];
}

/** One rule: an upload is a single PUT, so there is no multipart upload to abort. */
export const UPLOAD_LIFECYCLE: LifecycleRule[] = [
  { ID: 'uploads-expire-after-a-day', Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: 1 } },
];

/**
 * Create the bucket if it is missing, then set its CORS and lifecycle. A
 * server that does not implement one of the two (some local ones do not) is
 * reported, not fatal: the answer says which were set.
 */
export async function configureUploadBucket(
  client: S3Client,
  bucket: string,
  origins: readonly string[],
): Promise<{ readonly cors: boolean; readonly lifecycle: boolean }> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  const attempt = async (send: () => Promise<unknown>): Promise<boolean> => {
    try {
      await send();
      return true;
    } catch (cause) {
      if ((cause as { name?: string }).name === 'NotImplemented') return false;
      throw cause;
    }
  };
  return {
    cors: await attempt(() =>
      client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: { CORSRules: uploadCors(origins) },
        }),
      ),
    ),
    lifecycle: await attempt(() =>
      client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: { Rules: UPLOAD_LIFECYCLE },
        }),
      ),
    ),
  };
}
