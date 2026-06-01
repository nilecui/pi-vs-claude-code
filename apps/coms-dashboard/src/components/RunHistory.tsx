import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type RunSummary } from "../api/client";

interface RunDetail {
  id: string; scenario_id: string; input: string; status: string;
  result_md: string | null; created_at: number; finished_at: number | null;
  steps: { step_id: string; role: string; status: string; output: string | null }[];
}

const STATUS_LABEL: Record<string, string> = { done: "完成", error: "出错", aborted: "中止", running: "运行中" };

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RunHistory({ scenarioId, onRerun, onClose }: {
  scenarioId: string; onRerun: (input: string) => void; onClose: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [sel, setSel] = useState<RunDetail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listRuns(scenarioId).then(setRuns).catch(() => setErr("加载历史失败"));
  }, [scenarioId]);

  async function open(id: string) {
    setErr("");
    try { setSel((await api.getRun(id)) as RunDetail); }
    catch { setErr("加载运行详情失败"); }
  }

  return (
    <div className="history-backdrop" onClick={onClose}>
      <div className="history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-head">
          <strong>运行历史</strong>
          <span className="result-sub">{runs.length} 条 · 当前场景</span>
          <button className="result-close" onClick={onClose}>✕</button>
        </div>
        {err && <div className="editor-errors">⚠ {err}</div>}
        <div className="history-body">
          <div className="history-list">
            {runs.length === 0 && <div className="chat-empty">本场景暂无运行记录</div>}
            {runs.map((r) => (
              <div key={r.id} className={`history-item ${sel?.id === r.id ? "on" : ""}`} onClick={() => open(r.id)}>
                <div className="history-item-top">
                  <span className={`history-badge st-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  {r.owner_name && <span className="history-owner">由 {r.owner_name}</span>}
                  <span className="history-time">{fmtTime(r.created_at)}</span>
                </div>
                <div className="history-input">{r.input}</div>
              </div>
            ))}
          </div>
          <div className="history-detail">
            {!sel && <div className="chat-empty">选择左侧一条运行查看产出与步骤。</div>}
            {sel && (
              <>
                <div className="history-detail-head">
                  <span className={`history-badge st-${sel.status}`}>{STATUS_LABEL[sel.status] ?? sel.status}</span>
                  <button className="result-copy" onClick={() => onRerun(sel.input)}>重跑</button>
                  {sel.result_md && <button className="result-copy" onClick={() => navigator.clipboard?.writeText(sel.result_md ?? "")}>复制产出</button>}
                </div>
                <div className="history-steps">
                  {sel.steps.map((s) => (
                    <details key={s.step_id} className="history-step">
                      <summary><b>{s.step_id}</b> · {s.role} · {STATUS_LABEL[s.status] ?? s.status}</summary>
                      <pre className="history-output">{s.output ?? "(无输出)"}</pre>
                    </details>
                  ))}
                </div>
                {sel.result_md
                  ? <div className="chat-md history-result"><ReactMarkdown remarkPlugins={[remarkGfm]}>{sel.result_md}</ReactMarkdown></div>
                  : <div className="chat-empty">该运行无装配产出({STATUS_LABEL[sel.status] ?? sel.status})。</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
