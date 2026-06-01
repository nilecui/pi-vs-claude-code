import type { ReactNode } from "react";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><strong>{title}</strong><button className="result-close" onClick={onClose}>✕</button></div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
