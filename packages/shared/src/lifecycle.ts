import { log } from '@emdash/shared/logger';

export type Unsubscribe = () => void;

export interface Lease<T> {
  readonly value: T;
  release(): Promise<void>;
}

export interface PendingLease<T> {
  ready(): Promise<T>;
  release(): Promise<void>;
}

export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= fn());
}

export function toPendingLease<T>(leasePromise: Promise<Lease<T>>, label?: string): PendingLease<T> {
  leasePromise.catch(() => {});
  return {
    ready: async () => (await leasePromise).value,
    release: once(async () => {
      try {
        await (await leasePromise).release();
      } catch (error) {
        // [XG-CUSTOM 2026-11-02] XG-LEASE-LABEL 带上是哪条 lease（路径/根）：
        //   原来只说 not-found，无法定位是哪个工作区/文件（客户端一连上来就撞它）。
        log.warn('pending lease release failed', label ? { error, label } : { error });
      }
    }),
  };
}
