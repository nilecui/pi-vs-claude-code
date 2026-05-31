import { useStore } from "../store";
import { SCENARIOS } from "../lib/scenarios";

export function ScenarioMenu() {
  const runScenario = useStore((s) => s.runScenario);
  const clearDemo = useStore((s) => s.clearDemo);

  return (
    <div className="scenario-menu">
      <div className="section-label">演示场景</div>
      {SCENARIOS.map((s) => (
        <button key={s.id} className="scenario-btn" onClick={() => runScenario(s.id)}>
          <b>{s.title}</b>
          <span>{s.blurb}</span>
        </button>
      ))}
      <button className="scenario-clear" onClick={() => clearDemo()}>清空演示</button>
    </div>
  );
}
