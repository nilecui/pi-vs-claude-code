import { useEffect } from "react";
import { AddAgentForm } from "./components/AddAgentForm";
import { AgentList } from "./components/AgentList";
import { FlowGraph } from "./components/FlowGraph";
import { NodePanel } from "./components/NodePanel";
import { LogRail } from "./components/LogRail";
import { useStore } from "./store";

export default function App() {
  const init = useStore((s) => s.init);
  const shutdown = useStore((s) => s.shutdown);
  const status = useStore((s) => s.status);

  useEffect(() => {
    init();
    return () => shutdown();
  }, [init, shutdown]);

  return (
    <div className="app">
      <aside className="rail-left">
        <div className="brand">
          <div className="brand-logo">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-title">coms-net panel</div>
            <div className="brand-status"><span className={`status-led led-${status}`} /><span className="brand-sub">{status}</span></div>
          </div>
        </div>
        <AddAgentForm />
        <AgentList />
      </aside>

      <main className="rail-center">
        <FlowGraph />
        <NodePanel />
      </main>

      <aside className="rail-right">
        <LogRail />
      </aside>
    </div>
  );
}
