import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PendingEvent } from '@kithena/domain-kit';

import type { ExternalSource } from '../../domain/access/field-access.js';
import type { MappingEntry } from '../../domain/scim/resource.js';

/**
 * What SCIM provisioning and mirror mode read and write (PEO-072, PEO-073).
 * `drizzleScimStore` satisfies it over `people.scim_*`
 * (20260926160000_people_scim.sql).
 */

type Tx = PostgresJsDatabase;

export interface ScimConnection {
  readonly id: string;
  readonly system: string;
  readonly tokenHash: string;
  readonly previousTokenHash: string | null;
  /** ISO instant. */
  readonly previousValidUntil: string | null;
  readonly createdAt: string;
  readonly tokenRotatedAt: string | null;
  readonly revokedAt: string | null;
}

export interface ScimLink {
  readonly personId: string;
  readonly userName: string;
  readonly externalId: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScimGroup {
  readonly id: string;
  readonly displayName: string;
  readonly externalId: string | null;
  readonly members: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScimStore {
  connection(tx: Tx, tenantId: string, id: string): Promise<ScimConnection | null>;
  /** Every connection, revoked ones included, with how many people each provisions. */
  connections(tx: Tx, tenantId: string): Promise<readonly (ScimConnection & { readonly linked: number })[]>;
  createConnection(
    tx: Tx,
    tenantId: string,
    row: { id: string; system: string; tokenHash: string; createdAt: string; createdBy: string },
  ): Promise<void>;
  rotate(
    tx: Tx,
    tenantId: string,
    id: string,
    token: { hash: string; previousHash: string; previousValidUntil: string; rotatedAt: string },
  ): Promise<void>;
  /** Revoked, and its mapping gone: it owns nothing from here on. */
  revoke(tx: Tx, tenantId: string, id: string, at: string): Promise<void>;

  /** Serialise mapping changes in a tenant until the transaction ends. */
  lockMappings(tx: Tx, tenantId: string): Promise<void>;
  /** Every mapping row in the tenant, by connection. */
  mappings(tx: Tx, tenantId: string): Promise<readonly (MappingEntry & { readonly connectionId: string })[]>;
  setMapping(tx: Tx, tenantId: string, connectionId: string, entries: readonly MappingEntry[]): Promise<void>;

  /**
   * The attributes an external system owns on this person: the mapping of
   * every live connection that provisions them (PEO-073).
   */
  sources(tx: Tx, tenantId: string, personId: string): Promise<ReadonlyMap<string, ExternalSource>>;

  /** Every person the connection provisions, in person id order. */
  links(tx: Tx, tenantId: string, connectionId: string): Promise<readonly ScimLink[]>;
  link(tx: Tx, tenantId: string, connectionId: string, personId: string): Promise<ScimLink | null>;
  /** Who else in this connection holds this userName (case-insensitively) or externalId. */
  clash(
    tx: Tx,
    tenantId: string,
    connectionId: string,
    claim: { userName: string; externalId: string | null; except: string | null },
  ): Promise<'userName' | 'externalId' | null>;
  putLink(tx: Tx, tenantId: string, connectionId: string, link: ScimLink): Promise<void>;
  /** The link gone, and the person out of this connection's groups. */
  unlink(tx: Tx, tenantId: string, connectionId: string, personId: string): Promise<void>;

  groups(tx: Tx, tenantId: string, connectionId: string): Promise<readonly ScimGroup[]>;
  putGroup(tx: Tx, tenantId: string, connectionId: string, group: ScimGroup): Promise<void>;
  deleteGroup(tx: Tx, tenantId: string, connectionId: string, id: string): Promise<boolean>;

  publish(tx: Tx, events: readonly PendingEvent[]): Promise<void>;
}
