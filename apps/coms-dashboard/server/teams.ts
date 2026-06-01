import type { Database } from "bun:sqlite";

export function userTeamIds(db: Database, userId: string): string[] {
  return (db.query("SELECT team_id FROM team_members WHERE user_id = ?").all(userId) as { team_id: string }[]).map((r) => r.team_id);
}
export function isTeamMember(db: Database, teamId: string, userId: string): boolean {
  return !!db.query("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").get(teamId, userId);
}
function isOwner(db: Database, teamId: string, userId: string): boolean {
  const r = db.query("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?").get(teamId, userId) as { role: string } | null;
  return r?.role === "owner";
}

export interface TeamSummary { id: string; name: string; owner_id: string; role: string; }
export interface TeamDetail { id: string; name: string; owner_id: string; members: { user_id: string; username: string; role: string }[]; }
export type AddResult = "ok" | "not_owner" | "no_team" | "no_user" | "exists";

export function createTeam(db: Database, name: string, ownerId: string): string {
  const id = crypto.randomUUID(); const now = Date.now();
  db.run("INSERT INTO teams (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)", [id, name, ownerId, now]);
  db.run("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", [id, ownerId, now]);
  return id;
}
export function listTeams(db: Database, userId: string): TeamSummary[] {
  return db.query(
    `SELECT t.id AS id, t.name AS name, t.owner_id AS owner_id, m.role AS role
     FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.created_at`).all(userId) as TeamSummary[];
}
export function getTeam(db: Database, teamId: string, userId: string): TeamDetail | null {
  if (!isTeamMember(db, teamId, userId)) return null;
  const t = db.query("SELECT id, name, owner_id FROM teams WHERE id = ?").get(teamId) as { id: string; name: string; owner_id: string } | null;
  if (!t) return null;
  const members = db.query(
    `SELECT m.user_id AS user_id, u.username AS username, m.role AS role
     FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at`).all(teamId) as TeamDetail["members"];
  return { ...t, members };
}
export function addMember(db: Database, teamId: string, actorId: string, username: string): AddResult {
  if (!db.query("SELECT 1 FROM teams WHERE id = ?").get(teamId)) return "no_team";
  if (!isOwner(db, teamId, actorId)) return "not_owner";
  const u = db.query("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | null;
  if (!u) return "no_user";
  if (isTeamMember(db, teamId, u.id)) return "exists";
  db.run("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)", [teamId, u.id, Date.now()]);
  return "ok";
}
export function removeMember(db: Database, teamId: string, actorId: string, targetId: string): "ok" | "forbidden" {
  const owner = isOwner(db, teamId, actorId);
  if (!owner && actorId !== targetId) return "forbidden";       // 非 owner 只能移除自己
  if (owner && targetId === actorId) return "forbidden";        // owner 离开请走 deleteTeam
  db.run("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [teamId, targetId]);
  return "ok";
}
export function deleteTeam(db: Database, teamId: string, actorId: string): "ok" | "forbidden" {
  if (!isOwner(db, teamId, actorId)) return "forbidden";
  db.run("UPDATE scenarios SET team_id = NULL WHERE team_id = ?", [teamId]); // 共享场景回退私有
  db.run("DELETE FROM team_members WHERE team_id = ?", [teamId]);
  db.run("DELETE FROM teams WHERE id = ?", [teamId]);
  return "ok";
}
