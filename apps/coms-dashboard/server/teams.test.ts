import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "./db";
import { createUser } from "./auth";
import { createTeam, listTeams, getTeam, addMember, removeMember, deleteTeam, isTeamMember, userTeamIds } from "./teams";

function setup() {
  const db = new Database(":memory:"); migrate(db);
  const a = createUser(db, "alice", "h"); const b = createUser(db, "bob", "h"); const c = createUser(db, "carol", "h");
  return { db, a, b, c };
}

test("createTeam:创建者成为 owner 成员", () => {
  const { db, a } = setup();
  const t = createTeam(db, "dev", a);
  expect(isTeamMember(db, t, a)).toBe(true);
  expect(listTeams(db, a).map((x) => x.role)).toEqual(["owner"]);
  expect(userTeamIds(db, a)).toEqual([t]);
});

test("addMember:owner 加 / 非 owner 拒 / 无用户 / 重复", () => {
  const { db, a, b } = setup();
  const t = createTeam(db, "dev", a);
  expect(addMember(db, t, b, "bob")).toBe("not_owner");
  expect(addMember(db, t, a, "nobody")).toBe("no_user");
  expect(addMember(db, t, a, "bob")).toBe("ok");
  expect(addMember(db, t, a, "bob")).toBe("exists");
  expect(isTeamMember(db, t, b)).toBe(true);
});

test("getTeam:成员可见(含成员列表),非成员 null", () => {
  const { db, a, b, c } = setup();
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob");
  const got = getTeam(db, t, b);
  expect(got?.members.map((m) => m.username).sort()).toEqual(["alice", "bob"]);
  expect(getTeam(db, t, c)).toBeNull();
});

test("removeMember:成员离开 / owner 移除 / 越权拒", () => {
  const { db, a, b, c } = setup();
  const t = createTeam(db, "dev", a); addMember(db, t, a, "bob"); addMember(db, t, a, "carol");
  expect(removeMember(db, t, b, b)).toBe("ok");          // bob 离开
  expect(isTeamMember(db, t, b)).toBe(false);
  expect(removeMember(db, t, c, a)).toBe("forbidden");   // carol 不能移除别人
  expect(removeMember(db, t, a, c)).toBe("ok");          // owner 移除 carol
});

test("deleteTeam:仅 owner;共享场景 team_id 回退 NULL", () => {
  const { db, a, b } = setup();
  const t = createTeam(db, "dev", a);
  db.run("INSERT INTO scenarios (id,title,blurb,data,builtin,owner_id,team_id,created_at,updated_at) VALUES ('s','t','b','{}',0,?,?,0,0)", [a, t]);
  expect(deleteTeam(db, t, b)).toBe("forbidden");
  expect(deleteTeam(db, t, a)).toBe("ok");
  const row = db.query("SELECT team_id FROM scenarios WHERE id='s'").get() as { team_id: string | null };
  expect(row.team_id).toBeNull();
});
