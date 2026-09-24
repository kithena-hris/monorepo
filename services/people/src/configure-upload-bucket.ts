import { logger } from '@kithena/telemetry';

import { s3ConfigFrom } from './infrastructure/s3-blobs.js';
import { s3Uploads } from './infrastructure/s3-uploads.js';
import { configureUploadBucket } from './infrastructure/upload-bucket.js';

/**
 * `pnpm --filter @kithena/people upload-bucket`: create the upload bucket if
 * it is missing, and set its CORS and lifecycle, from the same variables
 * People reads (`PEOPLE_UPLOAD_BUCKET`, `PEOPLE_UPLOAD_S3_*`) and the app
 * origins allowed to PUT (`PEOPLE_UPLOAD_CORS_ORIGINS`, comma-separated).
 */

const bucket = process.env['PEOPLE_UPLOAD_BUCKET'];
const origins = (process.env['PEOPLE_UPLOAD_CORS_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (!bucket || origins.length === 0) {
  logger.error('Set PEOPLE_UPLOAD_BUCKET and PEOPLE_UPLOAD_CORS_ORIGINS');
  process.exit(1);
}
const { client } = s3Uploads(s3ConfigFrom(process.env, 'PEOPLE_UPLOAD', bucket));
await configureUploadBucket(client, bucket, origins);
logger.info({ bucket, origins }, 'upload bucket configured: CORS and a one-day lifecycle');
