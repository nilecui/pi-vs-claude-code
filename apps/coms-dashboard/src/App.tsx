import { useEffect, useState } from "react";
import { AddAgentForm } from "./components/AddAgentForm";
import { AgentList } from "./components/AgentList";
import { FlowGraph } from "./components/FlowGraph";
import { NodePanel } from "./components/NodePanel";
import { TerminalStrip } from "./components/TerminalStrip";
import { ScenarioChat } from "./components/ScenarioChat";
import { Broadcast } from "./components/Broadcast";
import { Login } from "./components/Login";
import { useStore } from "./store";
import { CONN_STATUS_LABEL } from "./lib/labels";
import { auth, type AuthUser } from "./api/client";

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => { auth.me().then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="login-screen"><div className="login-card"><div className="login-sub">加载中…</div></div></div>;
  if (!user) return <Login onAuthed={setUser} />;
  return <Dashboard user={user} onLogout={async () => { await auth.logout().catch(() => {}); setUser(null); }} />;
}

function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const init = useStore((s) => s.init);
  const shutdown = useStore((s) => s.shutdown);
  const status = useStore((s) => s.status);
  useEffect(() => { init(); return () => shutdown(); }, [init, shutdown]);

  return (
    <div className="app">
      <TerminalStrip />
      <div className="app-body">
        <aside className="rail-left">
          <div className="brand">
            <div className="brand-logo">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
              </svg>
            </div>
            <div className="brand-text">
              <div className="brand-title">coms-net 控制面板</div>
              <div className="brand-status"><span className={`status-led led-${status}`} /><span className="brand-sub">{CONN_STATUS_LABEL[status] ?? status}</span></div>
            </div>
            <button className="brand-logout" onClick={onLogout} title={`登出 ${user.username}`}>{user.username} · 登出</button>
          </div>
          <AddAgentForm />
          <Broadcast />
          <AgentList />
        </aside>
        <main className="rail-center">
          <FlowGraph />
          <NodePanel />
        </main>
        <ScenarioChat />
      </div>
    </div>
  );
}
