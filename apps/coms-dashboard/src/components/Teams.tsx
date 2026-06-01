import { useEffect, useState } from "react";
import { teams as teamApi, type TeamSummary, type TeamDetail } from "../api/client";

function parseErr(e: unknown): string {
  const m = String(e);
  const map: Record<string, string> = { not_owner: "仅团队 owner 可操作", no_user: "查无此用户", exists: "已是成员", forbidden: "无权限" };
  for (const k in map) if (m.includes(k)) return map[k];
  return "操作失败";
}

export function Teams({ currentUserId, onClose }: { currentUserId: string; onClose: () => void }) {
  const [list, setList] = useState<TeamSummary[]>([]);
  const [sel, setSel] = useState<TeamDetail | null>(null);
  const [name, setName] = useState("");
  const [addName, setAddName] = useState("");
  const [err, setErr] = useState("");

  const refresh = () => teamApi.list().then(setList).catch(() => setErr("加载团队失败"));
  useEffect(() => { refresh(); }, []);
  async function open(id: string) { setErr(""); try { setSel(await teamApi.get(id)); } catch { setErr("加载失败"); } }
  async function create() { if (!name.trim()) return; await teamApi.create(name.trim()); setName(""); refresh(); }
  async function add() { if (!sel || !addName.trim()) return; try { await teamApi.addMember(sel.id, addName.trim()); setAddName(""); open(sel.id); } catch (e) { setErr(parseErr(e)); } }
  async function remove(userId: string) { if (!sel) return; try { await teamApi.removeMember(sel.id, userId); } catch (e) { setErr(parseErr(e)); return; } if (userId === currentUserId) { setSel(null); refresh(); } else open(sel.id); }
  async function del() { if (!sel) return; try { await teamApi.remove(sel.id); } catch (e) { setErr(parseErr(e)); return; } setSel(null); refresh(); }

  const isOwner = sel?.owner_id === currentUserId;
  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="teams-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head"><strong>团队</strong><button className="result-close" onClick={onClose}>✕</button></div>
        {err && <div className="editor-errors">⚠ {err}</div>}
        <div className="teams-body">
          <div className="teams-list">
            {list.map((t) => (
              <div key={t.id} className={`history-item ${sel?.id === t.id ? "on" : ""}`} onClick={() => open(t.id)}>
                <div className="history-item-top"><b>{t.name}</b><span className="history-time">{t.role}</span></div>
              </div>
            ))}
            <div className="teams-create">
              <input placeholder="新团队名" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
              <button onClick={create}>建团队</button>
            </div>
          </div>
          <div className="teams-detail">
            {!sel && <div className="chat-empty">选择或创建一个团队。</div>}
            {sel && (
              <>
                <div className="teams-detail-head"><strong>{sel.name}</strong>{isOwner && <button className="editor-del" onClick={del}>删除团队</button>}</div>
                {sel.members.map((m) => (
                  <div key={m.user_id} className="teams-member">
                    <span>{m.username} <span className="editor-muted">· {m.role}</span></span>
                    {((isOwner && m.role !== "owner") || m.user_id === currentUserId) && (
                      <button onClick={() => remove(m.user_id)}>{m.user_id === currentUserId ? "离开" : "移除"}</button>
                    )}
                  </div>
                ))}
                {isOwner && (
                  <div className="teams-create">
                    <input placeholder="按用户名加成员" value={addName} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
                    <button onClick={add}>添加</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
