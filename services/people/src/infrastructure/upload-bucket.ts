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
 * same call for S3 or whatever serves S3 on a laptop
 * (`pnpm --filter @kithena/people upload-bucket`; docs/environments.md). In
 * production `deploy/aws/provision.sh` sets the same rules on S3.
 *
 * **CORS.** The browser PUTs straight to the bucket (PRD §14.2), so the
 * bucket has to answer the tenant app's preflight — and only the tenant
 * app's: `PUT` from the app origins, the headers the presigned URL
 * signs, nothing exposed (People reads the object itself; the browser needs
 * no ETag). S3 takes one `*` per origin, matched as plain text, so
 * `https://*.app.kithena.com` covers every tenant.
 *
 * **Lifecycle.** Everything in the bucket is deleted a day after it was
 * written. People deletes an upload on commit and sweeps hourly; this is the
 * backstop for a sweep that never ran. A day is the shortest rule S3 offers.
 * An upload is a single PUT, but a multipart upload somebody started with the
 * bucket's credentials is aborted after a day as well.
 */

/** What the presigned PUT signs, and so what the browser sends. */
export const UPLOAD_CORS_HEADERS = [
  'content-type',
  'if-none-match',
  'x-amz-server-side-encryption',
] as const;

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

export const UPLOAD_LIFECYCLE: LifecycleRule[] = [
  {
    ID: 'uploads-expire-after-a-day',
    Status: 'Enabled',
    Filter: { Prefix: '' },
    Expiration: { Days: 1 },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  },
];

/**
 * Create the bucket if it is missing, then set its CORS and lifecycle. A
 * store that refuses either fails the call: an upload bucket without its
 * CORS is one the browser cannot reach, or one it can reach from anywhere.
 */
export async function configureUploadBucket(
  client: S3Client,
  bucket: string,
  origins: readonly string[],
): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: uploadCors(origins) } }),
  );
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: UPLOAD_LIFECYCLE },
    }),
  );
}
