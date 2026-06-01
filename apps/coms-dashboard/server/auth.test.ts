import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "./db";
import { hashPassword, verifyPassword, createUser, getUserByName, createSession, getSessionUser, deleteSession } from "./auth";

function db() { const d = new Database(":memory:"); migrate(d); return d; }

test("hash/verify 往返", async () => {
  const h = await hashPassword("s3cret");
  expect(await verifyPassword("s3cret", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});

test("createUser + getUserByName;重名抛错", async () => {
  const d = db();
  const id = createUser(d, "alice", await hashPassword("p"));
  expect(typeof id).toBe("string");
  expect(getUserByName(d, "alice")?.username).toBe("alice");
  expect(() => createUser(d, "alice", "x")).toThrow();
});

test("session 创建/取回/删除", async () => {
  const d = db();
  const uid = createUser(d, "bob", await hashPassword("p"));
  const tok = createSession(d, uid);
  expect(getSessionUser(d, tok)?.username).toBe("bob");
  deleteSession(d, tok);
  expect(getSessionUser(d, tok)).toBeNull();
});

test("过期 session → null", async () => {
  const d = db();
  const uid = createUser(d, "carol", await hashPassword("p"));
  const tok = createSession(d, uid, -1000); // 已过期
  expect(getSessionUser(d, tok)).toBeNull();
});

test("null/无效 token → null", () => {
  const d = db();
  expect(getSessionUser(d, null)).toBeNull();
  expect(getSessionUser(d, "nope")).toBeNull();
});
