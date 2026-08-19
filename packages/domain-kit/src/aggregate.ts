import type { EventEnvelope } from '@hris/contracts';
import { Entity } from './entity.js';

export type PendingEvent = Omit<EventEnvelope, 'recordedAt'> & { payload: unknown };

/**
 * Aggregates collect events rather than publishing them. The application
 * layer drains them into the outbox inside the same transaction as the write,
 * which is what makes the CDC pipeline safe.
 */
export abstract class AggregateRoot<TId extends string> extends Entity<TId> {
  #pending: PendingEvent[] = [];
  #version = 0;

  get version(): number {
    return this.#version;
  }

  protected raise(event: PendingEvent): void {
    this.#version += 1;
    this.#pending.push(event);
  }

  /** Called once, by the repository, inside the transaction. */
  drainEvents(): readonly PendingEvent[] {
    const drained = this.#pending;
    this.#pending = [];
    return drained;
  }
}
