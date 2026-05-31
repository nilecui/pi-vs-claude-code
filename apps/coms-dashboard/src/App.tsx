import { useEffect, useMemo } from "react";
import { Sidebar } from "./components/Sidebar";
import { GraphView } from "./components/GraphView";
import { TerminalCard } from "./components/TerminalCard";
import { useStore } from "./store";

export default function App() {
  const init = useStore((s) => s.init);
  const shutdown = useStore((s) => s.shutdown);
  const agents = useStore((s) => s.agents);
  const lines = useStore((s) => s.lines);
  const linesByAgent = useStore((s) => s.linesByAgent);

  useEffect(() => {
    init();
    return () => shutdown();
  }, [init, shutdown]);

  const cards = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <section className="graph-pane">
          <GraphView />
        </section>
        <section className="streams-pane">
          <TerminalCard title="activity feed" subtitle="all hub events" lines={lines} />
          {cards.map((a) => (
            <TerminalCard
              key={a.session_id}
              title={a.name}
              color={a.color}
              subtitle={a.model}
              lines={linesByAgent[a.session_id] ?? []}
            />
          ))}
        </section>
      </main>
    </div>
  );
}
