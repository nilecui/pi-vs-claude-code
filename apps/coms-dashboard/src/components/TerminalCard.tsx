import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StreamLine } from "../types";

const KIND_PREFIX: Record<StreamLine["kind"], string> = {
  prompt: "›",
  response: "‹",
  status: "·",
  error: "✗",
  system: "•",
};

// Reveals text character by character on mount — the "terminal stream" feel.
// Reveal time is clamped so long responses don't crawl.
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

export function TerminalCard({
  title,
  color,
  lines,
  subtitle,
}: {
  title: string;
  color?: string;
  subtitle?: string;
  lines: StreamLine[];
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const latestId = lines.length ? lines[lines.length - 1].id : "";

  // Stick to bottom as new lines stream in.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, latestId]);

  return (
    <div className="term-card">
      <div className="term-head" style={color ? { borderColor: color } : undefined}>
        <span className="term-dot" style={{ background: color ?? "#475569" }} />
        <span className="term-title">{title}</span>
        {subtitle && <span className="term-sub">{subtitle}</span>}
      </div>
      <div className="term-body" ref={bodyRef}>
        {lines.length === 0 && <div className="term-empty">— no traffic yet —</div>}
        {lines.map((l) => (
          <div key={l.id} className={`term-line k-${l.kind}`}>
            <span className="term-prefix">{KIND_PREFIX[l.kind]}</span>
            <span className="term-from">{l.from}{l.to ? `→${l.to}` : ""}</span>
            <span className="term-text">
              {l.id === latestId ? <TypingLine text={l.text} /> : l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
