import { secret, type Secret } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { safeStorage } from 'electron';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appSecrets } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export class EncryptedAppSecretsStore {
  constructor(
    private readonly database?: AppDb,
    private readonly safeStorageApi = safeStorage,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  private get db(): AppDb {
    return this.database ?? getAppDb();
  }

  async getSecret(key: string): Promise<Secret<string> | null> {
    const rows = await this.db
      .select({ secret: appSecrets.secret })
      .from(appSecrets)
      .where(eq(appSecrets.key, key))
      .limit(1);

    const encrypted = rows[0]?.secret;
    if (!encrypted) {
      return null;
    }

    this.assertSecureStorageAvailable();
    try {
      return secret(this.safeStorageApi.decryptString(Buffer.from(encrypted, 'base64')), key);
    } catch (err) {
      // [XG-CUSTOM 2026-11-03] 密文解不开不应炸 boot：safeStorage 后端/钥匙环变化后旧密文必然解不开，
      // 旧行为直接抛 => services 阶段失败 => 打包版"打不开"。这里删掉坏密文自愈，返回 null 走"未登录"。
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[XG-CUSTOM] app secret 解密失败，已清除该条自愈（key=${key}）: ${msg}`);
      await this.deleteSecret(key);
      return null;
    }
  }

  async setSecret(key: string, value: Secret<string>): Promise<void> {
    await this.setEncryptedSecret(key, this.encrypt(value));
  }

  /** Encrypt before entering the caller's synchronous SQLite transaction. */
  prepareChanges(changes: ReadonlyMap<string, Secret<string> | null>): (tx: DrizzleTx) => void {
    const prepared = [...changes].map(([key, value]) => ({
      key,
      encrypted: value ? this.encrypt(value) : null,
    }));
    return (tx) => {
      for (const { key, encrypted } of prepared) {
        if (encrypted === null) tx.delete(appSecrets).where(eq(appSecrets.key, key)).run();
        else
          tx.insert(appSecrets)
            .values({ key, secret: encrypted })
            .onConflictDoUpdate({ target: appSecrets.key, set: { secret: encrypted } })
            .run();
      }
    };
  }

  private encrypt(value: Secret<string>): string {
    this.assertSecureStorageAvailable();
    // Boundary disclosure: the Electron safeStorage write is a documented
    // .expose() site — plaintext leaves the Secret only to be encrypted.
    return this.safeStorageApi.encryptString(value.expose()).toString('base64');
  }

  async setEncryptedSecret(key: string, encryptedSecret: string): Promise<void> {
    await this.db
      .insert(appSecrets)
      .values({
        key: key,
        secret: encryptedSecret,
      })
      .onConflictDoUpdate({ target: appSecrets.key, set: { secret: encryptedSecret } })
      .execute();
  }

  async deleteSecret(key: string): Promise<void> {
    await this.db.delete(appSecrets).where(eq(appSecrets.key, key));
  }

  private assertSecureStorageAvailable(): void {
    if (!this.safeStorageApi.isEncryptionAvailable()) {
      throw new Error('Secure secret storage is unavailable on this system.');
    }

    if (this.platform !== 'linux') {
      return;
    }

    const backend = this.safeStorageApi.getSelectedStorageBackend?.();
    if (backend === 'basic_text') {
      throw new Error(
        'Secure secret storage is unavailable: Linux safeStorage backend is basic_text.'
      );
    }
  }
}

export const encryptedAppSecretsStore = new EncryptedAppSecretsStore();
