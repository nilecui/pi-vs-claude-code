import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { TerminalWindow } from "./TerminalWindow";

export function TerminalStrip() {
  const agents = useStore((s) => s.agents);
  const linesByAgent = useStore((s) => s.linesByAgent);
  const selected = useStore((s) => s.selected);
  const selectNonce = useStore((s) => s.selectNonce);

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [zoom, setZoom] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [minimized, setMinimized] = useState<Set<string>>(new Set());

  // Non-explicit agents, active-first: by their last line's ts desc, name tiebreak.
  const list = useMemo(() => {
    const lastTs = (sid: string) => {
      const ls = linesByAgent[sid];
      return ls && ls.length ? ls[ls.length - 1].ts : 0;
    };
    return Object.values(agents)
      .filter((a) => !a.explicit)
      .sort((a, b) => {
        const ta = lastTs(a.session_id);
        const tb = lastTs(b.session_id);
        if (tb !== ta) return tb - ta;
        return a.name.localeCompare(b.name);
      });
  }, [agents, linesByAgent]);

  // Closed windows are hidden until restored via the toggle bar.
  const visibleList = useMemo(
    () => list.filter((a) => !closed.has(a.session_id)),
    [list, closed],
  );

  // Focus-scroll: selecting a node scrolls its window into view horizontally.
  useEffect(() => {
    if (!selected) return;
    const a = agents[selected];
    if (!a || a.explicit) return;
    refs.current[selected]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selected, selectNonce, agents]);

  const zoomAgent = zoom ? agents[zoom] : undefined;

  return (
    <>
      <div className="term-strip-wrap">
        <button className="term-strip-toggle" onClick={() => setCollapsed((c) => !c)}>
          <span>{collapsed ? "▸" : "▾"}</span> 终端 · {visibleList.length}
          {closed.size > 0 && (
            <span className="term-restore" onClick={(e) => { e.stopPropagation(); setClosed(new Set()); }}>显示已关闭 ({closed.size})</span>
          )}
        </button>
        {!collapsed && (
          <div className="term-strip">
            {visibleList.map((a) => (
              <div key={a.session_id} ref={(el) => { refs.current[a.session_id] = el; }}>
                <TerminalWindow
                  agent={a}
                  lines={linesByAgent[a.session_id] ?? []}
                  selected={selected === a.session_id}
                  minimized={minimized.has(a.session_id)}
                  onMaximize={() => setZoom(a.session_id)}
                  onMinimize={() => setMinimized((m) => { const n = new Set(m); n.has(a.session_id) ? n.delete(a.session_id) : n.add(a.session_id); return n; })}
                  onClose={() => setClosed((c) => new Set(c).add(a.session_id))}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {zoomAgent && (
        <div className="term-modal-backdrop" onClick={() => setZoom(null)}>
          <button className="term-modal-close" onClick={() => setZoom(null)}>✕</button>
          <div className="term-modal" onClick={(e) => e.stopPropagation()}>
            <TerminalWindow agent={zoomAgent} lines={linesByAgent[zoomAgent.session_id] ?? []} big />
          </div>
        </div>
      )}
    </>
  );
}
