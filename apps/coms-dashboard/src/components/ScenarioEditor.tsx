import { useEffect, useMemo, useState } from "react";
import { validate } from "../lib/orchestration/validate";
import type { ScenarioDef } from "../lib/orchestration/types";
import { api, teams as teamApi, type TeamSummary } from "../api/client";
import * as draft from "../lib/scenarioDraft";

export function ScenarioEditor({ initial, initialTeamId, onClose, onSaved }: {
  initial: ScenarioDef | null; initialTeamId: string | null; onClose: () => void; onSaved: (id: string) => void;
}) {
  const isNew = initial === null;
  const [s, setS] = useState<ScenarioDef>(initial ? structuredClone(initial) : draft.blankScenario());
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  const [myTeams, setMyTeams] = useState<TeamSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [serverErr, setServerErr] = useState<string[]>([]);
  const errors = useMemo(() => validate(s), [s]);
  const canSave = errors.length === 0 && (!isNew || s.id.trim() !== "") && !saving;
  useEffect(() => { teamApi.list().then(setMyTeams).catch(() => {}); }, []);

  async function save() {
    setSaving(true); setServerErr([]);
    try {
      if (isNew) await api.createScenario(s, teamId); else await api.updateScenario(s.id, s, teamId);
      onSaved(s.id);
    } catch (e) {
      const m = String(e); const jm = m.match(/\{[\s\S]*\}/);
      try { const d = jm ? JSON.parse(jm[0]) : null; setServerErr(d?.details ?? [m]); } catch { setServerErr([m]); }
      setSaving(false);
    }
  }
  async function del() {
    if (isNew) return;
    setSaving(true);
    try { await api.deleteScenario(s.id); onSaved(""); }
    catch (e) { setServerErr([String(e)]); setSaving(false); }
  }

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <strong>{isNew ? "新建场景" : `编辑:${s.title || s.id}`}</strong>
          <button className="result-copy" disabled={!canSave} onClick={save}>{saving ? "保存中…" : "保存"}</button>
          {!isNew && <button className="editor-del" onClick={del}>删除</button>}
          <button className="result-close" onClick={onClose}>✕</button>
        </div>
        {(errors.length > 0 || serverErr.length > 0) && (
          <div className="editor-errors">{[...errors, ...serverErr].map((e, i) => <div key={i}>⚠ {e}</div>)}</div>
        )}
        <div className="editor-body">
          <label className="editor-field"><span>ID</span><input value={s.id} disabled={!isNew} onChange={(e) => setS({ ...s, id: e.target.value })} /></label>
          <label className="editor-field"><span>标题</span><input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></label>
          <label className="editor-field"><span>可见性</span>
            <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)}>
              <option value="">私有(仅自己)</option>
              {myTeams.map((t) => <option key={t.id} value={t.id}>团队:{t.name}</option>)}
            </select>
          </label>
          <label className="editor-field"><span>简介</span><input value={s.blurb} onChange={(e) => setS({ ...s, blurb: e.target.value })} /></label>
          <label className="editor-field"><span>输入提示</span><input value={s.input.label} onChange={(e) => setS({ ...s, input: { ...s.input, label: e.target.value } })} /></label>
          <label className="editor-field"><span>默认输入</span><textarea value={s.input.default} onChange={(e) => setS({ ...s, input: { ...s.input, default: e.target.value } })} /></label>

          <div className="editor-section"><span>角色</span><button onClick={() => setS(draft.addRole(s))}>+ 角色</button></div>
          {s.roles.map((r, i) => (
            <div key={i} className="editor-role">
              <input placeholder="name" value={r.name} onChange={(e) => setS(draft.updateRole(s, i, { name: e.target.value }))} />
              <input placeholder="provider" value={r.provider} onChange={(e) => setS(draft.updateRole(s, i, { provider: e.target.value }))} />
              <input placeholder="model" value={r.model} onChange={(e) => setS(draft.updateRole(s, i, { model: e.target.value }))} />
              <input placeholder="purpose" value={r.purpose} onChange={(e) => setS(draft.updateRole(s, i, { purpose: e.target.value }))} />
              <input type="color" value={r.color} onChange={(e) => setS(draft.updateRole(s, i, { color: e.target.value }))} />
              <button onClick={() => setS(draft.removeRole(s, i))}>✗</button>
            </div>
          ))}

          <div className="editor-section"><span>步骤(DAG)</span><button onClick={() => setS(draft.addStep(s))}>+ 步骤</button></div>
          {s.steps.map((st, i) => (
            <div key={i} className="editor-step">
              <div className="editor-step-row">
                <input className="editor-stepid" placeholder="step id" value={st.id} onChange={(e) => setS(draft.renameStepId(s, i, e.target.value))} />
                <select value={st.role} onChange={(e) => setS(draft.updateStep(s, i, { role: e.target.value }))}>
                  <option value="">(选角色)</option>
                  {s.roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>
                <button onClick={() => setS(draft.removeStep(s, i))}>✗</button>
              </div>
              <textarea placeholder="prompt(支持 {{input}} 与 {{steps.<id>}})" value={st.prompt} onChange={(e) => setS(draft.updateStep(s, i, { prompt: e.target.value }))} />
              <div className="editor-deps">
                <span className="editor-muted">依赖:</span>
                {s.steps.filter((o) => o.id !== st.id).map((o) => (
                  <label key={o.id} className={`editor-chip ${st.after.includes(o.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={st.after.includes(o.id)} onChange={() => setS(draft.toggleAfter(s, i, o.id))} />{o.id}
                  </label>
                ))}
                {s.steps.length <= 1 && <span className="editor-muted">(无其它步骤)</span>}
              </div>
            </div>
          ))}

          <div className="editor-section"><span>装配模板(可选)</span></div>
          <textarea className="editor-assembly" placeholder="留空=汇点步骤产出拼接;支持 {{steps.<id>}}" value={s.assembly ?? ""} onChange={(e) => setS({ ...s, assembly: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
