import type { Database } from "bun:sqlite";

export async function hashPassword(pw: string): Promise<string> { return Bun.password.hash(pw); }
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try { return await Bun.password.verify(pw, hash); } catch { return false; }
}

export interface UserRow { id: string; username: string; }

export function createUser(db: Database, username: string, passwordHash: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    [id, username, passwordHash, Date.now()]); // UNIQUE(username) 冲突会抛
  return id;
}
export function getUserByName(db: Database, username: string): { id: string; username: string; password_hash: string } | null {
  return (db.query("SELECT id, username, password_hash FROM users WHERE username = ?").get(username) as { id: string; username: string; password_hash: string } | null) ?? null;
}

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export function createSession(db: Database, userId: string, ttlMs: number = SESSION_TTL): string {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  db.run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, userId, now, now + ttlMs]);
  return token;
}
export function getSessionUser(db: Database, token: string | null | undefined): UserRow | null {
  if (!token) return null;
  const row = db.query(
    `SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token) as { id: string; username: string; expires_at: number } | null;
  if (!row) return null;
  if (row.expires_at < Date.now()) { deleteSession(db, token); return null; }
  return { id: row.id, username: row.username };
}
export function deleteSession(db: Database, token: string): void {
  db.run("DELETE FROM sessions WHERE token = ?", [token]);
}
