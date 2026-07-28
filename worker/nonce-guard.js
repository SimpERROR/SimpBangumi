import { DurableObject } from "cloudflare:workers";

const MAX_NONCES_PER_DEVICE = 512;

export class NonceGuard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_nonces_expires_at ON nonces (expires_at)"
      );
    });
  }

  async consume(nonce, ttlSeconds, now = Date.now()) {
    if (typeof nonce !== "string" || nonce.length === 0 || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      return false;
    }

    const expiresAt = now + ttlSeconds * 1000;
    this.ctx.storage.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", now);

    const existing = this.ctx.storage.sql
      .exec("SELECT nonce FROM nonces WHERE nonce = ?", nonce)
      .toArray();
    if (existing.length > 0) return false;

    const count = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS count FROM nonces")
      .one().count;
    if (Number(count) >= MAX_NONCES_PER_DEVICE) return false;

    this.ctx.storage.sql.exec(
      "INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)",
      nonce,
      expiresAt
    );

    const next = this.ctx.storage.sql
      .exec("SELECT MIN(expires_at) AS expires_at FROM nonces")
      .toArray()[0]?.expires_at;
    if (next != null) {
      await this.ctx.storage.setAlarm(Number(next));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    return true;
  }

  async alarm() {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", now);
    const next = this.ctx.storage.sql
      .exec("SELECT MIN(expires_at) AS expires_at FROM nonces")
      .toArray()[0]?.expires_at;
    if (next != null) {
      await this.ctx.storage.setAlarm(Number(next));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}