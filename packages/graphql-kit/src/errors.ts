import { GraphQLError } from 'graphql';
import type { DomainFailure } from '@hris/domain-kit';

/**
 * Domain failures become structured GraphQL errors. Clients get a stable
 * code and a field path; they never get a stack trace or a database message.
 */
export function toGraphQLError(failure: DomainFailure): GraphQLError {
  return new GraphQLError(failure.message, {
    extensions: {
      code: failure.code,
      ...(failure.path ? { field: failure.path.join('.') } : {}),
    },
  });
}
