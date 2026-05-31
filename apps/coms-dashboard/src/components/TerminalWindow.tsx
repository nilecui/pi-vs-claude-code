import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentCard, StreamLine } from "../types";

const KIND_PREFIX: Record<StreamLine["kind"], string> = {
  prompt: "❯",
  response: "←",
  status: "·",
  error: "✗",
  system: "·",
};

const KIND_CLASS: Record<StreamLine["kind"], string> = {
  prompt: "sh-prompt",
  response: "sh-response",
  status: "sh-muted",
  error: "sh-error",
  system: "sh-muted",
};

// Reveals text character by character on mount — the streaming shell feel.
// Reveal time is clamped so long responses don't crawl; long blocks instant.
function TypingLine({ text }: { text: string }) {
  const [shown, setShown] = useState(text.length > 240 ? text : "");
  useEffect(() => {
    if (text.length > 240) return; // long blocks render instantly
    let i = 0;
    const total = text.length;
    const step = Math.max(1, Math.ceil(total / 60)); // ~60 frames max
    const t = setInterval(() => {
      i = Math.min(total, i + step);
      setShown(text.slice(0, i));
      if (i >= total) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [text]);
  return <span>{shown}</span>;
}

export function TerminalWindow({
  agent,
  lines,
  big = false,
  selected = false,
  onClick,
}: {
  agent: AgentCard;
  lines: StreamLine[];
  big?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const latestId = lines.length ? lines[lines.length - 1].id : "";

  // Stick to bottom as new lines stream in.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, latestId]);

  return (
    <div className={`macterm${selected ? " sel" : ""}`} onClick={big ? undefined : onClick}>
      <div className="macterm-bar">
        <div className="macterm-lights">
          <span className="macterm-light l-red" />
          <span className="macterm-light l-yellow" />
          <span className="macterm-light l-green" />
        </div>
        <span className="macterm-title">{agent.name}</span>
        <span className="macterm-model">{agent.model}</span>
      </div>
      <div className={`macterm-body${big ? " big" : ""}`} ref={bodyRef}>
        {lines.length === 0 && <div className="sh-empty">— 暂无消息 —</div>}
        {lines.map((l) => (
          <div key={l.id} className="sh-line">
            <span className={KIND_CLASS[l.kind]}>{KIND_PREFIX[l.kind]} </span>
            <span className="sh-pre">{l.from}{l.to ? `→${l.to}` : ""} </span>
            {l.id === latestId ? <TypingLine text={l.text} /> : l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
