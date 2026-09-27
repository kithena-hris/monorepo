import { createHash } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { canWrite, visibleTo } from '../../domain/access/field-access.js';
import { readFieldFile, type FileRules } from '../../domain/person/file.js';
import { discard, finishUpload, startUpload, type UploadDeps } from '../import/upload.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { StoredFileInfo } from './file-store.js';
import type { ImportUploadView } from './operations.js';
import { personOfViewer, type ScreenDeps, type Tx } from './record.js';

/**
 * A file for an `image` or `document_ref` field: uploaded the way a photo is,
 * checked from its bytes, kept in `people.person_file`, and read back only by
 * somebody who may read that field on that person.
 *
 * Uploading keeps the file; saving the field is what points the record at it,
 * through the same write path as any other value. A file uploaded and never
 * saved stays unreferenced.
 *
 * ponytail: unreferenced files are not swept; a sweep of rows no record names
 * after a day is the upgrade when they add up.
 */

export interface FileDeps extends ScreenDeps {
  readonly uploads: Pick<UploadDeps, 'store' | 'intents'>;
  readonly newId: () => string;
}

export type FileInfoView = Pick<StoredFileInfo, 'id' | 'name' | 'mediaType' | 'size'>;

const unavailable = () => err(failure('UNAVAILABLE', 'Files are not available here'));

/** A field's rules for its file, or null for a field that holds none. */
export function fileRules(definition: AttributeDefinition): FileRules | null {
  const config = definition.typeConfig;
  if (config.kind === 'image') return { kind: 'image', maxBytes: config.maxBytes };
  if (config.kind === 'document_ref') {
    return { kind: 'document_ref', accepts: config.accepts, maxBytes: config.maxBytes };
  }
  return null;
}

/** The person and the field a file is for, if this viewer may write that field there. */
async function target(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string | null,
  key: string,
): Promise<Result<{ readonly personId: string; readonly rules: FileRules }>> {
  const id = personId === null ? await personOfViewer(deps, tx, asking) : ok(personId);
  if (!id.ok) return id;
  // Somebody the viewer may not read is not found, as everywhere else.
  const read = await deps.service.access.read(tx, { ...asking, personId: id.value });
  if (!read.ok) return read;
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
  const definition = version.document.attributes.find((d) => d.key === key);
  const rules = definition === undefined ? null : fileRules(definition);
  if (definition === undefined || rules === null) {
    return err(failure('FIELD_NOT_A_FILE', `${key} does not take a file`, ['key']));
  }
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, id.value);
  const writable = canWrite(definition, relations);
  if (!writable.ok) return writable;
  return ok({ personId: id.value, rules });
}

const uploadDeps = (deps: FileDeps): UploadDeps => ({
  ...deps.uploads,
  clock: deps.clock,
  newId: deps.newId,
});
const inTx =
  (deps: FileDeps, asking: Asking) =>
  <T>(fn: (tx: Tx) => Promise<Result<T>>): Promise<Result<T>> =>
    run(deps.service, asking.tenantId, fn);
const who = (asking: Asking) => ({ tenantId: asking.tenantId, actorId: asking.viewer.accountId });

/** Where to put a field's file: a presigned PUT for exactly this many bytes, once. */
export async function startFileUpload(
  deps: FileDeps,
  asking: Asking,
  input: {
    readonly personId: string | null;
    readonly key: string;
    readonly name: string;
    readonly size: number;
  },
): Promise<Result<ImportUploadView>> {
  if (deps.files === undefined) return unavailable();
  const allowed = await run(deps.service, asking.tenantId, (tx) =>
    target(deps, tx, asking, input.personId, input.key),
  );
  if (!allowed.ok) return allowed;
  if (input.size > allowed.value.rules.maxBytes) {
    return err(failure('FILE_TOO_LARGE', 'This file is larger than the field takes', ['size']));
  }
  return startUpload(uploadDeps(deps), inTx(deps, asking), who(asking), {
    name: input.name,
    size: input.size,
    purpose: 'file',
  });
}

/** The file is uploaded: check it, keep it, let the upload go, and say what was kept. */
export async function completeFileUpload(
  deps: FileDeps,
  asking: Asking,
  input: { readonly personId: string | null; readonly key: string },
  uploadId: string,
): Promise<Result<FileInfoView>> {
  const files = deps.files;
  if (files === undefined) return unavailable();
  const allowed = await run(deps.service, asking.tenantId, (tx) =>
    target(deps, tx, asking, input.personId, input.key),
  );
  if (!allowed.ok) return allowed;
  const finished = await finishUpload(
    uploadDeps(deps),
    inTx(deps, asking),
    who(asking),
    uploadId,
    'file',
  );
  if (!finished.ok) return finished;
  await discard(uploadDeps(deps), inTx(deps, asking), finished.value.intent);
  const file = readFieldFile(finished.value.bytes, allowed.value.rules);
  if (!file.ok) return file;
  const kept: FileInfoView = {
    id: deps.newId(),
    name: finished.value.intent.name,
    mediaType: file.value.mediaType,
    size: file.value.bytes.byteLength,
  };
  return run(deps.service, asking.tenantId, async (tx) => {
    await files.put(tx, {
      ...kept,
      tenantId: asking.tenantId,
      personId: allowed.value.personId,
      attributeKey: input.key,
      bytes: file.value.bytes,
      checksum: createHash('sha256').update(file.value.bytes).digest('hex'),
      uploadedAt: deps.clock.instant(),
      uploadedBy: asking.viewer.accountId,
    });
    return ok(kept);
  });
}

export interface FileView {
  readonly name: string;
  readonly mediaType: string;
  /** The file, base64: a view model is JSON. */
  readonly data: string;
}

/**
 * A field's file, for somebody who may read that field on that person.
 * Whoever may not is told it is not found, exactly as they are about a field
 * they cannot see.
 */
export async function fileView(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
): Promise<Result<FileView>> {
  const files = deps.files;
  if (files === undefined) return unavailable();
  const missing = () => err(failure('NOT_FOUND', 'No such file'));
  return run(deps.service, asking.tenantId, async (tx) => {
    const file = await files.get(tx, asking.tenantId, id);
    if (file === null) return missing();
    const read = await deps.service.access.read(tx, { ...asking, personId: file.personId });
    if (!read.ok) return missing();
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    const definition = version?.document.attributes.find((d) => d.key === file.attributeKey);
    const relations = await deps.relations.relations(
      tx,
      asking.tenantId,
      asking.viewer,
      file.personId,
    );
    if (definition === undefined || !visibleTo(definition, relations)) return missing();
    return ok({
      name: file.name,
      mediaType: file.mediaType,
      data: Buffer.from(file.bytes).toString('base64'),
    });
  });
}
