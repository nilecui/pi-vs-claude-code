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
      <div className="term-strip">
        {list.map((a) => (
          <div key={a.session_id} ref={(el) => { refs.current[a.session_id] = el; }}>
            <TerminalWindow
              agent={a}
              lines={linesByAgent[a.session_id] ?? []}
              selected={selected === a.session_id}
              onClick={() => setZoom(a.session_id)}
            />
          </div>
        ))}
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
