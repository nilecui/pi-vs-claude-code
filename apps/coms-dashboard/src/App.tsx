import { useEffect, useState } from "react";
import { AddAgentForm } from "./components/AddAgentForm";
import { AgentList } from "./components/AgentList";
import { FlowGraph } from "./components/FlowGraph";
import { NodePanel } from "./components/NodePanel";
import { TerminalStrip } from "./components/TerminalStrip";
import { ScenarioChat } from "./components/ScenarioChat";
import { Broadcast } from "./components/Broadcast";
import { Login } from "./components/Login";
import { Drawer } from "./components/Drawer";
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
  const [drawer, setDrawer] = useState<"terminal" | "graph" | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  useEffect(() => { init(); return () => shutdown(); }, [init, shutdown]);

  return (
    <div className="app">
      <div className={`app-body ${railOpen ? "two-col" : "one-col"}`}>
        {railOpen && <aside className="rail-left">
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
            <button className="rail-collapse" title="收起侧栏" onClick={() => setRailOpen(false)}>‹</button>
          </div>
          <AddAgentForm />
          <Broadcast />
          <AgentList />
        </aside>}
        <ScenarioChat />
      </div>

      {!railOpen && <button className="rail-expand" title="展开侧栏" onClick={() => setRailOpen(true)} aria-label="展开侧栏">☰</button>}

      <div className="drawer-toolbar">
        <button className={drawer === "terminal" ? "on" : ""} title="终端" onClick={() => setDrawer((d) => (d === "terminal" ? null : "terminal"))} aria-label="打开终端">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg>
        </button>
        <button className={drawer === "graph" ? "on" : ""} title="流程图" onClick={() => setDrawer((d) => (d === "graph" ? null : "graph"))} aria-label="打开流程图">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M8.2 7.2 15.6 11M8.2 16.8 15.6 13" /></svg>
        </button>
      </div>

      {drawer === "terminal" && (
        <Drawer title="终端" onClose={() => setDrawer(null)}>
          <div className="drawer-fill"><TerminalStrip /></div>
        </Drawer>
      )}
      {drawer === "graph" && (
        <Drawer title="关系流程图" onClose={() => setDrawer(null)}>
          <div className="drawer-graph"><FlowGraph /><NodePanel /></div>
        </Drawer>
      )}
    </div>
  );
}
