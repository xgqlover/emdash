import { err, ok, type Result } from '@emdash/shared';
import { desc, gte, inArray, lt, notInArray } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { notifications } from '@core/services/app-db/node/schema';
import type { AppNotification } from '../api';
import type { NotificationStore } from '../api/ports';

export class SqliteNotificationStore implements NotificationStore {
  constructor(private readonly db: AppDb) {}

  async loadRecent(options: { maxRows: number; since: number }): Promise<AppNotification[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(gte(notifications.createdAt, options.since))
      .orderBy(desc(notifications.createdAt))
      .limit(options.maxRows);

    return rows
      .flatMap((row): AppNotification[] => {
        if (!row.payload) return [];
        return [
          {
            id: row.id,
            kind: row.kind,
            groupKey: row.groupKey,
            title: row.title,
            body: row.body,
            target: row.payload.target,
            source: row.payload.source,
            sound: row.payload.sound,
            count: row.count,
            createdAt: row.createdAt,
            readAt: row.readAt,
          },
        ];
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async insert(notification: AppNotification): Promise<Result<void, string>> {
    try {
      await this.db
        .insert(notifications)
        .values({
          id: notification.id,
          kind: notification.kind,
          groupKey: notification.groupKey,
          title: notification.title,
          body: notification.body,
          payload: {
            version: '1',
            target: notification.target,
            source: notification.source,
            sound: notification.sound,
          },
          count: notification.count,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
        })
        .onConflictDoUpdate({
          target: notifications.id,
          set: {
            kind: notification.kind,
            groupKey: notification.groupKey,
            title: notification.title,
            body: notification.body,
            payload: {
              version: '1',
              target: notification.target,
              source: notification.source,
              sound: notification.sound,
            },
            count: notification.count,
            createdAt: notification.createdAt,
            readAt: notification.readAt,
          },
        });
      return ok<void>();
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  async markRead(ids: string[], at: number): Promise<Result<void, string>> {
    if (ids.length === 0) return ok<void>();
    try {
      await this.db.update(notifications).set({ readAt: at }).where(inArray(notifications.id, ids));
      return ok<void>();
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  async markAllRead(at: number): Promise<Result<void, string>> {
    try {
      await this.db.update(notifications).set({ readAt: at });
      return ok<void>();
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  async remove(ids: string[]): Promise<Result<void, string>> {
    if (ids.length === 0) return ok<void>();
    try {
      await this.db.delete(notifications).where(inArray(notifications.id, ids));
      return ok<void>();
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  async prune(options: { olderThan: number; maxRows: number }): Promise<Result<void, string>> {
    try {
      await this.db.delete(notifications).where(lt(notifications.createdAt, options.olderThan));

      // [XG-CUSTOM 2026-10-20] **`offset` 前面必须有 `limit`**（SQLite 语法）——原写法只给 `.offset()`
      //   ⇒ 生成 `… order by "created_at" desc offset ?` ⇒ 每次启动
      //   `notifications: prune failed — near "offset": syntax error`（真机 10-20 实测，全仓唯一一处）。
      //   ⛔ **别用 `.limit(-1)` 想绕过**：drizzle 0.32.2 **直接忽略负数 limit**（用 node:sqlite 实测，
      //   生成的 SQL 与旧写法一模一样，照样报错）。⇒ 改成「先取最新 maxRows 的 id，再删不在其中的」。
      const keep = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .orderBy(desc(notifications.createdAt))
        .limit(Math.max(0, options.maxRows));
      const keepIds = keep.map((row) => row.id);
      const overflow = keepIds.length
        ? await this.db
            .select({ id: notifications.id })
            .from(notifications)
            .where(notInArray(notifications.id, keepIds))
        : await this.db.select({ id: notifications.id }).from(notifications);
      await this.remove(overflow.map((row) => row.id));
      return ok<void>();
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }
}
