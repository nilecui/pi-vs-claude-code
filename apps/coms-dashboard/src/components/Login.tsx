import { useState } from "react";
import { auth, type AuthUser } from "../api/client";

export function Login({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!username || !password || busy) return;
    setBusy(true); setErr("");
    try {
      const u = mode === "login" ? await auth.login(username, password) : await auth.register(username, password);
      onAuthed(u);
    } catch (e) {
      const m = String(e); const jm = m.match(/\{[\s\S]*\}/);
      try { setErr((jm ? JSON.parse(jm[0]) : null)?.error ?? "操作失败"); } catch { setErr("操作失败"); }
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-title">coms-net 控制面板</div>
        <div className="login-sub">{mode === "login" ? "登录以继续" : "注册新账号"}</div>
        <input placeholder="用户名" value={username} onChange={(e) => setU(e.target.value)} />
        <input type="password" placeholder="密码" value={password} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        {err && <div className="login-err">{err}</div>}
        <button className="login-go" disabled={busy || !username || !password} onClick={submit}>{busy ? "…" : mode === "login" ? "登录" : "注册"}</button>
        <button className="login-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
          {mode === "login" ? "没有账号?去注册" : "已有账号?去登录"}
        </button>
      </div>
    </div>
  );
}
