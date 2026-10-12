import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { logger } from '@kithena/telemetry';

/**
 * `pnpm --filter @kithena/documents bucket`: create the documents bucket if it
 * is missing, and set what the browser and the clock need of it (PRD §17):
 * CORS for a presigned PUT and GET from the app's origins
 * (`DOCUMENTS_CORS_ORIGINS`, comma-separated), and a one-day lifecycle on
 * `incoming/` and `outgoing/` — what a browser put and what was handed out.
 * The sealed documents themselves expire only when Documents deletes them.
 */

const bucket = process.env['DOCUMENTS_BUCKET'];
const origins = (process.env['DOCUMENTS_CORS_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (!bucket || origins.length === 0) {
  logger.error('Set DOCUMENTS_BUCKET and DOCUMENTS_CORS_ORIGINS');
  process.exit(1);
}
const get = (name: string) => process.env[`DOCUMENTS_S3_${name}`] ?? process.env[`S3_${name}`];
const endpoint = get('ENDPOINT');
const id = get('ACCESS_KEY_ID');
const secret = get('SECRET_ACCESS_KEY');
const client = new S3Client({
  region: get('REGION') ?? 'us-east-1',
  ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret } } : {}),
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}
await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['PUT', 'GET'],
          AllowedHeaders: ['content-type', 'if-none-match'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
await client.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: ['incoming/', 'outgoing/'].map((Prefix) => ({
        ID: `${Prefix.slice(0, -1)}-expires-after-a-day`,
        Status: 'Enabled' as const,
        Filter: { Prefix },
        Expiration: { Days: 1 },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      })),
    },
  }),
);
logger.info(
  { bucket, origins },
  'documents bucket configured: CORS and a one-day lifecycle on transfers',
);
