import type { DomainFailure } from './result.js';

export const failure = (code: string, message: string, path?: readonly string[]): DomainFailure =>
  path ? { code, message, path } : { code, message };

export const NotFound = (what: string): DomainFailure => failure('NOT_FOUND', `${what} not found`);
export const Forbidden = (): DomainFailure => failure('FORBIDDEN', 'Not permitted');
export const NotEntitled = (key: string): DomainFailure =>
  failure('NOT_ENTITLED', `This workspace does not include ${key}`);
export const Conflict = (message: string): DomainFailure => failure('CONFLICT', message);
