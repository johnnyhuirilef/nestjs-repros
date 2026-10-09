import { Inject, Injectable } from '@nestjs/common';
import {
  InMemoryLockStore,
  LocksStorage,
  type LockAcquireResult,
  type LockStore,
} from '@nestjs/locks';

export type StoreBehavior =
  | { kind: 'normal' }
  | { kind: 'hang' }
  | { kind: 'late'; delayMs: number };

const NEVER_SETTLES = new Promise<LockAcquireResult>(() => undefined);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Stands in for a real store whose `acquire` call is slow, for example
// because its connection pool is exhausted. The other methods delegate.
@Injectable()
export class SlowLockStore implements LockStore {
  behavior: StoreBehavior = { kind: 'normal' };
  private readonly inner = new InMemoryLockStore();

  constructor(@Inject(LocksStorage) storage: LocksStorage) {
    storage.registerSource(this);
  }

  async acquire(key: string, owner: string, ttl: number): Promise<LockAcquireResult> {
    switch (this.behavior.kind) {
      case 'hang':
        return NEVER_SETTLES;
      case 'late':
        await wait(this.behavior.delayMs);
        return this.inner.acquire(key, owner, ttl);
      case 'normal':
        return this.inner.acquire(key, owner, ttl);
    }
  }

  renew(key: string, owner: string, ttl: number): Promise<boolean> {
    return this.inner.renew(key, owner, ttl);
  }

  release(key: string, owner: string): Promise<boolean> {
    return this.inner.release(key, owner);
  }
}
