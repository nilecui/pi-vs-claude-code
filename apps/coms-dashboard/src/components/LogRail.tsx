import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { TerminalCard } from "./TerminalCard";

export function LogRail() {
  const agents = useStore((s) => s.agents);
  const lines = useStore((s) => s.lines);
  const linesByAgent = useStore((s) => s.linesByAgent);
  const selected = useStore((s) => s.selected);

  const list = useMemo(
    () => Object.values(agents).filter((a) => !a.explicit).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Selecting a node opens + scrolls to its section.
  useEffect(() => {
    if (!selected) return;
    setExpanded((e) => ({ ...e, [selected]: true }));
    const el = sectionRefs.current[selected];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  function toggle(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  return (
    <div className="log-rail">
      {list.map((a) => {
        const open = expanded[a.session_id] ?? false;
        return (
          <div
            key={a.session_id}
            className={`log-acc ${open ? "" : "collapsed"} ${selected === a.session_id ? "sel" : ""}`}
            ref={(el) => { sectionRefs.current[a.session_id] = el; }}
          >
            <button className="log-acc-head" onClick={() => toggle(a.session_id)}>
              <span className="dot" style={{ background: a.color }} />
              <b>{a.name}</b>
              <span className="term-sub">{a.model}</span>
              <span className="log-chev">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="log-acc-body">
                <TerminalCard title={a.name} color={a.color} subtitle={a.model} lines={linesByAgent[a.session_id] ?? []} />
              </div>
            )}
          </div>
        );
      })}
      <div className="log-acc">
        <div className="log-acc-head static"><b>activity feed</b><span className="term-sub">all hub events</span></div>
        <div className="log-acc-body"><TerminalCard title="activity feed" subtitle="all hub events" lines={lines} /></div>
      </div>
    </div>
  );
}
